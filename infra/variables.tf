# --- General ---
variable "domain" {
  description = "Apex domain managed in Cloudflare DNS. Tunnel publishes at agent.<domain>."
  type        = string
}

# --- GCP ---
variable "gcp_project_id" {
  description = "Pre-existing GCP project ID. Create with `gcloud projects create` first."
  type        = string
}

variable "gcp_region" {
  description = "GCP region. Free tier e2-micro requires us-west1, us-central1, or us-east1."
  type        = string
  default     = "us-west1"
}

variable "gcp_zone" {
  description = "GCP zone within the region."
  type        = string
  default     = "us-west1-a"
}

variable "gcp_billing_account" {
  description = "Billing account ID (e.g., 012345-ABCDEF-GHIJKL) linked to the project."
  type        = string
}

variable "tfstate_bucket_name" {
  description = "GCS bucket for OpenTofu state. Must be globally unique."
  type        = string
}

variable "ssh_pub_key" {
  description = "SSH public key authorized for the brain VM (used through IAP)."
  type        = string
}

# --- Cloudflare ---
variable "cloudflare_account_id" {
  description = "Cloudflare account ID."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the domain."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token. Required perms: Zone:DNS:Edit, Account:Cloudflare Tunnel:Edit."
  type        = string
  sensitive   = true
}

# --- Vercel ---
variable "vercel_api_token" {
  description = "Vercel API token (https://vercel.com/account/tokens)."
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "Vercel team ID (null for personal account)."
  type        = string
  default     = null
}

# --- GitHub ---
variable "github_owner" {
  description = "GitHub user or organization that owns the repo."
  type        = string
}

variable "github_token" {
  description = "GitHub PAT with `repo` + `workflow` scopes."
  type        = string
  sensitive   = true
}

variable "github_repo_name" {
  description = "GitHub repository name."
  type        = string
  default     = "AIfredo"
}

# --- Supabase ---
variable "supabase_access_token" {
  description = "Supabase personal access token (https://supabase.com/dashboard/account/tokens)."
  type        = string
  sensitive   = true
}

variable "supabase_org_id" {
  description = "Supabase organization slug or ID where the project is created."
  type        = string
}

variable "supabase_db_password" {
  description = "Password for the Supabase Postgres superuser."
  type        = string
  sensitive   = true
}

variable "supabase_region" {
  description = "Supabase project region. Co-located with brain VM."
  type        = string
  default     = "us-west-1"
}

# --- Telegram ---
variable "telegram_bot_token" {
  description = "Telegram bot token from @BotFather."
  type        = string
  sensitive   = true
}

variable "admin_telegram_user_id" {
  description = "Numeric Telegram user ID of the admin (day-1 seed user)."
  type        = string
}

# --- Binance (testnet first; trade-only, never withdrawal) ---
variable "binance_testnet_api_key" {
  description = "Binance USD-M Futures TESTNET API key (testnet.binancefuture.com). Live keys are a later, separately-scoped step."
  type        = string
  sensitive   = true
}

variable "binance_testnet_api_secret" {
  description = "Binance USD-M Futures TESTNET API secret."
  type        = string
  sensitive   = true
}

# --- Tiger Brokers (paper account = testnet-equivalent; trade-only) ---
# One developer ID + RSA key serves both accounts; mode picks the account.
# tiger_paper_account is the simulation account (used when mode=testnet),
# tiger_live_account the real one (used only when mode=live AND armed).
variable "tiger_id" {
  description = "Tiger Open API developer ID (tiger_id)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tiger_private_key_b64" {
  description = "Tiger Open API RSA private key, PEM, base64-encoded (single-line). Decoded on the VM into TIGER_PRIVATE_KEY_B64."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tiger_paper_account" {
  description = "Tiger paper/simulation account id (testnet-equivalent)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "tiger_live_account" {
  description = "Tiger live account id. Leave empty until live trading is separately armed."
  type        = string
  sensitive   = true
  default     = ""
}
