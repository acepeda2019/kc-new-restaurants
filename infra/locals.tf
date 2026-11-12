data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name       = "${var.project_name}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = var.github_repo
  }

  # S3 layout (docs/PROJECT_SPEC.md section 5). Trailing slashes matter.
  bucket_arn            = aws_s3_bucket.data.arn
  raw_prefix            = "raw/"
  exports_prefix        = "exports/"
  exports_latest_prefix = "exports/latest/"
  dbt_artifacts_prefix  = "dbt-artifacts/"

  # Per-source raw prefixes (interface contract with ingestion/).
  raw_kc_inspections_prefix  = "raw/kc_inspections/"
  raw_census_geocoder_prefix = "raw/census_geocoder/"

  # Lambda contract: one zip, python3.12, three handlers.
  lambda_zip_path = coalesce(var.lambda_zip_path, "${path.root}/../ingestion/dist/lambda.zip")
  lambda_runtime  = "python3.12"

  # Snowflake object names.
  sf_warehouse_name     = "${var.snowflake_name_prefix}_WH"
  sf_monitor_name       = "${var.snowflake_name_prefix}_MONTHLY_MONITOR"
  sf_integration_name   = "${var.snowflake_name_prefix}_S3_INTEGRATION"
  sf_loader_role        = "${var.snowflake_name_prefix}_LOADER"
  sf_transformer_role   = "${var.snowflake_name_prefix}_TRANSFORMER"
  sf_pipeline_user_name = "${var.snowflake_name_prefix}_PIPELINE_SVC"

  # Name of the AWS role Snowflake assumes. Built as a string (not taken from
  # the role resource) so the storage integration and the role's trust
  # policy do not form a dependency cycle; see iam_snowflake.tf.
  snowflake_s3_role_name = "${local.name}-snowflake-s3"
  snowflake_s3_role_arn  = "arn:${local.partition}:iam::${local.account_id}:role/${local.snowflake_s3_role_name}"

  # Resource monitor quota: about snowflake_monthly_budget_usd per month.
  snowflake_credit_quota = coalesce(
    var.snowflake_credit_quota_override,
    max(1, floor(var.snowflake_monthly_budget_usd / var.snowflake_credit_price_usd)),
  )
}
