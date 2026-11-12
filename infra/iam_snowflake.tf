# Role assumed by the Snowflake storage integration.
# Reads raw/ (COPY INTO RAW) and reads/writes exports/ only (COPY INTO the
# exports stage). It cannot write, overwrite or delete anything in raw/.
#
# Trust round-trip, automated: the integration is created with the role ARN
# as a plain string (local.snowflake_s3_role_arn) and an external ID chosen
# here; the trust policy then reads Snowflake's IAM user ARN back from the
# integration. One apply, no manual DESC INTEGRATION copy-paste.

resource "random_uuid" "snowflake_external_id" {}

data "aws_iam_policy_document" "snowflake_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [snowflake_storage_integration_aws.s3.describe_output[0].iam_user_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [random_uuid.snowflake_external_id.result]
    }
  }
}

data "aws_iam_policy_document" "snowflake_s3" {
  statement {
    sid = "ReadRawAndExports"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = [
      "${local.bucket_arn}/${local.raw_prefix}*",
      "${local.bucket_arn}/${local.exports_prefix}*",
    ]
  }

  # COPY INTO <stage> ... OVERWRITE = TRUE needs DeleteObject on its target.
  statement {
    sid = "WriteExportsOnly"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${local.bucket_arn}/${local.exports_prefix}*"]
  }

  statement {
    sid       = "ListRawAndExports"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "${local.raw_prefix}*",
        "${local.exports_prefix}*",
      ]
    }
  }

  statement {
    sid       = "BucketLocation"
    actions   = ["s3:GetBucketLocation"]
    resources = [local.bucket_arn]
  }
}

resource "aws_iam_role" "snowflake_s3" {
  name                 = local.snowflake_s3_role_name
  description          = "Assumed by the Snowflake storage integration ${local.sf_integration_name}."
  assume_role_policy   = data.aws_iam_policy_document.snowflake_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "snowflake_s3" {
  name   = "raw-read-exports-write"
  role   = aws_iam_role.snowflake_s3.id
  policy = data.aws_iam_policy_document.snowflake_s3.json
}
