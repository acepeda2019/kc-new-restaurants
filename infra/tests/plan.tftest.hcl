# Offline plan with a mocked AWS provider: no credentials, creates nothing.
mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  bucket_name = "kcne-raw-test"
  github_repo = "acepeda2019/kc-new-restaurants"
}

run "bucket_is_private_and_versioned" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.raw.versioning_configuration[0].status == "Enabled"
    error_message = "raw bucket must be versioned"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.raw.block_public_acls && aws_s3_bucket_public_access_block.raw.restrict_public_buckets
    error_message = "raw bucket must block public access"
  }
}

run "github_role_trusts_only_this_repo_main_and_dispatch" {
  command = plan

  assert {
    condition     = toset(local.github_subjects) == toset(["repo:acepeda2019/kc-new-restaurants:ref:refs/heads/main"])
    error_message = "GitHub role must trust only this repo's main branch"
  }
}
