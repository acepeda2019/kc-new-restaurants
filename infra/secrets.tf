# The secret container only. Its value (a fine-grained GitHub token with
# Contents: read and write on var.github_repo, needed for repository_dispatch)
# is set out of band so it never enters code or Terraform state:
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string "$TOKEN"
# Cost: about 0.40 USD per month.
resource "aws_secretsmanager_secret" "github_token" {
  name                    = "${local.name}/github-dispatch-token"
  description             = "GitHub token used by the dispatch Lambda to send repository_dispatch to ${var.github_repo}. Value set manually."
  recovery_window_in_days = var.github_token_secret_recovery_days
}
