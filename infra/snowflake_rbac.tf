# Roles:
#   LOADER       COPY INTO tables in RAW from the raw stage. Owns RAW tables.
#   TRANSFORMER  dbt: reads RAW, builds STAGING/INTERMEDIATE/MARTS, creates
#                per-developer and per-PR schemas, unloads to the exports stage.
# Both roll up to SYSADMIN.

resource "snowflake_account_role" "loader" {
  provider = snowflake.securityadmin

  name    = local.sf_loader_role
  comment = "Loads RAW with COPY INTO from the raw S3 stage."
}

resource "snowflake_account_role" "transformer" {
  provider = snowflake.securityadmin

  name    = local.sf_transformer_role
  comment = "Runs dbt and the JSON export."
}

resource "snowflake_grant_account_role" "to_sysadmin" {
  provider = snowflake.securityadmin
  for_each = {
    loader      = snowflake_account_role.loader.name
    transformer = snowflake_account_role.transformer.name
  }

  role_name        = each.value
  parent_role_name = "SYSADMIN"
}

# --- Shared: warehouse and database usage ---------------------------------
locals {
  sf_pipeline_roles = {
    loader      = snowflake_account_role.loader.name
    transformer = snowflake_account_role.transformer.name
  }
}

resource "snowflake_grant_privileges_to_account_role" "warehouse_usage" {
  provider = snowflake.securityadmin
  for_each = local.sf_pipeline_roles

  account_role_name = each.value
  privileges        = ["USAGE"]

  on_account_object {
    object_type = "WAREHOUSE"
    object_name = snowflake_warehouse.main.name
  }
}

resource "snowflake_grant_privileges_to_account_role" "database_usage" {
  provider = snowflake.securityadmin
  for_each = local.sf_pipeline_roles

  account_role_name = each.value
  privileges        = ["USAGE"]

  on_account_object {
    object_type = "DATABASE"
    object_name = snowflake_database.main.name
  }
}

# --- Loader ----------------------------------------------------------------
resource "snowflake_grant_privileges_to_account_role" "loader_raw_schema" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.loader.name
  privileges        = ["USAGE", "CREATE TABLE"]

  on_schema {
    schema_name = snowflake_schema.this["RAW"].fully_qualified_name
  }
}

resource "snowflake_grant_privileges_to_account_role" "loader_raw_stage" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.loader.name
  privileges        = ["USAGE"]

  on_schema_object {
    object_type = "STAGE"
    object_name = snowflake_stage_external_s3.raw.fully_qualified_name
  }
}

resource "snowflake_grant_privileges_to_account_role" "loader_file_formats" {
  provider = snowflake.securityadmin
  for_each = {
    jsonl        = snowflake_file_format_json.jsonl.fully_qualified_name
    geocoder_csv = snowflake_file_format_csv.geocoder_csv.fully_qualified_name
  }

  account_role_name = snowflake_account_role.loader.name
  privileges        = ["USAGE"]

  on_schema_object {
    object_type = "FILE FORMAT"
    object_name = each.value
  }
}

# --- Transformer -----------------------------------------------------------
# CREATE SCHEMA: dbt dev (DEV_<NAME>_*) and ci (per-PR) schema prefixes.
resource "snowflake_grant_privileges_to_account_role" "transformer_create_schema" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["CREATE SCHEMA"]

  on_account_object {
    object_type = "DATABASE"
    object_name = snowflake_database.main.name
  }
}

resource "snowflake_grant_privileges_to_account_role" "transformer_raw_schema" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["USAGE"]

  on_schema {
    schema_name = snowflake_schema.this["RAW"].fully_qualified_name
  }
}

resource "snowflake_grant_privileges_to_account_role" "transformer_raw_tables_all" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["SELECT"]

  on_schema_object {
    all {
      object_type_plural = "TABLES"
      in_schema          = snowflake_schema.this["RAW"].fully_qualified_name
    }
  }
}

resource "snowflake_grant_privileges_to_account_role" "transformer_raw_tables_future" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["SELECT"]

  on_schema_object {
    future {
      object_type_plural = "TABLES"
      in_schema          = snowflake_schema.this["RAW"].fully_qualified_name
    }
  }
}

resource "snowflake_grant_privileges_to_account_role" "transformer_model_schemas" {
  provider = snowflake.securityadmin
  for_each = toset(["STAGING", "INTERMEDIATE", "MARTS"])

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["USAGE", "CREATE TABLE", "CREATE VIEW"]

  on_schema {
    schema_name = snowflake_schema.this[each.key].fully_qualified_name
  }
}

# Unloading to an external stage needs only USAGE on it.
resource "snowflake_grant_privileges_to_account_role" "transformer_exports_stage" {
  provider = snowflake.securityadmin

  account_role_name = snowflake_account_role.transformer.name
  privileges        = ["USAGE"]

  on_schema_object {
    object_type = "STAGE"
    object_name = snowflake_stage_external_s3.exports.fully_qualified_name
  }
}

# --- Service user for GitHub Actions (key-pair auth) ----------------------
# Created only when a public key is supplied. The private key lives only in
# the GitHub secret SNOWFLAKE_PRIVATE_KEY.
resource "snowflake_service_user" "pipeline" {
  provider = snowflake.securityadmin
  count    = var.snowflake_pipeline_user_rsa_public_key == null ? 0 : 1

  name                           = local.sf_pipeline_user_name
  comment                        = "GitHub Actions pipeline.yml (COPY INTO RAW, dbt, exports)."
  rsa_public_key                 = var.snowflake_pipeline_user_rsa_public_key
  default_role                   = snowflake_account_role.transformer.name
  default_warehouse              = snowflake_warehouse.main.name
  default_secondary_roles_option = "NONE"
}

resource "snowflake_grant_account_role" "pipeline_user" {
  provider = snowflake.securityadmin
  for_each = var.snowflake_pipeline_user_rsa_public_key == null ? {} : local.sf_pipeline_roles

  role_name = each.value
  user_name = snowflake_service_user.pipeline[0].name
}
