# Snowflake objects (docs/PROJECT_SPEC.md sections 5 and 9). No Snowpipe:
# RAW is loaded by COPY INTO inside the pipeline job.

# --- Cost guardrail ----------------------------------------------------------
# Quota = floor(snowflake_monthly_budget_usd / snowflake_credit_price_usd)
# credits per month (default 10 / 3 = 3 credits; XS burns 1 credit/hour, so
# about 3 warehouse-hours a month, far above one ~2-5 minute wake per day).
# Frequency and start are left at Snowflake defaults (MONTHLY, IMMEDIATELY).
# Note: a warehouse-level monitor does not cover cloud services, serverless
# features or other warehouses (e.g. a trial's COMPUTE_WH).
resource "snowflake_resource_monitor" "monthly" {
  provider = snowflake.accountadmin

  name            = local.sf_monitor_name
  credit_quota    = local.snowflake_credit_quota
  notify_triggers = [75]
  suspend_trigger = 100
  # Backstop: if queries already running push usage past 110%, kill them.
  suspend_immediate_trigger = 110
  notify_users              = var.snowflake_monitor_notify_users
}

# Created as ACCOUNTADMIN because assigning a resource monitor requires it.
resource "snowflake_warehouse" "main" {
  provider = snowflake.accountadmin

  name                = local.sf_warehouse_name
  comment             = "Single XS warehouse for COPY INTO, dbt and exports. Wakes about once a day."
  warehouse_size      = "XSMALL"
  auto_suspend        = 60
  auto_resume         = "true"
  initially_suspended = true
  resource_monitor    = snowflake_resource_monitor.monthly.name

  # Bound runaway or stuck queries (cost guardrail).
  statement_timeout_in_seconds        = 1800
  statement_queued_timeout_in_seconds = 900
}

# --- Database and schemas ------------------------------------------------
resource "snowflake_database" "main" {
  name                        = var.snowflake_database_name
  comment                     = "King County New Eats: RAW -> STAGING -> INTERMEDIATE -> MARTS (prod). dbt creates dev/ci schemas with prefixes."
  data_retention_time_in_days = 1
}

locals {
  sf_schemas = {
    RAW          = "As-received data loaded with COPY INTO from s3://.../raw/. Tables owned by the loader role."
    STAGING      = "dbt staging models (1:1 with sources)."
    INTERMEDIATE = "dbt intermediate models (includes persisted int_restaurant_id_map)."
    MARTS        = "dbt marts; app marts are exported to s3://.../exports/."
  }
}

resource "snowflake_schema" "this" {
  for_each = local.sf_schemas

  database = snowflake_database.main.name
  name     = each.key
  comment  = each.value
}

# --- Storage integration and stages ---------------------------------------
resource "snowflake_storage_integration_aws" "s3" {
  provider = snowflake.accountadmin

  name                    = local.sf_integration_name
  comment                 = "Read raw/, write exports/ in s3://${var.data_bucket_name} via ${local.snowflake_s3_role_name}."
  enabled                 = true
  storage_provider        = "S3"
  storage_aws_role_arn    = local.snowflake_s3_role_arn
  storage_aws_external_id = random_uuid.snowflake_external_id.result
  storage_allowed_locations = [
    "s3://${var.data_bucket_name}/${local.raw_prefix}",
    "s3://${var.data_bucket_name}/${local.exports_prefix}",
  ]
}

# SYSADMIN creates the stages, so it needs USAGE on the integration.
resource "snowflake_grant_privileges_to_account_role" "integration_to_sysadmin" {
  provider = snowflake.accountadmin

  account_role_name = "SYSADMIN"
  privileges        = ["USAGE"]

  on_account_object {
    object_type = "INTEGRATION"
    object_name = snowflake_storage_integration_aws.s3.name
  }
}

resource "snowflake_file_format_json" "jsonl" {
  database = snowflake_database.main.name
  schema   = snowflake_schema.this["RAW"].name
  name     = "JSONL"
  comment  = "Newline-delimited JSON as landed by the extractors (gzip auto-detected)."

  compression       = "AUTO"
  strip_outer_array = "false"
}

# Census batch geocoder response: no header, quoted, ragged (8 fields on a
# match, 3 on No_Match/Tie); see docs/source_cards/census_geocoder.md.
resource "snowflake_file_format_csv" "geocoder_csv" {
  database = snowflake_database.main.name
  schema   = snowflake_schema.this["RAW"].name
  name     = "GEOCODER_CSV"
  comment  = "Census geocoder batch response: no header, optionally quoted, variable column count."

  compression                    = "AUTO"
  field_delimiter                = ","
  field_optionally_enclosed_by   = "\""
  skip_header                    = 0
  error_on_column_count_mismatch = "false"
  empty_field_as_null            = "true"
  encoding                       = "UTF8"
}

resource "snowflake_stage_external_s3" "raw" {
  database            = snowflake_database.main.name
  schema              = snowflake_schema.this["RAW"].name
  name                = "RAW_S3_STAGE"
  comment             = "Read-only view of s3://${var.data_bucket_name}/raw/ (the IAM role cannot write raw/)."
  url                 = "s3://${var.data_bucket_name}/${local.raw_prefix}"
  storage_integration = snowflake_storage_integration_aws.s3.name

  depends_on = [snowflake_grant_privileges_to_account_role.integration_to_sysadmin]
}

resource "snowflake_stage_external_s3" "exports" {
  database            = snowflake_database.main.name
  schema              = snowflake_schema.this["MARTS"].name
  name                = "EXPORTS_S3_STAGE"
  comment             = "Unload target for app marts: s3://${var.data_bucket_name}/exports/dt=YYYY-MM-DD/<run_id>/."
  url                 = "s3://${var.data_bucket_name}/${local.exports_prefix}"
  storage_integration = snowflake_storage_integration_aws.s3.name

  depends_on = [snowflake_grant_privileges_to_account_role.integration_to_sysadmin]
}
