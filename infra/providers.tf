terraform {
  required_version = ">= 1.7.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.10"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.45"
    }
    vercel = {
      source  = "vercel/vercel"
      version = "~> 2.1"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.3"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project               = var.gcp_project_id
  region                = var.gcp_region
  zone                  = var.gcp_zone
  billing_project       = var.gcp_project_id
  user_project_override = true
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "vercel" {
  api_token = var.vercel_api_token
}

provider "github" {
  owner = var.github_owner
  token = var.github_token
}

provider "supabase" {
  access_token = var.supabase_access_token
}
