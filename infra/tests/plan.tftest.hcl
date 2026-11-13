# Offline plan test: every provider is mocked, so this needs no AWS or
# Snowflake credentials and creates nothing. Run from infra/:
#   terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

mock_provider "random" {}

mock_provider "snowflake" {}

mock_provider "snowflake" {
  alias = "securityadmin"
}

mock_provider "snowflake" {
  alias = "accountadmin"

  mock_resource "snowflake_storage_integration_aws" {
    defaults = {
      describe_output = [{
        allowed_locations        = []
        blocked_locations        = []
        comment                  = ""
        enabled                  = true
        external_id              = "mock-external-id"
        iam_user_arn             = "arn:aws:iam::999999999999:user/mock-snowflake"
        id                       = "mock"
        object_acl               = ""
        provider                 = "S3"
        role_arn                 = "arn:aws:iam::123456789012:role/mock"
        use_privatelink_endpoint = false
      }]
    }
  }
}

# Make the ARNs the state machine definition depends on known at plan time.
override_resource {
  target          = aws_lambda_function.this
  override_during = plan
  values = {
    arn = "arn:aws:lambda:us-west-2:123456789012:function:mock"
  }
}

override_resource {
  target          = aws_sns_topic.alerts
  override_during = plan
  values = {
    arn = "arn:aws:sns:us-west-2:123456789012:mock-alerts"
  }
}

variables {
  data_bucket_name            = "example-data-bucket"
  alert_emails                = ["alerts@example.com"]
  raw_admin_principal_arns    = ["arn:aws:iam::123456789012:role/admin"]
  github_repo                 = "example-owner/example-repo"
  snowflake_organization_name = "EXAMPLEORG"
  snowflake_account_name      = "EXAMPLEACCT"
  lambda_zip_path             = "tests/fixtures/fake-lambda.zip"
}

run "plan_defaults" {
  command = plan

  assert {
    condition     = snowflake_warehouse.main.warehouse_size == "XSMALL" && snowflake_warehouse.main.auto_suspend == 60
    error_message = "Warehouse must be XSMALL with auto_suspend = 60."
  }

  assert {
    condition     = snowflake_warehouse.main.resource_monitor == snowflake_resource_monitor.monthly.name
    error_message = "Warehouse must be attached to the resource monitor."
  }

  assert {
    condition     = snowflake_resource_monitor.monthly.credit_quota == 3
    error_message = "Default quota should be floor(10 USD / 3 USD) = 3 credits."
  }

  assert {
    condition     = snowflake_resource_monitor.monthly.suspend_trigger == 100 && contains(tolist(snowflake_resource_monitor.monthly.notify_triggers), 75)
    error_message = "Monitor must notify at 75% and suspend at 100%."
  }

  assert {
    condition = alltrue([for k, fn in aws_lambda_function.this : fn.runtime == "python3.12"]) && (
      aws_lambda_function.this["kc_inspections"].handler == "handlers.kc_inspections.handler" &&
      aws_lambda_function.this["census_geocoder"].handler == "handlers.census_geocoder.handler" &&
      aws_lambda_function.this["dispatch"].handler == "handlers.dispatch.handler"
    )
    error_message = "Lambda runtime and handlers must match the ingestion contract."
  }

  assert {
    condition     = aws_lambda_function.this["kc_inspections"].timeout == 300 && aws_lambda_function.this["census_geocoder"].timeout == 600
    error_message = "KC timeout 5 min, geocoder 10 min."
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.this["kc_inspections"].environment[0].variables), "SOCRATA_APP_TOKEN")
    error_message = "SOCRATA_APP_TOKEN must be omitted when the variable is empty."
  }

  assert {
    condition     = jsondecode(aws_sfn_state_machine.pipeline.definition).StartAt == "Extract"
    error_message = "State machine must start with the extract step."
  }

  assert {
    condition     = jsondecode(aws_sfn_state_machine.pipeline.definition).States.GeocodeAddresses.Next == "DispatchPipeline"
    error_message = "Dispatch must follow the geocode step."
  }

  assert {
    condition     = jsondecode(aws_sfn_state_machine.pipeline.definition).States.Extract.Catch[0].Next == "NotifyFailure"
    error_message = "Extract failures must go to NotifyFailure, never to dispatch."
  }

  assert {
    condition     = length(snowflake_storage_integration_aws.s3.storage_allowed_locations) == 2
    error_message = "Storage integration must allow exactly raw/ and exports/."
  }
}

run "socrata_token_only_on_kc" {
  command = plan

  variables {
    socrata_app_token = "dummy-token"
  }

  assert {
    condition     = contains(keys(aws_lambda_function.this["kc_inspections"].environment[0].variables), "SOCRATA_APP_TOKEN")
    error_message = "KC extractor should get SOCRATA_APP_TOKEN when set."
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.this["census_geocoder"].environment[0].variables), "SOCRATA_APP_TOKEN")
    error_message = "Only the KC extractor should get SOCRATA_APP_TOKEN."
  }
}
