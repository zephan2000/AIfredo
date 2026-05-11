#!/usr/bin/env bash
# AIfredo IaC bootstrap. Two-phase apply (state bucket first, then full).
set -euo pipefail

cd "$(dirname "$0")"

# --- Prereq checks ---
missing=0
for tool in tofu gcloud gh supabase pnpm jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: missing required tool: $tool" >&2
    missing=1
  fi
done
[[ $missing -eq 1 ]] && exit 1

if [[ ! -f terraform.tfvars ]]; then
  echo "ERROR: terraform.tfvars not found. Copy terraform.tfvars.example and fill it in." >&2
  exit 1
fi

tfvar() {
  grep -E "^$1[[:space:]]*=" terraform.tfvars | head -1 | sed -E 's/^[^=]+=[[:space:]]*"([^"]+)".*/\1/'
}

TFSTATE_BUCKET=$(tfvar tfstate_bucket_name)
GCP_PROJECT=$(tfvar gcp_project_id)

if [[ -z "$TFSTATE_BUCKET" || -z "$GCP_PROJECT" ]]; then
  echo "ERROR: tfstate_bucket_name or gcp_project_id missing from terraform.tfvars" >&2
  exit 1
fi

echo "==> [1/4] Bootstrap state bucket (local state)"
rm -rf .terraform .terraform.lock.hcl
tofu init -backend=false
tofu apply \
  -target=google_project_service.required \
  -target=google_storage_bucket.tfstate \
  -auto-approve

echo "==> [2/4] Migrate state to GCS"
tofu init -migrate-state -force-copy -backend-config="bucket=${TFSTATE_BUCKET}"

echo "==> [3/4] Full apply"
tofu apply -auto-approve

echo "==> [4/4] Apply Supabase migrations"
SUPABASE_REF=$(tofu output -raw supabase_ref)
pushd ../supabase >/dev/null
supabase link --project-ref "$SUPABASE_REF"
supabase db push
popd >/dev/null

VM_NAME=$(tofu output -raw vm_name)
VM_ZONE=$(tofu output -raw vm_zone)
BRAIN_URL=$(tofu output -raw brain_url)

cat <<MSG

==========================================================================
  Infrastructure provisioned.

  Next manual step — OAuth-login the CLIs on the brain VM:

    gcloud compute ssh ${VM_NAME} \\
      --tunnel-through-iap \\
      --zone ${VM_ZONE} \\
      --project ${GCP_PROJECT}

  Then on the VM:

    sudo -u aifredo bash
    claude login    # paste URL into a browser, paste code back
    codex login     # same flow
    exit
    sudo systemctl restart aifredo-brain.service

  Verify:

    curl ${BRAIN_URL}/health

==========================================================================
MSG
