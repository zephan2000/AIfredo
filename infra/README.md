# infra/

OpenTofu configuration that provisions all of AIfredo's cloud-side state.

## What gets created

| Provider | Resources |
|---|---|
| GCP | e2-micro VM (`aifredo-brain`), static external IP, service account, IAP-only SSH firewall, GCS state bucket, `$0` budget alert |
| Cloudflare | Zero Trust tunnel + ingress config, CNAME `brain.<domain>` → tunnel |
| Vercel | Project `aifredo-web` linked to this GitHub repo, all env vars |
| GitHub | Repository secrets for CI workflows |
| Supabase | Free-tier project in `us-west-1` |

The brain VM bootstrap (Node 20, both CLIs, swap, systemd units, Cloudflare Tunnel) runs from `vm-startup.sh.tftpl` as the GCE startup script.

## Usage

```sh
cp terraform.tfvars.example terraform.tfvars
# fill in values (gitignored)
./bootstrap.sh
```

`bootstrap.sh` does:

1. Local-state apply of just the GCS state bucket
2. `tofu init -migrate-state` to move state to GCS
3. Full `tofu apply`
4. Supabase migrations via `supabase db push`
5. Prints OAuth login instructions

OAuth login (Claude Code + Codex CLIs) must be done interactively on the VM — no provider can automate browser-based OAuth. The script prints the exact `gcloud compute ssh` command.

## Tear-down

```sh
tofu destroy
```

Will delete everything *except* the state bucket (which has `force_destroy = false` to prevent accidental loss). Empty and delete the bucket manually if you want a fully clean slate.

## Notes

- `terraform.tfvars` and `.terraform.lock.hcl` are gitignored.
- State is in GCS, versioned, last 30 versions retained.
- The `$1 USD` budget with thresholds at 1% / 50% / 100% will alert you the moment any non-free resource starts billing.
- IAP-only SSH means no public port 22 — use `gcloud compute ssh --tunnel-through-iap`.
