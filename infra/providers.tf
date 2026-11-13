provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# Snowflake authentication is never configured in code. Supply the user and
# key pair through the environment, for example:
#   SNOWFLAKE_USER, SNOWFLAKE_AUTHENTICATOR=SNOWFLAKE_JWT,
#   SNOWFLAKE_PRIVATE_KEY (or a profile in ~/.snowflake/config.toml)
# The Terraform user needs SYSADMIN, SECURITYADMIN and ACCOUNTADMIN.
locals {
  snowflake_preview_features = [
    "snowflake_file_format_csv_resource",
    "snowflake_file_format_json_resource",
    "snowflake_stage_external_s3_resource",
    "snowflake_storage_integration_aws_resource",
  ]
}

# Default: object creation (database, schemas, stages, file formats).
provider "snowflake" {
  organization_name        = var.snowflake_organization_name
  account_name             = var.snowflake_account_name
  role                     = "SYSADMIN"
  preview_features_enabled = local.snowflake_preview_features
}

# Account-level objects: resource monitor, warehouse (assigning a resource
# monitor requires ACCOUNTADMIN) and the storage integration.
provider "snowflake" {
  alias                    = "accountadmin"
  organization_name        = var.snowflake_organization_name
  account_name             = var.snowflake_account_name
  role                     = "ACCOUNTADMIN"
  preview_features_enabled = local.snowflake_preview_features
}

# Roles, users and grants.
provider "snowflake" {
  alias                    = "securityadmin"
  organization_name        = var.snowflake_organization_name
  account_name             = var.snowflake_account_name
  role                     = "SECURITYADMIN"
  preview_features_enabled = local.snowflake_preview_features
}
