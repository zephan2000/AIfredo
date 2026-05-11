locals {
  vercel_project_name = "aifredo-web"
  vercel_url          = "https://${local.vercel_project_name}.vercel.app"

  vercel_env = {
    SUPABASE_URL = {
      value     = "https://${supabase_project.main.id}.supabase.co"
      sensitive = false
      target    = ["production", "preview", "development"]
    }
    SUPABASE_ANON_KEY = {
      value     = data.supabase_apikeys.main.anon_key
      sensitive = true
      target    = ["production", "preview", "development"]
    }
    SUPABASE_SERVICE_ROLE_KEY = {
      value     = data.supabase_apikeys.main.service_role_key
      sensitive = true
      target    = ["production", "preview"]
    }
    TELEGRAM_BOT_TOKEN = {
      value     = var.telegram_bot_token
      sensitive = true
      target    = ["production", "preview"]
    }
    TELEGRAM_WEBHOOK_SECRET = {
      value     = random_password.telegram_webhook_secret.result
      sensitive = true
      target    = ["production", "preview"]
    }
    BRAIN_URL = {
      value     = "https://brain.${var.domain}"
      sensitive = false
      target    = ["production", "preview", "development"]
    }
    BRAIN_BEARER_TOKEN = {
      value     = random_password.brain_bearer.result
      sensitive = true
      target    = ["production", "preview"]
    }
    MCP_ISSUER_URL = {
      value     = "${local.vercel_url}/api/mcp"
      sensitive = false
      target    = ["production", "preview"]
    }
    ADMIN_TELEGRAM_USER_ID = {
      value     = var.admin_telegram_user_id
      sensitive = false
      target    = ["production", "preview", "development"]
    }
  }
}

resource "vercel_project" "web" {
  name      = local.vercel_project_name
  framework = "nextjs"
  team_id   = var.vercel_team_id

  git_repository = {
    type              = "github"
    repo              = "${var.github_owner}/${var.github_repo_name}"
    production_branch = "main"
  }

  root_directory   = "apps/web"
  install_command  = "cd ../.. && pnpm install --frozen-lockfile"
  build_command    = "cd ../.. && pnpm --filter web build"
  output_directory = ".next"
}

resource "vercel_project_environment_variable" "all" {
  for_each   = local.vercel_env
  project_id = vercel_project.web.id
  team_id    = var.vercel_team_id
  key        = each.key
  value      = each.value.value
  target     = each.value.target
  sensitive  = each.value.sensitive
}
