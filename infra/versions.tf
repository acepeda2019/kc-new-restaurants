terraform {
  # >= 1.10 for S3-native state locking (use_lockfile) without DynamoDB.
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
  }

  # Partial configuration: bucket, key and region come from backend.hcl
  # (see backend.hcl.example) via `terraform init -backend-config=backend.hcl`.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = { project = "kc-new-eats", managed_by = "terraform" }
  }
}
