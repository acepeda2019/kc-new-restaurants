# GitHub Actions OIDC role for .github/workflows/pipeline.yml.
# Trusted only for var.github_repo running in the var.github_environment
# environment. Permissions:
#   - read/write dbt-artifacts/ (prod manifest.json)
#   - read exports/, write/delete exports/latest/ (promote a dated export
#     to latest/ and write latest/manifest.json)
#   - publish failure alerts to the alerts topic
# No raw/ access: loading RAW is done by Snowflake through its own role.

locals {
  github_oidc_url = "token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://${local.github_oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = "https://${local.github_oidc_url}"
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:sub"
      values   = ["repo:${var.github_repo}:environment:${var.github_environment}"]
    }
  }
}

data "aws_iam_policy_document" "github_pipeline" {
  statement {
    sid       = "DbtArtifactsReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${local.bucket_arn}/${local.dbt_artifacts_prefix}*"]
  }

  statement {
    sid       = "ExportsRead"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/${local.exports_prefix}*"]
  }

  statement {
    sid       = "ExportsLatestWrite"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.bucket_arn}/${local.exports_latest_prefix}*"]
  }

  statement {
    sid       = "List"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "${local.dbt_artifacts_prefix}*",
        "${local.exports_prefix}*",
      ]
    }
  }

  statement {
    sid       = "PublishAlerts"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }
}

resource "aws_iam_role" "github_pipeline" {
  name                 = "${local.name}-github-pipeline"
  description          = "Assumed by GitHub Actions (${var.github_repo}, environment ${var.github_environment}) via OIDC."
  assume_role_policy   = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_pipeline" {
  name   = "least-privilege"
  role   = aws_iam_role.github_pipeline.id
  policy = data.aws_iam_policy_document.github_pipeline.json
}
