# Self-hosting AIfredo

Deployment guide for a single-operator AIfredo hub. Free-tier only; tested on macOS host with Linux VM. Every step lists the edge case to expect — read those first if an AI agent is driving.

## Reading this with an agent

Hand your agent this file plus [CLAUDE.md](../CLAUDE.md). The "⚠" callouts inline are real traps from prior deploys; have the agent verify each one as it goes, don't skip them.

---

## Phase A — Accounts & local tools (one-time, manual)

You need these accounts active before any command runs. All free tier:

- **GCP** with a billing account attached (credit card required even for `$0`; budget alert at 1%/50%/100% is provisioned)
- **Cloudflare** with your domain's nameservers already pointed at Cloudflare DNS — verify with `dig +short NS yourdomain.com` (must show `*.ns.cloudflare.com.`)
- **Vercel** (personal plan)
- **GitHub** (fork or own this repo)
- **Supabase** — note: free tier caps at 2 active projects per org
- **Telegram** (you'll create a bot)
- **Claude Pro/Max** subscription
- **ChatGPT Plus/Pro** subscription

Local tools:

```sh
brew install opentofu supabase/tap/supabase gh pnpm jq
# Do NOT install gcloud via brew --cask gcloud-cli — its virtualenv setup
# fails on recent macOS. Use Google's tarball instead:
cd ~ && curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
tar -xf google-cloud-cli-darwin-arm.tar.gz
./google-cloud-sdk/install.sh --quiet --path-update true
exec -l zsh
```

⚠ **zsh interactive_comments is off by default.** Pasting commands with `# comments` (especially comments containing apostrophes like `we'll`) will produce parse errors. Either run `echo 'setopt interactive_comments' >> ~/.zshrc && exec -l zsh`, or strip comments from anything you paste.

Auth:

```sh
gcloud auth login
gcloud auth application-default login
```

---

## Phase B — Pre-provision (one-time, ~15 min)

These produce the values that go into `infra/terraform.tfvars`. Do them in this order; later steps need earlier ones.

### B1. GCP project

```sh
PROJECT_ID="aifredo-<your-suffix>"   # globally unique, 6-30 chars, lowercase, no underscores
gcloud projects create "$PROJECT_ID" --name="AIfredo"
gcloud billing accounts list                          # copy ACCOUNT_ID
gcloud beta billing projects link "$PROJECT_ID" --billing-account=<ACCOUNT_ID>
gcloud config set project "$PROJECT_ID"
gcloud auth application-default set-quota-project "$PROJECT_ID"
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com cloudbilling.googleapis.com
```

⚠ The last `gcloud services enable` is critical. `google_project_service` resources in TF need Cloud Resource Manager API to *already* be on — chicken-and-egg. Without this the apply fails with `SERVICE_DISABLED`.

⚠ `set-quota-project` is needed so the `google_billing_budget` TF resource can call billingbudgets with the right billing context (also requires `user_project_override = true` on the provider, already set in [infra/providers.tf](../infra/providers.tf)).

### B2. State bucket name & SSH key

```sh
echo "aifredo-tfstate-$(openssl rand -hex 4)"        # save this
ssh-keygen -t ed25519 -C aifredo -f ~/.ssh/aifredo_ed25519 -N ""
cat ~/.ssh/aifredo_ed25519.pub                       # save the full single line
```

⚠ The state bucket has `force_destroy = false` and survives `tofu destroy`. Name it intentionally; you cannot reuse the name after destroy unless you empty + delete the bucket manually.

### B3. Cloudflare token (browser)

dash.cloudflare.com → pick your zone → right sidebar copies **Account ID** and **Zone ID**. Then My Profile → API Tokens → **Create Custom Token**:

- Name: `aifredo-tofu`
- Permissions: `Zone:DNS:Edit` (scoped to your zone) + `Account:Cloudflare Tunnel:Edit` (scoped to your account)
- TTL: 1 year

⚠ Do **not** use the Global API Key. Custom token only.
⚠ Do **not** pre-create the `agent.<domain>` CNAME — TF makes it ([infra/cloudflare.tf](../infra/cloudflare.tf)).

### B4. Other secrets

- **Vercel**: vercel.com/account/tokens → **Full Account** scope, 1 year
- **GitHub PAT**: github.com/settings/tokens → **classic** with `repo` + `workflow` scopes (fine-grained doesn't cover all repo-secret ops)
- **Supabase PAT**: supabase.com/dashboard/account/tokens
- **Supabase org slug**: dashboard URL `https://supabase.com/dashboard/org/<slug>` ← that's your `supabase_org_id`
- **Supabase DB password**: `openssl rand -base64 24` ← save it; rotating it requires rebuilding the project
- **Telegram bot**: @BotFather → `/newbot` (username must end in `bot`)
- **Your Telegram user ID**: @userinfobot → `/start` ← double-check; a typo here locks you out

⚠ Supabase `organization_id` is the **org**, not a project. If your org and a project share a name, the slugs differ — verify with:
```sh
SUPABASE_PAT=<paste-from-pwmgr> curl -s https://api.supabase.com/v1/organizations -H "Authorization: Bearer $SUPABASE_PAT"
```

### B5. Fill tfvars

```sh
cd ~/Projects/AIfredo/infra
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
git check-ignore terraform.tfvars                    # MUST print the path
grep -cE '^\s*[a-z_]+\s*=\s*"redacted"' terraform.tfvars   # MUST print 0
```

⚠ If `git check-ignore` is silent, **stop** — your secrets would be committed.

⚠ Region trade-off: brain VM is fixed to `us-west1` (free tier). `supabase_region = "us-west-1"` colocates DB; `ap-southeast-*` puts the DB closer to your laptop but cross-Pacific from the VM. Region **cannot be changed** after creation.

---

## Phase C — Provision (10–15 min)

```sh
./bootstrap.sh
```

What it does:
1. Disables the gcs backend file (`mv backend.tf backend.tf.disabled`) so the state bucket itself can be provisioned with local state
2. Migrates state to the new GCS bucket
3. Full apply (VM, tunnel, DNS, Vercel project, Supabase project, GitHub secrets, env vars)
4. Applies Supabase migrations

The script is idempotent. If the state bucket already exists, it skips phases 1-2 and inits directly against GCS.

⚠ **If init prompts: "Do you want to overwrite the state in the new backend with the previous state?"** — answer **`no`**. Answering `yes` overwrites the remote state with whatever leftover local state you have (from a prior failed run) and TF loses track of all your real resources. Recovery is possible because the bucket has versioning enabled (see Recovery below), but avoid it.

⚠ **Currency**: the `google_billing_budget` resource omits `currency_code` so it inherits your billing account's currency. Don't hardcode USD if your account is SGD/EUR/etc — the API returns an unhelpful 400.

⚠ **VM `metadata_startup_script` change forces replacement.** Any future edit to [vm-startup.sh.tftpl](../infra/vm-startup.sh.tftpl) destroys the VM and creates a new one. **First-time deploys lose OAuth on replacement.** After Phase E.5 below, replacements auto-restore creds from the GCS snapshot bucket — no manual re-OAuth.

### Common Phase-C errors & fixes

| Error | Cause | Fix |
|---|---|---|
| `Error 403: Cloud Resource Manager API has not been used` | CRM not enabled | re-run `gcloud services enable cloudresourcemanager.googleapis.com` (Phase B1) |
| `Error 400: Request contains an invalid argument` on `google_billing_budget` | currency mismatch | already fixed in source; ensure you're on latest |
| `unexpected error: BAD_REQUEST - You cannot set a Sensitive Environment Variable's target to development` | Vercel rule | already fixed; sensitive vars target `production,preview` only |
| `Module not found: Can't resolve './types.js'` in Vercel build | `packages/shared` exporting with `.js` suffixes in Bundler mode | already fixed |
| `Error: Node.js 20 detected without native WebSocket support` in brain logs | supabase-js needs WebSocket | `vm-startup.sh.tftpl` is on Node 22 |
| `unrecognized arguments: opens / browser` from gcloud | zsh comment chars | strip `#` comments from pasted commands |

---

## Phase D — Supabase migrations (~30s)

`bootstrap.sh` runs `supabase db push` in Phase 4. If it fails with "Your account does not have the necessary privileges", the Supabase CLI is logged in as a different account from your PAT. Two options:

```sh
SUPABASE_ACCESS_TOKEN=<PAT> supabase link --project-ref <ref>
SUPABASE_ACCESS_TOKEN=<PAT> supabase db push
```

or `supabase logout && supabase login`.

⚠ If you see `WARNING: Local database version differs from the linked project. Update your supabase/config.toml to fix it: [db] major_version = 17`, edit [supabase/config.toml](../supabase/config.toml) to match — Supabase provisions Postgres 17 currently.

---

## Phase E — OAuth the CLIs on the VM (~3 min)

⚠ **Do this on the Linux VM, never your Mac.** macOS Keychain credential storage isn't portable; only Linux's `~/.claude/.credentials.json` works for the brain to read.

```sh
gcloud compute ssh aifredo-brain --tunnel-through-iap --zone us-west1-a --project <PROJECT_ID>
```

First SSH prompts to generate `~/.ssh/google_compute_engine`. Empty passphrase is fine (IAP gates access at IAM, not key level).

Inside the VM:

```sh
sudo -u aifredo -i bash
claude login
```

Open the printed URL on your Mac browser → sign in → paste the code back into SSH.

For codex, **prefer device-auth** if your codex CLI version supports it (cleaner for headless):

```sh
codex login --device-auth
```

If that fails or the OpenAI page rejects the alphanumeric code, fall back to the localhost-callback workaround:

```sh
codex login          # opens browser flow that fails to reach localhost:1455
```

1. Browser tries to redirect to `http://localhost:1455/auth/callback?code=...&state=...` — fails because Mac has nothing listening
2. Copy the **failed URL from Mac browser's address bar**
3. From a **second Mac terminal**, SSH to the VM and `curl 'PASTE_URL'` (single quotes essential)
4. Codex's local server on the VM receives the callback and completes auth

⚠ **OAuth codes (after `?code=`) are sensitive single-use values, ~5 min TTL.** Don't paste them into chats, screenshots, or anywhere they could be observed.

Verify:

```sh
ls -la ~/.claude/.credentials.json ~/.codex/auth.json     # both must exist
jq '{auth_mode, has_api_key: (.OPENAI_API_KEY != null and .OPENAI_API_KEY != "")}' ~/.codex/auth.json
# Expected: {"auth_mode": "chatgpt", "has_api_key": false}
exit                                                       # leaves aifredo shell
sudo systemctl restart aifredo-brain.service
curl -s http://localhost:8080/health
```

### Phase E.5 — Seed the credential snapshot (DO NOT SKIP)

```sh
sudo /opt/AIfredo/snapshot-creds.sh                       # uploads first encrypted snapshot to GCS
exit                                                       # leaves SSH
gcloud storage ls gs://<PROJECT_ID>-aifredo-creds/        # must list snapshot-latest.tar.gz.enc
```

⚠ Without this, the auto-snapshot cron only fires every 6h (at 00:00 / 06:00 / 12:00 / 18:00 UTC). If the VM is replaced before the first cron tick, you lose creds and have to redo Phase E.

**How DR works:**
- TF provisions a private GCS bucket `<PROJECT_ID>-aifredo-creds` (versioned, 10-version retention).
- TF generates a 48-char `random_password.creds_passphrase` that lives in TF state. It's written to `/opt/AIfredo/creds.key` on every fresh VM.
- A cron entry at `/etc/cron.d/aifredo-snapshot` runs `/opt/AIfredo/snapshot-creds.sh` every 6h: `tar -czf - .claude/.credentials.json .codex/auth.json | openssl aes-256-cbc -pbkdf2 -pass file:creds.key | curl upload to GCS`.
- On every VM boot, `vm-startup.sh.tftpl` checks: if both cred files are missing AND a snapshot exists in GCS, decrypt with the same passphrase and untar into `/home/aifredo/`.
- **The passphrase only survives as long as TF state survives.** If you nuke the state bucket, the snapshot is unrecoverable. The state bucket has `force_destroy = false` and versioning enabled, so this is hard to do accidentally.

**To test DR works:**
```sh
cd infra
tofu taint google_compute_instance.brain
tofu apply -auto-approve                                  # replaces the VM
gcloud compute ssh aifredo-brain --tunnel-through-iap --zone us-west1-a --project <PROJECT_ID> -- 'sudo grep -i snapshot /var/log/aifredo-bootstrap.log; curl -s http://localhost:8080/health; echo'
```
Expect: `Credentials restored from snapshot.` + healthy `/health` with no manual OAuth.

⚠ If `auth_mode != "chatgpt"` or `has_api_key=true`, you signed in with API-key billing instead of your ChatGPT Plus subscription. `codex logout && codex login` and pick "Sign in with ChatGPT".

⚠ Newer codex CLI stores tokens at `.tokens.{access_token,refresh_token,id_token,account_id}` (nested), not at the top level.

---

## Phase F — Telegram webhook (~30 s, after Vercel deploys)

Vercel auto-deploys on push to `main`. First build takes 2–4 min.

```sh
cd infra
git push origin main                                      # if you have uncommitted changes
SECRET=$(tofu output -raw telegram_webhook_secret)
BOT_TOKEN=$(grep telegram_bot_token terraform.tfvars | sed -E 's/.*"([^"]+)".*/\1/')
VERCEL_URL=$(tofu output -raw vercel_url)

# Verify Vercel deployment first
curl -sX POST "${VERCEL_URL}/api/telegram" -H "X-Telegram-Bot-Api-Secret-Token: wrong" -d '{}' -w "\nHTTP %{http_code}\n"
# Expected: {"ok":false}  HTTP 401   (our handler ran, rejected the wrong token)

# Register
curl -sX POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -d "url=${VERCEL_URL}/api/telegram" \
  -d "secret_token=${SECRET}" | jq .

# Confirm
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | jq .
```

⚠ Telegram registers the webhook even if your URL returns 404 — there's no upstream check. If you see `pending_update_count > 0` in `getWebhookInfo`, your endpoint isn't responding and messages are buffered.

⚠ If GET on `/api/telegram` returns `405` and POST with a wrong secret returns `401`, the route is alive. A `200` on a bare GET is suspicious — likely Vercel deployment-protection serving an auth page. The project default ([infra/vercel.tf:55-57](../infra/vercel.tf#L55-L57)) is `standard_protection`, which doesn't gate `/api/*` for POSTs with secret headers, so Telegram works through it. If you change to `all` protection, you'll need a bypass.

---

## Phase G — Smoke test

Open Telegram → your bot → send `/start`. Expect a welcome reply. Send `hi`. Expect a "Working…" placeholder, then a streamed Claude reply within ~5–15 s (one edit per 750 ms per [`TELEGRAM_EDIT_DEBOUNCE_MS`](../packages/shared/src/constants.ts)).

If silent for >30 s, tail the brain log:

```sh
gcloud compute ssh aifredo-brain --tunnel-through-iap --zone us-west1-a --project <PROJECT_ID> -- 'sudo journalctl -u aifredo-brain.service -n 80 --no-pager'
```

---

## Recovery scenarios

### State got overwritten in the GCS backend (you answered `yes` to the migration prompt)

State bucket has versioning. Find the larger / older version and restore it:

```sh
gsutil ls -la gs://<TFSTATE_BUCKET>/aifredo/state/default.tfstate
# Pick the largest version with the most recent timestamp BEFORE the bad one;
# note its generation number (after #)
gsutil cp "gs://<TFSTATE_BUCKET>/aifredo/state/default.tfstate#<GENERATION>" gs://<TFSTATE_BUCKET>/aifredo/state/default.tfstate
rm -f terraform.tfstate terraform.tfstate.backup
rm -rf .terraform .terraform.lock.hcl
tofu init -backend-config="bucket=<TFSTATE_BUCKET>"
tofu state list                                           # confirm count looks right
tofu apply -auto-approve
```

### VM was replaced and OAuth is gone

Shouldn't happen post-Phase E.5 — the new VM auto-restores from GCS. If it did happen, check `sudo grep -i snapshot /var/log/aifredo-bootstrap.log` on the VM for clues:
- `No snapshot found (HTTP 404)` → snapshot bucket was emptied or you skipped Phase E.5. Re-run Phase E + E.5.
- `No CLI credentials present; checking for snapshot...` but no `restored` line → metadata token fetch failed or decryption failed. Check `sudo /opt/AIfredo/snapshot-creds.sh` runs cleanly first (a working snapshot proves token + key are fine), then taint VM again.
- `Credentials restored from snapshot.` but brain still 401s → snapshot is stale or corrupted. Force a fresh re-OAuth (Phase E) and re-run Phase E.5.

### Telegram messages not arriving

```sh
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | jq .
# last_error_message and last_error_date are the leads
```

### Brain `/health` is 502

VM cloud-init likely still running. Wait, then:
```sh
gcloud compute ssh aifredo-brain --tunnel-through-iap --zone us-west1-a --project <PROJECT_ID> -- 'sudo tail /var/log/aifredo-bootstrap.log; sudo systemctl status aifredo-brain.service cloudflared.service --no-pager'
```

`AIfredo bootstrap complete.` in the log marks cloud-init done.

---

## Tear-down

```sh
cd infra
tofu destroy
```

Removes everything **except** the GCS state bucket (`force_destroy = false`). Empty + delete it manually for a fully clean slate. The Telegram bot also stays; delete via @BotFather.

---

## Costs

| Service | Free-tier ceiling | Expected |
|---|---|---|
| GCP e2-micro | 1 VM us-west1/central1/east1, 30GB disk, 1GB egress NA→world/mo | well under |
| Cloudflare Tunnel | unlimited | unlimited |
| Vercel Hobby | 100GB bandwidth, 100k invocations/mo | well under |
| Supabase | 500MB DB, 1GB storage, 5GB egress | well under |
| GitHub Actions | unlimited on public repos | well under |
| Claude Pro/Max + ChatGPT Plus | per-subscription rate limits | **real bottleneck** |

`$1 USD` budget alert at 1%/50%/100% fires the moment any GCP resource starts incurring charges.
