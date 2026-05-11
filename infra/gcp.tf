locals {
  required_apis = [
    "compute.googleapis.com",
    "iam.googleapis.com",
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
  })

  allow_stopping_for_update = true

  depends_on = [
    google_project_service.required,
    cloudflare_zero_trust_tunnel_cloudflared_config.brain,
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
      currency_code = "USD"
      units         = "1"
    }
  }

  threshold_rules { threshold_percent = 0.01 }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 1.0 }
}
