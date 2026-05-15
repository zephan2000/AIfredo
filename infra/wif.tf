# --- Workload Identity Federation for GitHub Actions ---
# Lets .github/workflows/deploy-brain.yml authenticate to GCP without a
# long-lived service-account key. The OIDC token GitHub mints for each
# workflow run is exchanged via STS for a short-lived SA credential.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "aifredo-gh"
  display_name              = "AIfredo GitHub Actions"
  description               = "WIF pool for AIfredo deploy workflows."
  depends_on                = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only tokens minted for this specific repo are accepted, even if another
  # repo somehow learns the provider name.
  attribute_condition = "assertion.repository == \"${var.github_owner}/${var.github_repo_name}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci_deployer" {
  account_id   = "aifredo-ci-deployer"
  display_name = "AIfredo CI deployer (GHA WIF)"
}

# Lets GHA tokens for this repo (and only this repo, per attribute_condition
# above) impersonate the deployer SA.
resource "google_service_account_iam_member" "github_wif_impersonation" {
  service_account_id = google_service_account.ci_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_owner}/${var.github_repo_name}"
}

# --- Permissions for the deployer SA on the brain VM ---

# SSH access via OS Login. Non-admin — sudo is granted by a narrow
# /etc/sudoers.d drop-in installed by vm-startup.sh.tftpl, scoped to the
# exact deploy commands the workflow runs.
resource "google_project_iam_member" "ci_deployer_oslogin" {
  project = var.gcp_project_id
  role    = "roles/compute.osLogin"
  member  = "serviceAccount:${google_service_account.ci_deployer.email}"
}

# Required to SSH into a VM whose attached SA is non-default.
resource "google_service_account_iam_member" "ci_deployer_uses_brain_sa" {
  service_account_id = google_service_account.brain.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci_deployer.email}"
}

# IAP TCP forwarding, scoped to the single brain instance.
# `instance` references by name (stable across replacement) but the underlying
# GCP IAM binding evaluates against the instance ID. When the VM is replaced
# (any vm-startup.sh.tftpl change), TF sees no diff here but the binding is
# orphaned. replace_triggered_by forces TF to recreate the binding whenever
# the instance ID changes.
resource "google_iap_tunnel_instance_iam_member" "ci_deployer_tunnel" {
  project  = var.gcp_project_id
  zone     = google_compute_instance.brain.zone
  instance = google_compute_instance.brain.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "serviceAccount:${google_service_account.ci_deployer.email}"

  lifecycle {
    replace_triggered_by = [google_compute_instance.brain.id]
  }
}
