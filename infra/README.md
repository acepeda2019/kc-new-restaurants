# infra/

Terraform for King County New Eats (AWS + Snowflake), milestone 1. The
architecture and cost guardrails come from `docs/PROJECT_SPEC.md` sections 5
and 9. Only the owner runs `terraform apply`.

```
EventBridge Scheduler (daily)
  -> Step Functions: Extract [KC inspections] -> Geocode -> Dispatch
       any failure -> SNS alert -> Fail (no dispatch)
  -> GitHub repository_dispatch (pipeline_run) -> .github/workflows/pipeline.yml
       COPY INTO RAW -> dbt -> JSON export -> exports/latest/ -> Vercel deploy hook
```

## Layout

| Path | What |
|---|---|
| `bootstrap/` | One-off stack: the S3 bucket for Terraform state (local state) |
| `versions.tf`, `providers.tf` | Providers, S3 backend (partial config), three Snowflake role aliases |
| `variables.tf`, `locals.tf`, `outputs.tf` | Inputs, names/prefixes, outputs for GitHub variables |
| `s3.tf` | Data bucket: `raw/`, `exports/`, `dbt-artifacts/`; versioning, lifecycle, bucket policy |
| `lambda.tf` | Three Lambdas from one zip, per-function IAM roles and log groups |
| `orchestration.tf` | Step Functions state machine, its role, EventBridge Scheduler |
| `alerts.tf` | SNS alerts topic + email subscriptions, CloudWatch alarms |
| `secrets.tf` | Secrets Manager secret for the GitHub token (no value) |
| `budgets.tf` | AWS Budgets alert |
| `iam_github.tf` | GitHub Actions OIDC provider and pipeline role |
| `iam_snowflake.tf` | Role assumed by the Snowflake storage integration |
| `iam_vercel.tf` | Read-only IAM user for the Vercel build (no access key) |
| `snowflake.tf` | Resource monitor, warehouse, database, schemas, integration, stages, file formats |
| `snowflake_rbac.tf` | Loader and transformer roles, grants, optional service user |
| `sql/copy_into_raw.sql` | `COPY INTO` RAW, run by `pipeline.yml` |
| `scripts/` | `snow.sh` (key-pair `snow sql` wrapper), `export_marts.sh` (export, row-count checks, promote to `latest/`) |
| `tests/plan.tftest.hcl` | Offline `terraform test` with mocked providers (no credentials) |

## Least privilege at a glance

| Principal | Access |
|---|---|
| KC Lambda | `PutObject`/`GetObject`/`List` on `raw/kc_inspections/` |
| Geocoder Lambda | read `raw/kc_inspections/`; read/write `raw/census_geocoder/` |
| Dispatch Lambda | `secretsmanager:GetSecretValue` on the GitHub token secret only |
| State machine | invoke the three Lambdas, publish to the alerts topic, log delivery |
| Scheduler | `states:StartExecution` on the state machine |
| Snowflake integration role | read `raw/` and `exports/`; write/delete only `exports/` |
| GitHub OIDC role (`environment: prod` only) | read/write `dbt-artifacts/`; read `exports/`; write `exports/latest/`; publish alerts. No `raw/` |
| Vercel user | `GetObject`/`List` on `exports/latest/` only |
| Bucket policy | TLS only; nobody except `raw_admin_principal_arns` may delete or overwrite in `raw/` |

## Cost-relevant settings

- Snowflake: one XSMALL warehouse, `auto_suspend = 60`, initially suspended,
  statement timeout 30 min. Resource monitor quota =
  `floor(snowflake_monthly_budget_usd / snowflake_credit_price_usd)` credits a
  month. **Assumption:** 10 USD at 3 USD/credit (on-demand Enterprise, the
  usual trial edition) = 3 credits, about 3 XS-hours a month. On Standard
  (about 2 USD/credit) set `snowflake_credit_price_usd = 2` for 5 credits.
  Notify at 75%, suspend at 100%, suspend immediately at 110%. The monitor is
  attached to this warehouse; it does not cover cloud services, serverless
  features or other warehouses (suspend or drop a trial `COMPUTE_WH`).
- AWS: Budgets alert (default 5 USD, 80% actual and 100% forecast) to the
  alerts topic. Lambda, Step Functions (STANDARD, about 10 transitions a
  day), Scheduler, SNS and CloudWatch stay within free-tier-scale use. The
  Secrets Manager secret costs about 0.40 USD a month. S3 uses SSE-S3 (no KMS
  charges); `raw/` moves to STANDARD_IA at 30 days and GLACIER_IR at 90.
- Nothing scales with site traffic: the app is static and reads S3 only at
  build time.

## Apply order (owner only)

Prerequisites: Terraform >= 1.10, AWS credentials for an admin principal, and
a Snowflake user with SYSADMIN, SECURITYADMIN and ACCOUNTADMIN using key-pair
auth via environment variables (`SNOWFLAKE_USER`,
`SNOWFLAKE_AUTHENTICATOR=SNOWFLAKE_JWT`, `SNOWFLAKE_PRIVATE_KEY`) or
`~/.snowflake/config.toml`. Nothing about Snowflake auth is in code.

1. **Bootstrap the state bucket** (once):
   ```sh
   cd infra/bootstrap
   cp terraform.tfvars.example terraform.tfvars   # fill in
   terraform init && terraform plan -out tfplan && terraform apply tfplan
   ```
