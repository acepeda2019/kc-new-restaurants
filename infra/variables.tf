variable "aws_region" {
  description = "AWS region for the raw bucket."
  type        = string
  default     = "us-west-2"
}

variable "bucket_name" {
  description = "Name of the S3 bucket that holds raw/ (immutable source files) and exports/ (app JSON)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository (owner/name) whose main-branch workflows may assume the pipeline role."
  type        = string
}

variable "github_subject_repo" {
  description = "The repo as it appears in GitHub's OIDC sub claim, if it differs from github_repo (immutable subjects: \"owner@ownerId/name@repoId\"; see `gh api repos/OWNER/REPO/actions/oidc/customization/sub`)."
  type        = string
  default     = null
}

variable "create_github_oidc_provider" {
  description = "Create the account's GitHub OIDC provider. Set false if the account already has one."
  type        = bool
  default     = true
}
