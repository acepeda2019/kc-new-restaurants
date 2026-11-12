terraform {
  # >= 1.10 for S3-native state locking (use_lockfile) without DynamoDB.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
    # The provider formerly published as Snowflake-Labs/snowflake (last
    # release 1.0.5) is now published as snowflakedb/snowflake.
    snowflake = {
      source  = "snowflakedb/snowflake"
      version = "~> 2.23"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # Partial configuration: bucket, key and region come from backend.hcl
  # (see backend.hcl.example) via `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}
