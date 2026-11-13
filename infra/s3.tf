# One data bucket:
#   raw/            immutable, dated landing files written by the extract Lambdas
#   exports/        app JSON written by Snowflake (dt=YYYY-MM-DD/<run_id>/ and latest/)
#   dbt-artifacts/  prod manifest.json for state:modified CI builds

resource "aws_s3_bucket" "data" {
  bucket = var.data_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3: no KMS key cost and no extra kms:* grants for Snowflake or Vercel.
resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  # Small objects (< 128 KB, e.g. geocoder chunks) stay in STANDARD, where
  # they are cheaper than IA's 128 KB minimum billable size.
  transition_default_minimum_object_size = "all_storage_classes_128K"

  # raw/ is history: cheaper storage over time, never expired.
  rule {
    id     = "raw-tiering"
    status = "Enabled"

    filter {
      prefix = local.raw_prefix
    }

    transition {
      days          = var.raw_transition_to_ia_days
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = var.raw_transition_to_glacier_ir_days
      storage_class = "GLACIER_IR"
    }
  }

  # exports/latest/ and dbt-artifacts/ are overwritten every run; drop the
  # superseded versions after a while.
  rule {
    id     = "exports-noncurrent-cleanup"
    status = "Enabled"

    filter {
      prefix = local.exports_prefix
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  rule {
    id     = "dbt-artifacts-noncurrent-cleanup"
    status = "Enabled"

    filter {
      prefix = local.dbt_artifacts_prefix
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    expiration {
      expired_object_delete_marker = true
    }
  }

  dynamic "rule" {
    for_each = var.dated_exports_expiration_days > 0 ? [1] : []

    content {
      id     = "dated-exports-expiration"
      status = "Enabled"

      filter {
        prefix = "${local.exports_prefix}dt="
      }

      expiration {
        days = var.dated_exports_expiration_days
      }
    }
  }

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.data]
}

# Bucket policy: TLS only, and raw/ is append-only for everyone except the
# listed admin principals (versioning keeps any overwrite recoverable, but
# the deny makes it impossible in the first place).
data "aws_iam_policy_document" "data_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      local.bucket_arn,
      "${local.bucket_arn}/*",
    ]

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
    sid    = "DenyRawDeleteExceptAdmins"
    effect = "Deny"
    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ]
    resources = ["${local.bucket_arn}/${local.raw_prefix}*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values   = var.raw_admin_principal_arns
    }
  }

  dynamic "statement" {
    for_each = var.raw_enforce_create_only ? [1] : []

    content {
      sid       = "DenyRawOverwriteExceptAdmins"
      effect    = "Deny"
      actions   = ["s3:PutObject"]
      resources = ["${local.bucket_arn}/${local.raw_prefix}*"]

      principals {
        type        = "*"
        identifiers = ["*"]
      }

      # Writes without If-None-Match could replace an existing object.
      condition {
        test     = "Null"
        variable = "s3:if-none-match"
        values   = ["true"]
      }

      condition {
        test     = "ArnNotLike"
        variable = "aws:PrincipalArn"
        values   = var.raw_admin_principal_arns
      }
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.data_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.data]
}
