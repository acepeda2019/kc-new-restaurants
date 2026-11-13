# Read-only IAM user for the Vercel build: GetObject/ListBucket on
# exports/latest/ only. No access key is created here, so no secret lands in
# Terraform state. Create it once, out of band (see README), and store it
# only in server-side Vercel env vars (never NEXT_PUBLIC_*).

resource "aws_iam_user" "vercel_build" {
  name = "${local.name}-vercel-build-ro"
}

data "aws_iam_policy_document" "vercel_build" {
  statement {
    sid       = "ReadLatestExports"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/${local.exports_latest_prefix}*"]
  }

  statement {
    sid       = "ListLatestExports"
    actions   = ["s3:ListBucket"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = [local.exports_latest_prefix, "${local.exports_latest_prefix}*"]
    }
  }
}

resource "aws_iam_user_policy" "vercel_build" {
  name   = "exports-latest-read-only"
  user   = aws_iam_user.vercel_build.name
  policy = data.aws_iam_policy_document.vercel_build.json
}
