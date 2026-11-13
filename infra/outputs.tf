output "data_bucket" {
  description = "Data bucket name (GitHub variable DATA_BUCKET)."
  value       = aws_s3_bucket.data.bucket
}

output "lambda_function_names" {
  description = "Lambda function names by handler."
  value       = { for k, fn in aws_lambda_function.this : k => fn.function_name }
}

output "state_machine_arn" {
  description = "Step Functions pipeline ARN (start a manual run with aws stepfunctions start-execution)."
  value       = aws_sfn_state_machine.pipeline.arn
}

output "alerts_topic_arn" {
  description = "SNS alerts topic (GitHub variable ALERTS_TOPIC_ARN)."
  value       = aws_sns_topic.alerts.arn
}

output "github_token_secret_arn" {
  description = "Secrets Manager secret to fill with the GitHub dispatch token (value set manually)."
  value       = aws_secretsmanager_secret.github_token.arn
}

output "github_pipeline_role_arn" {
  description = "IAM role for GitHub Actions OIDC (GitHub variable AWS_PIPELINE_ROLE_ARN)."
  value       = aws_iam_role.github_pipeline.arn
}

output "vercel_build_user_name" {
  description = "Read-only IAM user for the Vercel build; create its access key out of band."
  value       = aws_iam_user.vercel_build.name
}

output "snowflake_s3_role_arn" {
  description = "IAM role assumed by the Snowflake storage integration."
  value       = aws_iam_role.snowflake_s3.arn
}

output "snowflake_storage_integration_iam_user_arn" {
  description = "Snowflake's AWS IAM user for the storage integration (trusted by snowflake_s3_role_arn)."
  value       = snowflake_storage_integration_aws.s3.describe_output[0].iam_user_arn
}

output "snowflake_objects" {
  description = "Snowflake object names used by the GitHub workflows (GitHub variables)."
  value = {
    warehouse         = snowflake_warehouse.main.name
    database          = snowflake_database.main.name
    loader_role       = snowflake_account_role.loader.name
    transformer_role  = snowflake_account_role.transformer.name
    raw_stage         = snowflake_stage_external_s3.raw.fully_qualified_name
    exports_stage     = snowflake_stage_external_s3.exports.fully_qualified_name
    jsonl_format      = snowflake_file_format_json.jsonl.fully_qualified_name
    geocoder_format   = snowflake_file_format_csv.geocoder_csv.fully_qualified_name
    resource_monitor  = snowflake_resource_monitor.monthly.name
    credit_quota      = local.snowflake_credit_quota
    pipeline_username = one(snowflake_service_user.pipeline[*].name)
  }
}
