# ---------------------------------------------------------------------------
# General
# ---------------------------------------------------------------------------
variable "project_name" {
  description = "Short name used as a prefix for AWS resource names."
  type        = string
  default     = "kc-new-eats"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_name))
    error_message = "Use 3-31 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment label (tags and names)."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all AWS resources (the Snowflake account should be in the same region to avoid egress)."
  type        = string
  default     = "us-west-2"
}

variable "alert_emails" {
  description = "Email addresses subscribed to the alerts SNS topic (pipeline failures and AWS Budgets). Each must confirm the subscription email."
  type        = list(string)

  validation {
    condition     = length(var.alert_emails) > 0
    error_message = "Provide at least one alert email address."
  }
}

# ---------------------------------------------------------------------------
# S3 data bucket
# ---------------------------------------------------------------------------
variable "data_bucket_name" {
  description = "Globally unique name of the data bucket holding raw/, exports/ and dbt-artifacts/."
  type        = string
}

variable "raw_admin_principal_arns" {
  description = "IAM principal ARNs (e.g. the owner's admin role) exempt from the raw/ delete and overwrite deny. Wildcards allowed (ArnLike). Everyone else, including the pipeline roles, cannot delete or overwrite raw/."
  type        = list(string)

  validation {
    condition     = length(var.raw_admin_principal_arns) > 0
    error_message = "Provide at least one admin principal ARN, or nobody (including you) could clean up raw/."
  }
}

variable "raw_enforce_create_only" {
  description = "Deny PutObject on raw/ unless the request carries If-None-Match: * (S3 conditional write), so an existing raw file can never be overwritten. Requires the extractors to send IfNoneMatch='*' and treat HTTP 412 as already landed."
  type        = bool
  default     = true
}

variable "raw_transition_to_ia_days" {
  description = "Days after which raw/ objects move to STANDARD_IA. Objects under 128 KB are not transitioned (S3 default)."
  type        = number
  default     = 30
}

variable "raw_transition_to_glacier_ir_days" {
  description = "Days after which raw/ objects move to GLACIER_IR (millisecond reads, so replays still work)."
  type        = number
  default     = 90
}

variable "noncurrent_version_expiration_days" {
  description = "Days to keep superseded versions under exports/ and dbt-artifacts/ (both are overwritten each run). raw/ versions are never expired."
  type        = number
  default     = 30
}

variable "dated_exports_expiration_days" {
  description = "Days to keep exports/dt=*/ snapshots. 0 keeps them forever (each published build stays traceable)."
  type        = number
  default     = 0
}

# ---------------------------------------------------------------------------
# Lambda
# ---------------------------------------------------------------------------
variable "lambda_zip_path" {
  description = "Path to the ingestion deployment zip. Null means <repo>/ingestion/dist/lambda.zip."
  type        = string
  default     = null
}

variable "lambda_architecture" {
  description = "Lambda CPU architecture; must match any compiled wheels in the zip."
  type        = string
  default     = "x86_64"

  validation {
    condition     = contains(["x86_64", "arm64"], var.lambda_architecture)
    error_message = "lambda_architecture must be x86_64 or arm64."
  }
}

variable "kc_inspections_timeout_seconds" {
  description = "Timeout of the KC inspections extractor."
  type        = number
  default     = 300
}

variable "census_geocoder_timeout_seconds" {
  description = "Timeout of the Census geocoder Lambda (batch calls take about 1 minute per few thousand rows)."
  type        = number
  default     = 600
}

variable "dispatch_timeout_seconds" {
  description = "Timeout of the GitHub repository_dispatch Lambda."
  type        = number
  default     = 30
}

variable "kc_inspections_memory_mb" {
  description = "Memory for the KC inspections extractor (about 111k rows held in memory)."
  type        = number
  default     = 512
}

variable "census_geocoder_memory_mb" {
  description = "Memory for the Census geocoder Lambda."
  type        = number
  default     = 512
}

