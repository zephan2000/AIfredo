data "github_repository" "main" {
  full_name = "${var.github_owner}/${var.github_repo_name}"
}

locals {
  github_secrets = {
    SUPABASE_SERVICE_ROLE_KEY = data.supabase_apikeys.main.service_role_key
    SUPABASE_URL              = "https://${supabase_project.main.id}.supabase.co"
    BRAIN_VM_NAME             = google_compute_instance.brain.name
    BRAIN_VM_ZONE             = google_compute_instance.brain.zone
    BRAIN_BEARER_TOKEN        = random_password.brain_bearer.result
    TELEGRAM_BOT_TOKEN        = var.telegram_bot_token
    GCP_PROJECT_ID            = var.gcp_project_id
    AIFREDO_DOMAIN            = var.domain
    GCP_WIF_PROVIDER          = google_iam_workload_identity_pool_provider.github.name
    GCP_CI_SERVICE_ACCOUNT    = google_service_account.ci_deployer.email
  }
}

resource "github_actions_secret" "all" {
  for_each        = local.github_secrets
  repository      = data.github_repository.main.name
  secret_name     = each.key
  plaintext_value = each.value
}
