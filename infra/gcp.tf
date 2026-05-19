locals {
  required_apis = [
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
    "iap.googleapis.com",
    "billingbudgets.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each           = toset(local.required_apis)
  project            = var.gcp_project_id
  service            = each.key
  disable_on_destroy = false
}

# --- OpenTofu state bucket (created in bootstrap phase 1) ---
resource "google_storage_bucket" "tfstate" {
  name                        = var.tfstate_bucket_name
  location                    = var.gcp_region
  force_destroy               = false
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

# --- Service account for the brain VM ---
resource "google_service_account" "brain" {
  account_id   = "aifredo-brain"
  display_name = "AIfredo Brain VM"
}

resource "google_project_iam_member" "brain_logging" {
  project = var.gcp_project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.brain.email}"
}

resource "google_project_iam_member" "brain_metrics" {
  project = var.gcp_project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.brain.email}"
}

# --- Static external IP (free with always-free e2-micro) ---
resource "google_compute_address" "brain" {
  name   = "aifredo-brain-ip"
  region = var.gcp_region
}

# --- Generated secrets ---
resource "random_password" "brain_bearer" {
  length  = 48
  special = false
}

resource "random_password" "telegram_webhook_secret" {
  length  = 32
  special = false
}

# Passphrase used to encrypt CLI credential snapshots before uploading to GCS.
# Survives VM replacement because it lives in TF state, not on the VM disk —
# the new VM reads it from /opt/AIfredo/creds.key (re-rendered by startup
# script) and decrypts the snapshot pulled from GCS.
resource "random_password" "creds_passphrase" {
  length  = 48
  special = false
}

# 32-byte AES-256-GCM key for encrypting third-party integration tokens
# (Slack/Gmail/etc.) and admin_config secrets at rest in Supabase. Same key
# distributed to brain VM (via .env) and Vercel (via env var) — both consume
# via `packages/shared/src/crypto.ts`. Rotation invalidates all encrypted rows;
# recovery is re-OAuth + re-set admin_config.
resource "random_id" "integration_token_key" {
  byte_length = 32
}

# --- Credential snapshot bucket (encrypted; survives VM replacement) ---
resource "google_storage_bucket" "creds" {
  name                        = "${var.gcp_project_id}-aifredo-creds"
  location                    = var.gcp_region
  force_destroy               = false
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 10
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "creds_brain_rw" {
  bucket = google_storage_bucket.creds.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.brain.email}"
}

# --- Brain VM ---
resource "google_compute_instance" "brain" {
  name         = "aifredo-brain"
  machine_type = "e2-micro"
  zone         = var.gcp_zone
  tags         = ["aifredo-brain"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 30
      type  = "pd-standard"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.brain.address
    }
  }

  service_account {
    email = google_service_account.brain.email
    scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring.write",
      "https://www.googleapis.com/auth/devstorage.read_write",
    ]
  }

  metadata = {
    enable-oslogin = "TRUE"
    ssh-keys       = "aifredo:${var.ssh_pub_key}"
  }

  metadata_startup_script = templatefile("${path.module}/vm-startup.sh.tftpl", {
    tunnel_token              = cloudflare_zero_trust_tunnel_cloudflared.brain.tunnel_token
    repo_url                  = "https://github.com/${var.github_owner}/${var.github_repo_name}.git"
    brain_bearer_token        = random_password.brain_bearer.result
    supabase_url              = "https://${supabase_project.main.id}.supabase.co"
    supabase_service_role_key = data.supabase_apikeys.main.service_role_key
    vercel_ingest_url         = "${local.vercel_url}/api/ingest"
    domain                    = var.domain
    creds_bucket              = google_storage_bucket.creds.name
    creds_passphrase          = random_password.creds_passphrase.result
    ci_sa_unique_id           = google_service_account.ci_deployer.unique_id
    integration_token_key     = random_id.integration_token_key.b64_std
    binance_testnet_api_key    = var.binance_testnet_api_key
    binance_testnet_api_secret = var.binance_testnet_api_secret
    tiger_id                   = var.tiger_id
    tiger_private_key_b64      = var.tiger_private_key_b64
    tiger_paper_account        = var.tiger_paper_account
    tiger_live_account         = var.tiger_live_account
  })

  allow_stopping_for_update = true

  depends_on = [
    google_project_service.required,
    cloudflare_zero_trust_tunnel_cloudflared_config.brain,
    google_storage_bucket_iam_member.creds_brain_rw,
  ]
}

# --- Firewall: SSH only via Google IAP source range ---
resource "google_compute_firewall" "iap_ssh" {
  name    = "aifredo-allow-iap-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["aifredo-brain"]
}

# --- $0 budget with alerts at 1%, 50%, 100% ---
resource "google_billing_budget" "alert" {
  billing_account = var.gcp_billing_account
  display_name    = "AIfredo $0 budget"

  budget_filter {
    projects = ["projects/${var.gcp_project_id}"]
  }

  amount {
    specified_amount {
      units = "1"
    }
  }

  threshold_rules { threshold_percent = 0.01 }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 1.0 }
}
