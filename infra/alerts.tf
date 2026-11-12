# One SNS topic for every alert: Step Functions failures, CloudWatch alarms,
# AWS Budgets and failed GitHub pipeline runs.
# Not KMS-encrypted on purpose: Budgets and CloudWatch cannot publish to a
# topic encrypted with the AWS-managed SNS key, and messages hold no secrets.
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "AllowBudgets"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "AllowCloudWatchAlarms"
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

resource "aws_sns_topic_subscription" "alerts_email" {
  for_each = toset(var.alert_emails)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# --- CloudWatch alarms (first 10 alarms are free tier) ---------------------
# Failed executions already publish a detailed message from the state
# machine's Catch; these cover what a Catch cannot.
resource "aws_cloudwatch_metric_alarm" "pipeline_timed_out_or_aborted" {
  alarm_name          = "${local.name}-pipeline-timed-out-or-aborted"
  alarm_description   = "The daily Step Functions pipeline timed out or was aborted (no repository_dispatch was sent)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "total"
    expression  = "timedout + aborted"
    label       = "Executions timed out or aborted"
    return_data = true
  }

  metric_query {
    id = "timedout"

    metric {
      namespace   = "AWS/States"
      metric_name = "ExecutionsTimedOut"
      period      = 3600
      stat        = "Sum"
      dimensions = {
        StateMachineArn = aws_sfn_state_machine.pipeline.arn
      }
    }
  }

  metric_query {
    id = "aborted"

    metric {
      namespace   = "AWS/States"
      metric_name = "ExecutionsAborted"
      period      = 3600
      stat        = "Sum"
      dimensions = {
        StateMachineArn = aws_sfn_state_machine.pipeline.arn
      }
    }
  }
}

# Dead-man's switch: no successful run in a day (schedule not firing,
# repeated failures, or the scheduler role broken).
resource "aws_cloudwatch_metric_alarm" "pipeline_no_success" {
  count = var.schedule_enabled ? 1 : 0

  alarm_name          = "${local.name}-pipeline-no-success-24h"
  alarm_description   = "No successful Step Functions pipeline execution in the last 24 hours."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsSucceeded"
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    StateMachineArn = aws_sfn_state_machine.pipeline.arn
  }
}
