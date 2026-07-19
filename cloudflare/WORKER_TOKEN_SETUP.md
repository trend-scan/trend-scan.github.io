# Cloudflare Worker Token Setup Guide

This guide walks you through setting up the shared-secret token that protects your Yahoo Finance proxy Worker from quota abuse.

## Why this matters

Your Cloudflare Worker has a 100,000 requests/day free-tier limit. Without token auth, anyone can write a script like:

```python
import requests
for i in range(100000):
    requests.get('https://your-worker.workers.dev/chart/BTC-USD?range=1y&interval=1d')
```

…and exhaust your daily quota in minutes. CORS doesn't stop this — CORS is browser-enforced only, and server-to-server requests bypass it entirely.

The shared-secret token fixes this: every request must include an `X-TrendScan-Token` header matching the `WORKER_TOKEN` secret on the Worker. Scripts that don't know the token get a 401.

---

## Step 1: Generate a random token

Run this in your terminal:

```bash
openssl rand -hex 16
```

You'll get a 32-character hex string like `a3f7b2c1d4e5f6a7b8c9d0e1f2a3b4c5`. **Copy this** — you'll need it for both Cloudflare and GitHub.

> **Security note:** This token WILL be baked into the client JS bundle (via `VITE_YAHOO_PROXY_TOKEN`). That's acceptable because:
> 1. The token is only useful for YOUR Worker (not a general-purpose secret)
> 2. Rotating it is trivial (update the secret in 2 places, redeploy)
> 3. Combined with the origin allowlist, it raises the bar high enough to deter casual abuse

## Step 2: Add the token to Cloudflare

You have two options — pick whichever you're more comfortable with.

### Option A: Cloudflare Dashboard (easiest, no CLI needed)

1. Go to https://dash.cloudflare.com → **Workers & Pages**
2. Click on your Worker (`trendscan-yahoo-proxy` or whatever you named it)
3. Click the **Settings** tab
4. Scroll to **Variables and Secrets**
5. Click **Add** under **Secrets** (NOT Variables — secrets are encrypted at rest)
6. **Name:** `WORKER_TOKEN`
7. **Value:** paste the 32-char hex string from Step 1
8. Click **Deploy** to save

### Option B: Wrangler CLI (if you have it installed)

```bash
# Navigate to your worker directory (or anywhere with wrangler.toml)
cd cloudflare/

# This will prompt you to paste the token value
wrangler secret put WORKER_TOKEN
# → paste the 32-char hex string, press Enter
```

Wrangler stores the secret encrypted in Cloudflare's infrastructure — you can't read it back, only overwrite it.

## Step 3: Add the token to GitHub

1. Go to your repo: https://github.com/trend-scan/trend-scan.github.io
2. **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. **Name:** `VITE_YAHOO_PROXY_TOKEN`
5. **Secret:** paste the SAME 32-char hex string from Step 1
6. Click **Add secret**

> **Important:** The token in GitHub and Cloudflare MUST match exactly. If they differ, every Yahoo proxy request will return 401 and the Board/Macro tabs will have no tradfi data.

## Step 4: Redeploy the Worker with the new code

The Worker code in `cloudflare/yahoo-proxy-worker.js` was updated to check the token. You need to redeploy it:

### Option A: Dashboard (copy-paste)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → your Worker
2. Click **Edit Code** (or **Quick Edit**)
3. Open `cloudflare/yahoo-proxy-worker.js` from this repo
4. Select all (Cmd+A / Ctrl+A), copy, paste into the editor — replace everything
5. Click **Save and Deploy**

### Option B: Wrangler CLI

```bash
cd cloudflare/
wrangler deploy yahoo-proxy-worker.js --name trendscan-yahoo-proxy
# (replace --name with your actual worker name)
```

## Step 5: Verify it works

### Test 1: Without token (should fail)

```bash
curl -i https://your-worker.workers.dev/chart/BTC-USD?range=1y&interval=1d
```

Expected: `HTTP/1.1 401 Unauthorized` with body `{"error":"Unauthorized: missing or invalid X-TrendScan-Token header"}`

### Test 2: With correct token (should succeed)

```bash
curl -i -H "X-TrendScan-Token: YOUR_32_CHAR_TOKEN" \
  "https://your-worker.workers.dev/chart/BTC-USD?range=1y&interval=1d"
```

Expected: `HTTP/1.1 200 OK` with Yahoo Finance JSON data.

### Test 3: Wrong token (should fail)

```bash
curl -i -H "X-TrendScan-Token: wrong-token" \
  "https://your-worker.workers.dev/chart/BTC-USD?range=1y&interval=1d"
```

Expected: `HTTP/1.1 401 Unauthorized`

### Test 4: Health check (should always work, no token needed)

```bash
curl https://your-worker.workers.dev/health
```

Expected: `{"status":"ok","service":"trendscan-yahoo-proxy","tokenRequired":true}`

The `tokenRequired: true` field confirms the Worker picked up your `WORKER_TOKEN` secret.

## Step 6: Trigger a redeploy of the site

The client code already sends the `X-TrendScan-Token` header (in `yahooCrypto.js` and `traditionalMarkets.js`), but the token needs to be baked into the bundle via `VITE_YAHOO_PROXY_TOKEN`.

Once you've added the GitHub secret, trigger a deploy:

- **Automatic:** Push any commit to `main`, or wait for the next scheduled refresh-snapshot run (3× daily).
- **Manual:** Go to Actions tab → "Build & Deploy" → "Run workflow"

After the deploy finishes, verify the token is in the bundle:

1. Open https://trend-scan.github.io/ in your browser
2. Open DevTools → Sources tab
3. Find the `exchanges-*.js` or `sourceResolver-*.js` chunk
4. Search for `X-TrendScan-Token` — you should find the header name in the minified code

Then load the Board page and check the Network tab — requests to your Worker should include the `X-TrendScan-Token` header and return 200.

---

## How to rotate the token

If you suspect the token has been compromised (or just want to rotate periodically):

1. Generate a new token: `openssl rand -hex 16`
2. Update Cloudflare: dashboard → Worker → Settings → Variables → edit `WORKER_TOKEN`
3. Update GitHub: repo Settings → Secrets → update `VITE_YAHOO_PROXY_TOKEN`
4. Redeploy the Worker (dashboard or `wrangler deploy`)
5. Trigger a site redeploy (push a commit or run the workflow manually)

Total time: ~2 minutes. No data loss, no downtime.

---

## Troubleshooting

### "All Yahoo proxy requests return 401"

- **Cause:** Token mismatch between Cloudflare and GitHub, OR the Worker hasn't been redeployed with the new code.
- **Fix:** Verify the token matches exactly in both places. Redeploy the Worker. Check `/health` endpoint shows `tokenRequired: true`.

### "tokenRequired: false on /health endpoint"

- **Cause:** The `WORKER_TOKEN` secret isn't set on the Worker, or the Worker is running old code.
- **Fix:** Add the secret in Cloudflare dashboard (Step 2), then redeploy the Worker with the updated code (Step 4).

### "Worker returns 200 but site has no data"

- **Cause:** The site bundle was built BEFORE you added `VITE_YAHOO_PROXY_TOKEN` to GitHub secrets.
- **Fix:** Trigger a manual deploy (Actions → Build & Deploy → Run workflow).

### "Local dev doesn't work"

For local development, set the token in localStorage:

```javascript
// In browser console on localhost:5173
localStorage.setItem('YAHOO_PROXY_TOKEN', 'your-32-char-token')
```

Or create a `.env.local` file (gitignored):

```
VITE_YAHOO_PROXY_TOKEN=your-32-char-token
```