2. **Configure the backend:** `cp infra/backend.hcl.example infra/backend.hcl`
   and set `bucket` to the bootstrap output.
3. **Build the Lambda zip** (`ingestion/dist/lambda.zip`; see `ingestion/`).
4. **Main stack:**
   ```sh
   cd infra
   cp terraform.tfvars.example terraform.tfvars   # fill in; keep schedule_enabled = false at first
   terraform init -backend-config=backend.hcl
   terraform plan -out tfplan && terraform apply tfplan
   ```
5. Do the manual steps below, start one execution by hand, then set
   `schedule_enabled = true` and apply again.

Offline checks (no credentials): `terraform fmt -check -recursive`,
`terraform init -backend=false`, `terraform validate`, `terraform test`.

## Manual steps

1. **Confirm the SNS email subscription(s)** (AWS sends a confirmation email).
2. **GitHub token secret value.** Create a fine-grained token limited to this
   repository with *Contents: read and write* (required for
   `repository_dispatch`), then:
   ```sh
   aws secretsmanager put-secret-value \
     --secret-id "$(terraform output -raw github_token_secret_arn)" \
     --secret-string "$GITHUB_TOKEN_VALUE"
   ```
   Do not paste the token on a command line that is saved in shell history.
3. **Snowflake storage integration trust round-trip.** Normally automated:
   Terraform sets the integration's external ID and reads Snowflake's IAM user
   ARN back into the role's trust policy in the same apply. Verify with
   `DESC INTEGRATION <name>` (`STORAGE_AWS_IAM_USER_ARN`,
   `STORAGE_AWS_EXTERNAL_ID`) against the role's trust policy, then
   `LIST @<db>.RAW.RAW_S3_STAGE;`. If the integration is ever recreated
   outside Terraform, run `terraform apply` again so the trust policy picks up
   the new values. IAM changes can take a minute to propagate; retry the
   `LIST` once if it fails right after the first apply.
4. **Snowflake service user for GitHub Actions.** Generate a key pair
   locally, set `snowflake_pipeline_user_rsa_public_key` and apply. Store the
   private key only as the GitHub secret `SNOWFLAKE_PRIVATE_KEY`.
5. **Vercel read-only key.** Terraform creates the user and policy but no
   access key, so no secret is stored in state:
   ```sh
   aws iam create-access-key --user-name "$(terraform output -raw vercel_build_user_name)"
   ```
   Put the key only in server-side Vercel env vars (never `NEXT_PUBLIC_*`) and
   delete the local copy. Rotate with a second key, then delete the old one.
6. **GitHub environment `prod`** (Settings > Environments) with:
   - variables: `AWS_REGION`, `AWS_PIPELINE_ROLE_ARN`
     (`github_pipeline_role_arn`), `DATA_BUCKET`, `ALERTS_TOPIC_ARN`,
     `SNOWFLAKE_DATABASE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_LOADER_ROLE`,
     `SNOWFLAKE_TRANSFORMER_ROLE` (see `terraform output snowflake_objects`)
   - secrets: `SNOWFLAKE_ACCOUNT` (`<org>-<account>`), `SNOWFLAKE_USER`,
     `SNOWFLAKE_PRIVATE_KEY`, `VERCEL_DEPLOY_HOOK_URL`
   The OIDC role trusts only `repo:<owner>/<repo>:environment:prod`.
7. **GitHub Pages** source "GitHub Actions" (for dbt docs; once dbt exists).
8. **Optional Socrata app token:** `export TF_VAR_socrata_app_token=...`
   before plan/apply. It is stored in the KC Lambda's environment and in
   state (it is a rate-limit token, not a data credential).

## Contract with `ingestion/`

- Zip `ingestion/dist/lambda.zip` (`lambda_zip_path`), runtime python3.12,
  handlers `handlers.kc_inspections.handler`,
  `handlers.census_geocoder.handler`, `handlers.dispatch.handler`.
- Env: `RAW_BUCKET`, `GITHUB_REPO`, `GITHUB_TOKEN_SECRET_ARN`, `LOG_LEVEL` on
  all three; `SOCRATA_APP_TOKEN` on the KC extractor only, and only if set.
- Events: execution input (from the scheduler: `trigger`, `scheduled_time`,
  `scheduler_execution_id`) goes to KC; KC's return value goes verbatim to the
  geocoder; dispatch receives
  `{"kc_inspections": <KC output>, "census_geocoder": <geocoder output>}`.
  Keep return values small (Step Functions payload limit 256 KB).
- Retries: Lambda service errors 3x with backoff; any handler exception once
  more after 2 minutes (dispatch: twice after 30 s). Handlers must therefore
  be idempotent.
- Raw writes: with `raw_enforce_create_only = true` (default), every
  `PutObject` under `raw/` must send `IfNoneMatch="*"` and treat HTTP 412 as
  "already landed". Overwrites and deletes are denied for the pipeline.
- Raw paths and names expected by `sql/copy_into_raw.sql`:
  `raw/kc_inspections/dt=YYYY-MM-DD/<run_id>.jsonl[.gz]` and
  `raw/census_geocoder/dt=YYYY-MM-DD/<run_id>_<chunk>.csv` (sidecar
  `.request.csv` / `.manifest.json` files are not loaded).
