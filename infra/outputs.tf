output "raw_bucket" {
  description = "Set as the RAW_BUCKET repository variable."
  value       = aws_s3_bucket.raw.bucket
}

output "github_role_arn" {
  description = "Set as the AWS_ROLE_ARN repository variable."
  value       = aws_iam_role.github.arn
}
