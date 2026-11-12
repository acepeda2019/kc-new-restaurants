# EventBridge Scheduler (daily) -> Step Functions:
#   Extract (parallel; KC only in milestone 1) -> Geocode -> Dispatch
# Any failure: publish to the alerts topic, then Fail. Dispatch is never
# reached after a failed extract or geocode.
#
# Data flow (interface contract with ingestion/):
#   execution input  -> KC handler event
#   KC output        -> geocoder event (verbatim)
#   {kc_inspections: <KC output>, census_geocoder: <geocoder output>}
#                    -> dispatch event

locals {
  # Lambda service hiccups: retry quickly with backoff.
  sfn_retry_lambda_service = {
    ErrorEquals = [
      "Lambda.ServiceException",
      "Lambda.AWSLambdaException",
      "Lambda.SdkClientException",
      "Lambda.TooManyRequestsException",
    ]
    IntervalSeconds = 5
    MaxAttempts     = 3
    BackoffRate     = 2
    JitterStrategy  = "FULL"
  }

  # Handler errors (they raise on failure, e.g. a source API outage that
  # outlasted the handler's own retries). Handlers are idempotent per run
  # date, so one delayed re-run is safe.
  sfn_retry_task_failed = {
    ErrorEquals     = ["States.TaskFailed"]
    IntervalSeconds = 120
    MaxAttempts     = 1
    BackoffRate     = 2
  }

  sfn_catch_all = [{
    ErrorEquals = ["States.ALL"]
    ResultPath  = "$.error"
    Next        = "NotifyFailure"
  }]

  pipeline_definition = {
    Comment        = "${local.name}: daily extract -> geocode -> GitHub repository_dispatch"
    StartAt        = "Extract"
    TimeoutSeconds = 3600
    States = {
      Extract = {
        Type    = "Parallel"
        Comment = "One branch per extract Lambda (milestone 1: KC inspections only)."
        Branches = [{
          StartAt = "KcInspections"
          States = {
            KcInspections = {
              Type     = "Task"
              Resource = "arn:${local.partition}:states:::lambda:invoke"
              Parameters = {
                FunctionName = aws_lambda_function.this["kc_inspections"].arn
                "Payload.$"  = "$"
              }
              OutputPath     = "$.Payload"
              TimeoutSeconds = var.kc_inspections_timeout_seconds + 30
              Retry          = [local.sfn_retry_lambda_service, local.sfn_retry_task_failed]
              End            = true
            }
          }
        }]
        ResultSelector = {
          "kc_inspections.$" = "$[0]"
        }
        ResultPath = "$.results"
        Catch      = local.sfn_catch_all
        Next       = "GeocodeAddresses"
      }

      GeocodeAddresses = {
        Type     = "Task"
        Resource = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.this["census_geocoder"].arn
          "Payload.$"  = "$.results.kc_inspections"
        }
        ResultSelector = {
          "output.$" = "$.Payload"
        }
        ResultPath     = "$.results.census_geocoder"
        TimeoutSeconds = var.census_geocoder_timeout_seconds + 30
        Retry          = [local.sfn_retry_lambda_service, local.sfn_retry_task_failed]
        Catch          = local.sfn_catch_all
        Next           = "DispatchPipeline"
      }

      DispatchPipeline = {
        Type     = "Task"
        Resource = "arn:${local.partition}:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.this["dispatch"].arn
          Payload = {
            "kc_inspections.$"  = "$.results.kc_inspections"
            "census_geocoder.$" = "$.results.census_geocoder.output"
          }
        }
        OutputPath     = "$.Payload"
        TimeoutSeconds = var.dispatch_timeout_seconds + 30
        Retry = [
          local.sfn_retry_lambda_service,
          merge(local.sfn_retry_task_failed, { IntervalSeconds = 30, MaxAttempts = 2 }),
        ]
        Catch = local.sfn_catch_all
        End   = true
      }

      NotifyFailure = {
        Type     = "Task"
        Resource = "arn:${local.partition}:states:::sns:publish"
        Parameters = {
          TopicArn    = aws_sns_topic.alerts.arn
          Subject     = "[${local.name}] daily pipeline failed (no dispatch sent)"
          "Message.$" = "States.Format('Execution {} failed. Error: {}. Cause: {}', $$.Execution.Id, $.error.Error, $.error.Cause)"
        }
        ResultPath = null
        Next       = "PipelineFailed"
      }

      PipelineFailed = {
        Type      = "Fail"
        ErrorPath = "$.error.Error"
        CausePath = "$.error.Cause"
      }
    }
  }
}

resource "aws_cloudwatch_log_group" "pipeline" {
  name              = "/aws/vendedlogs/states/${local.name}-pipeline"
  retention_in_days = var.log_retention_days
}

# --- State machine role ----------------------------------------------------
data "aws_iam_policy_document" "sfn_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

data "aws_iam_policy_document" "sfn" {
  statement {
    sid     = "InvokePipelineLambdas"
    actions = ["lambda:InvokeFunction"]
    resources = flatten([
      for fn in aws_lambda_function.this : [fn.arn, "${fn.arn}:*"]
    ])
  }

  statement {
    sid       = "PublishAlerts"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }

  # Step Functions log delivery: these actions do not support resource-level
  # permissions (AWS documents Resource "*").
  statement {
    sid = "LogDelivery"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "sfn" {
  name               = "${local.name}-sfn-pipeline"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume.json
}

resource "aws_iam_role_policy" "sfn" {
  name   = "least-privilege"
  role   = aws_iam_role.sfn.id
  policy = data.aws_iam_policy_document.sfn.json
}

resource "aws_sfn_state_machine" "pipeline" {
  name       = "${local.name}-pipeline"
  type       = "STANDARD" # about 10 state transitions per day: inside the free tier
  role_arn   = aws_iam_role.sfn.arn
  definition = jsonencode(local.pipeline_definition)

  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.pipeline.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  depends_on = [aws_iam_role_policy.sfn]
}

# --- Scheduler -------------------------------------------------------------
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    sid       = "StartPipeline"
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.pipeline.arn]
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "least-privilege"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

resource "aws_scheduler_schedule" "daily" {
  name        = "${local.name}-daily"
  description = "Daily run of the ${local.name} extract pipeline."
  state       = var.schedule_enabled ? "ENABLED" : "DISABLED"

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_sfn_state_machine.pipeline.arn
    role_arn = aws_iam_role.scheduler.arn

    # Becomes the KC handler's event. Handlers may ignore it.
    input = jsonencode({
      trigger                = "schedule"
      scheduled_time         = "<aws.scheduler.scheduled-time>"
      scheduler_execution_id = "<aws.scheduler.execution-id>"
    })

    retry_policy {
      maximum_retry_attempts       = 3
      maximum_event_age_in_seconds = 3600
    }
  }
}
