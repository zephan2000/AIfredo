output "vm_external_ip" {
  description = "Static external IP of the brain VM."
  value       = google_compute_address.brain.address
}

output "vm_name" {
  description = "GCE VM instance name."
  value       = google_compute_instance.brain.name
}

output "vm_zone" {
  description = "GCE zone of the VM."
  value       = google_compute_instance.brain.zone
}

output "brain_url" {
  description = "Public URL of the brain via Cloudflare Tunnel."
  value       = "https://agent.${var.domain}"
}

output "vercel_url" {
  description = "Vercel deployment URL."
  value       = local.vercel_url
}

output "mcp_issuer_url" {
  description = "MCP OAuth 2.1 issuer URL (Streamable HTTP)."
  value       = "${local.vercel_url}/api/mcp"
}

output "supabase_ref" {
  description = "Supabase project reference."
  value       = supabase_project.main.id
}

output "supabase_url" {
  description = "Supabase API URL."
  value       = "https://${supabase_project.main.id}.supabase.co"
}

output "tfstate_bucket" {
  description = "GCS bucket holding OpenTofu state."
  value       = google_storage_bucket.tfstate.name
}

output "telegram_webhook_secret" {
  description = "Shared secret Telegram includes in X-Telegram-Bot-Api-Secret-Token. Used during setWebhook registration."
  value       = random_password.telegram_webhook_secret.result
  sensitive   = true
}

output "creds_bucket" {
  description = "GCS bucket holding encrypted CLI credential snapshots. New VMs restore from here on boot."
  value       = google_storage_bucket.creds.name
}

output "wif_provider_name" {
  description = "Full resource name of the GitHub Actions WIF provider. Used as workload_identity_provider in google-github-actions/auth@v2."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "ci_service_account_email" {
  description = "Email of the SA that GHA tokens impersonate via WIF."
  value       = google_service_account.ci_deployer.email
}