variable "dispatch_memory_mb" {
  description = "Memory for the dispatch Lambda."
  type        = number
  default     = 128
}

variable "log_level" {
  description = "LOG_LEVEL passed to every Lambda."
  type        = string
  default     = "INFO"

  validation {
    condition     = contains(["DEBUG", "INFO", "WARNING", "ERROR"], var.log_level)
    error_message = "log_level must be DEBUG, INFO, WARNING or ERROR."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for Lambda and Step Functions log groups."
  type        = number
  default     = 30
}

variable "socrata_app_token" {
  description = "Optional Socrata app token for the KC extractor (raises rate limits; not a credential to data). Empty means unset. Set via TF_VAR_socrata_app_token, never in a committed file."
  type        = string
  default     = ""
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
variable "schedule_expression" {
  description = "EventBridge Scheduler expression for the daily run."
  type        = string
  default     = "cron(0 6 * * ? *)"
}

variable "schedule_timezone" {
  description = "Time zone for schedule_expression."
  type        = string
  default     = "America/Los_Angeles"
}

variable "schedule_enabled" {
  description = "Whether the daily schedule is enabled. Set false to apply everything first and enable after a manual test run."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------
variable "github_repo" {
  description = "GitHub repository as owner/name; receives repository_dispatch and is trusted by the OIDC role."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must look like owner/name."
  }
}

variable "github_environment" {
  description = "GitHub Actions environment the pipeline job runs in; the OIDC role trusts only this environment."
  type        = string
  default     = "prod"
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC identity provider. Set false if the account already has one (it is account-wide)."
  type        = bool
  default     = true
}

variable "github_token_secret_recovery_days" {
  description = "Recovery window for the GitHub token secret on deletion (0 forces immediate deletion)."
  type        = number
  default     = 7
}

# ---------------------------------------------------------------------------
# AWS cost guardrail
# ---------------------------------------------------------------------------
variable "aws_monthly_budget_usd" {
  description = "Monthly AWS cost budget; alerts at 80% actual and 100% forecast."
  type        = number
  default     = 5
}

# ---------------------------------------------------------------------------
# Snowflake
# ---------------------------------------------------------------------------
variable "snowflake_organization_name" {
  description = "Snowflake organization name (from the account identifier <org>-<account>)."
  type        = string
}

variable "snowflake_account_name" {
  description = "Snowflake account name (from the account identifier <org>-<account>)."
  type        = string
}

variable "snowflake_name_prefix" {
  description = "Prefix for Snowflake account-level object names (warehouse, roles, integration, monitor)."
  type        = string
  default     = "KC_NEW_EATS"
}

variable "snowflake_database_name" {
  description = "Snowflake database name."
  type        = string
  default     = "KC_NEW_EATS"
}

variable "snowflake_monthly_budget_usd" {
  description = "Monthly Snowflake compute budget in USD that the resource monitor quota is sized from."
  type        = number
  default     = 10
}

variable "snowflake_credit_price_usd" {
  description = "Price per Snowflake credit for this account (on-demand list price: about 2 USD Standard, 3 USD Enterprise, varies by region). Check Admin > Billing."
  type        = number
  default     = 3

  validation {
    condition     = var.snowflake_credit_price_usd > 0
    error_message = "snowflake_credit_price_usd must be positive."
  }
}

variable "snowflake_credit_quota_override" {
  description = "Explicit monthly credit quota; null derives it as floor(monthly budget / credit price), minimum 1."
  type        = number
  default     = null
}

variable "snowflake_monitor_notify_users" {
  description = "Snowflake user names (with verified emails) notified by the resource monitor. Empty notifies account admins with notifications enabled."
  type        = list(string)
  default     = []
}

variable "snowflake_pipeline_user_rsa_public_key" {
  description = "RSA public key (PEM body, no header lines) of the GitHub Actions service user. Null skips creating the user."
  type        = string
  default     = null
}
