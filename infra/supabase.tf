resource "supabase_project" "main" {
  organization_id   = var.supabase_org_id
  name              = "aifredo"
  database_password = var.supabase_db_password
  region            = var.supabase_region
}

data "supabase_apikeys" "main" {
  project_ref = supabase_project.main.id
}
