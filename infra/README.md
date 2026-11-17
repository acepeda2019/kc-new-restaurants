# infra/

Terraform for the King County New Eats MVP. Only the owner runs `terraform apply`.

The MVP needs two cloud resources (see `ARCHITECTURE.md` §8):

| Resource | Purpose |
|---|---|
| S3 bucket (`var.bucket_name`) | `raw/`: immutable, write-once source files (KC inspections, Census geocodes, Claude classifications). Versioned, private, encrypted. The app's JSON is baked into each Vercel deploy, not stored here. |
| IAM role `kc-new-eats-github-pipeline` | Assumed by GitHub Actions (OIDC) on this repo's `main` branch, i.e. the daily scheduled run and manual `workflow_dispatch`. Read/write objects and list the bucket. |

Bucket policy: every write under `raw/` must carry `If-None-Match: *` (create-only, which the
extractors always send), the pipeline role can never delete under `raw/`, and plain HTTP is refused.

## Layout

| Path | What |
|---|---|
| `bootstrap/` | One-off stack: the S3 bucket for Terraform state (local state) |
| `versions.tf` | Terraform/provider versions, S3 backend (partial config), AWS provider |
| `variables.tf`, `outputs.tf` | Inputs; outputs to copy into GitHub repository variables |
| `main.tf` | Bucket, bucket policy, GitHub OIDC provider and role |
| `tests/plan.tftest.hcl` | Offline `terraform test` with a mocked provider (no credentials) |

## Apply (owner only)

1. `cd infra/bootstrap && terraform init && terraform apply` (state bucket, once).
2. `cp backend.hcl.example backend.hcl` and fill it in; create `terraform.tfvars` with
   `bucket_name` and `github_repo` (set `create_github_oidc_provider = false` if the
   account already has a GitHub OIDC provider).
3. `cd infra && terraform init -backend-config=backend.hcl && terraform plan && terraform apply`.
4. Copy the outputs into GitHub: `RAW_BUCKET` and `AWS_ROLE_ARN` as repository variables.

## Checks

`terraform fmt -check`, `terraform validate` and `terraform test` run on every PR that
touches `infra/` (`.github/workflows/terraform.yml`), with no cloud credentials.
