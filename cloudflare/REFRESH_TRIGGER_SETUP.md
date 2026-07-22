# Refresh Trigger Worker — Setup Guide

This guide walks you through deploying the `refresh-trigger-worker.js` Cloudflare Worker that triggers the TrendScan `refresh-snapshot.yml` GitHub Actions workflow on a reliable cron schedule.

## Why this exists

GitHub Actions cron is unreliable. Observed behavior (verified July 2026):

- Scheduled runs are frequently **delayed 30min–6h+**
- During peak load, GitHub **drops scheduled runs entirely**
- On 2026-07-22, GitHub Actions cron missed 3 consecutive scheduled runs (22:00, 04:00, 10:00 UTC)
- The `snapshot-health-check.yml` workflow that monitors staleness ALSO runs on GitHub Actions cron — so when GitHub's scheduler is degraded, alerting fails too

Cloudflare Workers cron triggers are far more reliable (1-2min precision, no dropping). This Worker fires on Cloudflare's cron and calls GitHub's `workflow_dispatch` API to trigger the refresh, breaking the dependency on GitHub's scheduler.

## Cost

**Free tier:** 100,000 requests/day. We fire 4× daily = ~120/month. Well within free tier.

## Setup steps

### Step 1: Create a GitHub PAT

You need a token with permission to dispatch workflows on `trend-scan/trend-scan.github.io`.

**Option A: Fine-grained PAT (recommended)**

1. Go to https://github.com/settings/personal-access-tokens/new
2. **Token name:** `trendscan-refresh-trigger`
3. **Resource owner:** `trend-scan`
4. **Repository access:** Only select repositories → `trend-scan.github.io`
5. **Permissions:**
   - Actions → Read and write
   - Contents → Read-only (needed for some GitHub API metadata)
6. **Expiration:** 90 days (set a calendar reminder to rotate)
7. Click **Generate token** and copy the value (starts with `github_pat_...`)

**Option B: Classic PAT (simpler, broader scope)**

1. Go to https://github.com/settings/tokens/new
2. **Note:** `trendscan-refresh-trigger`
3. **Scopes:** `repo` (for private repos) + `workflow` (to dispatch workflows)
4. **Expiration:** 90 days
5. Click **Generate token** and copy the value (starts with `ghp_...`)

### Step 2: Deploy the Worker

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create**
2. Choose **Create Worker**
3. **Name:** `trendscan-refresh-trigger`
4. Click **Deploy** (creates a starter Worker)
5. Click **Edit code**
6. Delete the starter code, paste the entire contents of `cloudflare/refresh-trigger-worker.js`
7. Click **Deploy**

### Step 3: Set the GH_TOKEN secret

1. In your Worker's dashboard, go to **Settings** → **Variables and Secrets**
2. Click **Add** under **Secrets** (NOT Variables — secrets are encrypted at rest)
3. **Name:** `GH_TOKEN`
4. **Value:** paste the GitHub PAT from Step 1
5. Click **Deploy** to save

### Step 4: (Optional) Set WORKER_TOKEN for manual-trigger auth

The `/trigger` HTTP endpoint allows manual ad-hoc dispatches (useful for testing). It requires a shared-secret token to prevent abuse.

1. Generate a random token:
   ```bash
   openssl rand -hex 16
   ```
   You'll get a 32-char hex string like `a3f7b2c1d4e5f6a7b8c9d0e1f2a3b4c5`

2. Add it as a secret:
   - **Name:** `WORKER_TOKEN`
   - **Value:** the 32-char hex string

3. To manually trigger a refresh:
   ```bash
   curl -X POST https://trendscan-refresh-trigger.<your-subdomain>.workers.dev/trigger \
     -H "X-Worker-Token: <your-32-char-token>"
   ```

### Step 5: (Optional) Set NOTIFY_WEBHOOK for failure alerts

If you want a Slack/Discord notification when the cron fires but the GitHub dispatch fails:

1. Get a webhook URL from Slack (incoming webhook integration) or Discord (channel webhook)
2. Add it as a secret:
   - **Name:** `NOTIFY_WEBHOOK`
   - **Value:** `https://hooks.slack.com/services/...` or `https://discord.com/api/webhooks/...`

### Step 6: Add the cron trigger

1. In your Worker's dashboard, go to **Settings** → **Triggers** → **Cron Triggers**
2. Click **Add Cron Trigger**
3. **Cron expression:** `0 4,10,16,22 * * *`
   (Same schedule as the GitHub Actions cron — 04:00, 10:00, 16:00, 22:00 UTC)
4. Click **Save**

### Step 7: Verify the deployment

