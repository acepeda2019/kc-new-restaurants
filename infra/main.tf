# The MVP's only cloud resources: one S3 bucket and a GitHub Actions OIDC role.
#   raw/      immutable, write-once source files (extractors, Claude classifications)
#   exports/  dated JSON exports for the app, plus exports/latest/

locals {
  raw_prefix      = "raw/"
  github_oidc_url = "token.actions.githubusercontent.com"
  # Scheduled and manually dispatched runs of main both present this subject.
  github_subjects = ["repo:${var.github_repo}:ref:refs/heads/main"]
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "raw" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_ownership_controls" "raw" {
  bucket = aws_s3_bucket.raw.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "raw" {
  bucket                  = aws_s3_bucket.raw.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "raw" {
  bucket = aws_s3_bucket.raw.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "raw" {
  bucket = aws_s3_bucket.raw.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# raw/ is write-once: every put must carry If-None-Match: * (the extractors do),
# and only account admins may delete. exports/ is overwritten daily.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.raw.arn, "${aws_s3_bucket.raw.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyRawOverwrite"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.raw.arn}/${local.raw_prefix}*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Null"
      variable = "s3:if-none-match"
      values   = ["true"]
    }
  }

  statement {
    sid       = "DenyRawDeleteByPipeline"
    effect    = "Deny"
    actions   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.raw.arn}/${local.raw_prefix}*"]
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.github.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "raw" {
  bucket = aws_s3_bucket.raw.id
  policy = data.aws_iam_policy_document.bucket.json
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://${local.github_oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.github_oidc_url}"
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
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "github" {
  name               = "kc-new-eats-github-pipeline"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
}

data "aws_iam_policy_document" "github_pipeline" {
  statement {
    sid       = "ReadWriteObjects"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.raw.arn}/*"]
  }
  statement {
    sid       = "List"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.raw.arn]
  }
}

resource "aws_iam_role_policy" "github_pipeline" {
  name   = "s3-raw-and-exports"
  role   = aws_iam_role.github.id
  policy = data.aws_iam_policy_document.github_pipeline.json
}
