# Three Lambda functions from one zip (interface contract with ingestion/).
# Each function has its own least-privilege execution role.

locals {
  lambda_functions = {
    kc_inspections = {
      handler     = "handlers.kc_inspections.handler"
      timeout     = var.kc_inspections_timeout_seconds
      memory      = var.kc_inspections_memory_mb
      description = "Full pull of KC food inspections (r878-4sxa) to s3://.../raw/kc_inspections/"
    }
    census_geocoder = {
      handler     = "handlers.census_geocoder.handler"
      timeout     = var.census_geocoder_timeout_seconds
      memory      = var.census_geocoder_memory_mb
      description = "Geocode new KC addresses with the Census batch geocoder to s3://.../raw/census_geocoder/"
    }
    dispatch = {
      handler     = "handlers.dispatch.handler"
      timeout     = var.dispatch_timeout_seconds
      memory      = var.dispatch_memory_mb
      description = "Send GitHub repository_dispatch (pipeline_run) after successful extracts"
    }
  }

  # Non-secret configuration shared by all handlers. The GitHub token itself
  # is read at runtime from Secrets Manager (only the dispatch role may).
  lambda_common_env = {
    RAW_BUCKET              = aws_s3_bucket.data.bucket
    GITHUB_REPO             = var.github_repo
    GITHUB_TOKEN_SECRET_ARN = aws_secretsmanager_secret.github_token.arn
    LOG_LEVEL               = var.log_level
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/${local.name}-${replace(each.key, "_", "-")}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each = local.lambda_functions

  name               = "${local.name}-lambda-${replace(each.key, "_", "-")}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# --- KC inspections: write raw/kc_inspections/ only ------------------------
data "aws_iam_policy_document" "lambda_kc_inspections" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda["kc_inspections"].arn}:*"]
  }

  statement {
    sid       = "WriteRawKc"
    actions   = ["s3:PutObject"]
    resources = ["${local.bucket_arn}/${local.raw_kc_inspections_prefix}*"]
  }

  # Read back its own prefix (HEAD/GET) for idempotent re-runs.
  statement {
    sid       = "ReadRawKc"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/${local.raw_kc_inspections_prefix}*"]
  }

  statement {
    sid       = "ListRawKc"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.raw_kc_inspections_prefix}*"]
    }
  }
}

# --- Census geocoder: read KC raw, read/write geocoder raw -------------------
data "aws_iam_policy_document" "lambda_census_geocoder" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda["census_geocoder"].arn}:*"]
  }

  statement {
    sid     = "ReadRaw"
    actions = ["s3:GetObject"]
    resources = [
      "${local.bucket_arn}/${local.raw_kc_inspections_prefix}*",
      "${local.bucket_arn}/${local.raw_census_geocoder_prefix}*",
    ]
  }

  statement {
    sid       = "WriteRawGeocoder"
    actions   = ["s3:PutObject"]
    resources = ["${local.bucket_arn}/${local.raw_census_geocoder_prefix}*"]
  }

  statement {
    sid       = "ListRaw"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "${local.raw_kc_inspections_prefix}*",
        "${local.raw_census_geocoder_prefix}*",
      ]
    }
  }
}

# --- Dispatch: read the GitHub token secret only ----------------------------
data "aws_iam_policy_document" "lambda_dispatch" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda["dispatch"].arn}:*"]
  }

  statement {
    sid       = "ReadGithubToken"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.github_token.arn]
  }
}

locals {
  lambda_policies = {
    kc_inspections  = data.aws_iam_policy_document.lambda_kc_inspections.json
    census_geocoder = data.aws_iam_policy_document.lambda_census_geocoder.json
    dispatch        = data.aws_iam_policy_document.lambda_dispatch.json
  }
}

resource "aws_iam_role_policy" "lambda" {
  for_each = local.lambda_functions

  name   = "least-privilege"
  role   = aws_iam_role.lambda[each.key].id
  policy = local.lambda_policies[each.key]
}

resource "aws_lambda_function" "this" {
  for_each = local.lambda_functions

  function_name = "${local.name}-${replace(each.key, "_", "-")}"
  description   = each.value.description
  role          = aws_iam_role.lambda[each.key].arn

  filename         = local.lambda_zip_path
  source_code_hash = filebase64sha256(local.lambda_zip_path)
  runtime          = local.lambda_runtime
  handler          = each.value.handler
  architectures    = [var.lambda_architecture]
  timeout          = each.value.timeout
  memory_size      = each.value.memory

  environment {
    variables = merge(
      local.lambda_common_env,
      # Only the KC extractor gets the (optional) Socrata app token.
      each.key == "kc_inspections" && var.socrata_app_token != "" ? { SOCRATA_APP_TOKEN = var.socrata_app_token } : {},
    )
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.lambda[each.key].name
  }

  depends_on = [
    aws_iam_role_policy.lambda,
    aws_cloudwatch_log_group.lambda,
  ]
}