1. **Test the status endpoint:**
   ```bash
   curl https://trendscan-refresh-trigger.<your-subdomain>.workers.dev/
   ```
   Should return:
   ```json
   {
     "ok": true,
     "worker": "trendscan-refresh-trigger",
     "repo": "trend-scan/trend-scan.github.io",
     "workflow": "refresh-snapshot.yml",
     "last_dispatch": null,
     "last_run": null,
     "last_error": null,
     "now": "2026-07-22T..."
   }
   ```

2. **Test manual trigger** (requires WORKER_TOKEN from Step 4):
   ```bash
   curl -X POST https://trendscan-refresh-trigger.<your-subdomain>.workers.dev/trigger \
     -H "X-Worker-Token: <your-token>"
   ```
   Should return:
   ```json
   {
     "ok": true,
     "dispatch_status": 204,
     "latest_run": {
       "id": 29892222045,
       "number": 70,
       "status": "queued",
       "created_at": "2026-07-22T..."
     }
   }
   ```

3. **Wait for the next cron fire** (within 6h) and check:
   - Cloudflare Worker logs (Workers → your-worker → **Real-time Logs**) should show `[<time>] Cron trigger fired` and `✓ Dispatched refresh-snapshot workflow (HTTP 204)`
   - GitHub Actions tab should show a new `workflow_dispatch` run from the PAT owner

## How it works

```
┌──────────────────┐                ┌──────────────────┐                ┌──────────────────┐
│ Cloudflare Cron  │  fires every   │ refresh-trigger  │  POST          │ GitHub Actions   │
│ (reliable, 1-2m  │ ─────────────> │ Worker           │ ────────────>  │ workflow_dispatch│
│  precision)      │   6h           │                  │   /dispatches  │ API              │
└──────────────────┘                └──────────────────┘                └──────────────────┘
                                                                                │
                                                                                ▼
                                                                    ┌──────────────────┐
                                                                    │ refresh-snapshot │
                                                                    │ .yml runs        │
                                                                    │ (builds snapshot)│
                                                                    └──────────────────┘
```

The Worker calls:
```
POST https://api.github.com/repos/trend-scan/trend-scan.github.io/actions/workflows/refresh-snapshot.yml/dispatches
Authorization: Bearer <GH_TOKEN>
Content-Type: application/vnd.github+json

{ "ref": "main" }
```

GitHub responds with HTTP 204 (No Content) on success.

## Idempotency

GitHub's `workflow_dispatch` API creates a new run even if one is already in progress. The `refresh-snapshot.yml` workflow has a concurrency group `snapshot-refresh` with `cancel-in-progress: false`, so:

- If a run is in progress: the new dispatch queues and runs after the current one completes
- If no run is in progress: the new dispatch runs immediately

Worst case: we get 2 refresh runs back-to-back, which is harmless (second run finds no changes and exits early).

## Monitoring

Three layers of monitoring:

1. **Cloudflare Worker logs** — Real-time Logs show every cron fire and its result
2. **GitHub Actions tab** — new `workflow_dispatch` runs appear with the PAT owner as the actor
3. **`snapshot-health-check.yml`** — opens a GitHub Issue if snapshot is stale (still runs on GitHub cron, but if Cloudflare cron keeps the snapshot fresh, this Issue never fires)

## Token rotation

The GH_TOKEN expires (90 days for fine-grained, configurable for classic). When it expires:

1. Generate a new PAT following Step 1
2. Update the `GH_TOKEN` secret in Cloudflare (Settings → Variables → Secrets → edit)
3. Test with the manual trigger endpoint

Set a calendar reminder 5 days before expiration so you can rotate proactively.

## Troubleshooting

### Worker fires but GitHub dispatch fails (HTTP 401)

- GH_TOKEN is wrong or expired
- Regenerate the PAT and update the secret

### Worker fires but GitHub dispatch fails (HTTP 404)

- Workflow file name is wrong (should be `refresh-snapshot.yml`)
- Or the PAT doesn't have access to the repo

### Worker fires but GitHub dispatch fails (HTTP 422)

- The `ref` (branch) doesn't exist. Check that `main` is the default branch.
- The workflow file doesn't exist on that branch

### Cron doesn't fire

- Verify the cron trigger is set (Settings → Triggers → Cron Triggers)
- Cloudflare cron uses UTC — make sure the expression is in UTC
- Check Worker logs for any uncaught exceptions

### Worker status endpoint returns `last_error`

- The last cron fire failed. The `last_error` field contains the error message.
- Most common cause: GH_TOKEN expired. Regenerate and update the secret.
