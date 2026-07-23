/**
 * TrendScan Snapshot Refresh Trigger — Cloudflare Worker Cron
 *
 * Purpose:
 *   GitHub Actions cron is unreliable — scheduled runs are frequently
 *   delayed 30min–6h+ or dropped entirely during peak load. This Worker
 *   provides a backup trigger that fires on Cloudflare's cron scheduler
 *   (which is far more reliable) and calls GitHub's workflow_dispatch
 *   API to trigger the refresh-snapshot.yml workflow.
 *
 * Schedule:
 *   Every 4 hours, 24/7 (6 fires per day). Cron expression:
 *     0 0/4 * * *    (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
 *   Cloudflare cron uses standard 5-field Unix cron syntax.
 *   More frequent than the GitHub Actions cron (0 4,10,16,22 * * *) it backs
 *   up — keeps the snapshot from ever going more than 4h stale.
 *
 * Required secrets (set via Cloudflare dashboard or wrangler):
 *   GH_TOKEN         — GitHub PAT with `repo` + `workflow` scopes, OR a
 *                      fine-grained PAT with `Actions: write` + `Contents: read`
 *                      on trend-scan/trend-scan.github.io
 *   (Optional) NOTIFY_WEBHOOK — Slack/Discord webhook URL for failure alerts.
 *                      If set, sends a notification when the dispatch fails.
 *
 * Deploy:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Name: trendscan-refresh-trigger
 *   3. Copy this entire file into the editor
 *   4. Set the GH_TOKEN secret (Settings → Variables → Add):
 *        GH_TOKEN = <your GitHub PAT>
 *   5. Click "Deploy"
 *   6. Go to the Triggers tab → Cron Triggers → Add cron trigger:
 *        Cron expression: 0 0/4 * * *
 *   7. (Optional) Set NOTIFY_WEBHOOK for failure alerts
 *
 * Why this is needed:
 *   On 2026-07-22, GitHub Actions cron missed 3 consecutive scheduled runs
 *   (22:00, 04:00, 10:00 UTC) — only the user's manual dispatch fired.
 *   Without this backup, the snapshot could go stale for 18+ hours before
 *   anyone notices. The health-check workflow (snapshot-health-check.yml)
 *   opens a GitHub Issue when the snapshot is stale, but it ALSO runs on
 *   GitHub Actions cron — so when GitHub's scheduler is degraded, the
 *   alerting fails too. This Worker breaks that dependency.
 *
 * Free tier: 100,000 requests/day. We fire 6× daily (every 4h) = ~180/month. Well
 * within free tier.
 *
 * Verification:
 *   - Check Cloudflare Worker logs (Workers → your-worker → Real-time Logs)
 *     after each cron fire
 *   - Check GitHub Actions tab for new workflow_dispatch runs from
 *     "trend-scan[bot]" or whatever name the PAT is associated with
 *   - The Worker's fetch handler returns JSON status for manual testing:
 *       curl https://<worker-url>/
 *     → { "ok": true, "last_dispatch": "...", "last_run_id": 123 }
 *
 * Idempotency:
 *   GitHub's workflow_dispatch API will create a new run even if one is
 *   already in progress. The refresh-snapshot.yml workflow has a concurrency
 *   group `snapshot-refresh` with `cancel-in-progress: false`, so a second
 *   dispatch while one is running will queue but not cancel the first.
 *   Worst case: we get 2 refresh runs back-to-back, which is harmless.
 */

const REPO_OWNER = 'trend-scan';
const REPO_NAME = 'trend-scan.github.io';
const WORKFLOW_ID = 'refresh-snapshot.yml'; // can be filename or numeric ID
const REF = 'main';

// In-memory state (resets on Worker restart, but useful for the fetch handler)
let _lastDispatch = null;
let _lastRunId = null;
let _lastError = null;

/**
 * Trigger the refresh-snapshot workflow via GitHub's workflow_dispatch API.
 * Returns the HTTP status code and any error message.
 */
async function triggerRefresh(env) {
  const token = env.GH_TOKEN;
  if (!token) {
    throw new Error('GH_TOKEN secret not set on Worker');
  }

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'trendscan-refresh-trigger-worker',
    },
    body: JSON.stringify({ ref: REF }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  // GitHub returns 204 No Content on success
  return { status: res.status, ok: true };
}

/**
 * Look up the most recent run of the refresh-snapshot workflow so we can
 * report the run number back to the caller (helpful for debugging).
 */
async function getLatestRunId(env) {
  const token = env.GH_TOKEN;
  if (!token) return null;

  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'trendscan-refresh-trigger-worker',
      },
    });
    if (!res.ok) return null;
    const d = await res.json();
    const run = d.workflow_runs?.[0];
    return run ? { id: run.id, number: run.run_number, status: run.status, created_at: run.created_at } : null;
  } catch {
    return null;
  }
}

/**
 * Send a notification to a Slack/Discord webhook if NOTIFY_WEBHOOK is set.
 * Both platforms accept the same JSON payload format with { text: "..." }.
 */
async function notify(env, message) {
  if (!env.NOTIFY_WEBHOOK) return;
  try {
    await fetch(env.NOTIFY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `⚠️ TrendScan refresh-trigger: ${message}` }),
    });
  } catch {
    // Notification failures are non-fatal — log and move on
  }
}

/**
 * Scheduled handler — fires on Cloudflare cron trigger.
 */
export default {
  async scheduled(event, env, ctx) {
    const scheduledTime = new Date(event.scheduledTime).toISOString();
    console.log(`[${scheduledTime}] Cron trigger fired (cron: ${event.cron})`);

    try {
      const result = await triggerRefresh(env);
      _lastDispatch = scheduledTime;
      _lastError = null;
      console.log(`✓ Dispatched refresh-snapshot workflow (HTTP ${result.status})`);

      // Wait briefly for GitHub to register the run, then look up its ID
      await new Promise(r => setTimeout(r, 3000));
      const latestRun = await getLatestRunId(env);
      if (latestRun) {
        _lastRunId = latestRun;
        console.log(`  Latest run: #${latestRun.number} (id=${latestRun.id}, status=${latestRun.status})`);
      }
    } catch (e) {
      _lastError = e.message;
      console.error(`✗ Failed to dispatch refresh-snapshot: ${e.message}`);
      await notify(env, `Failed to dispatch refresh-snapshot workflow: ${e.message}`);
    }
  },

  /**
   * HTTP fetch handler — for manual testing and status checks.
   *
   * GET /            → returns last dispatch status (no auth required)
   * POST /trigger    → manually triggers a refresh (requires X-Worker-Token header
   *                    matching WORKER_TOKEN secret, for ad-hoc testing)
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for browser access (status endpoint)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/' && request.method === 'GET') {
      // Status endpoint — no auth, returns last dispatch info
      return new Response(JSON.stringify({
        ok: _lastError == null,
        worker: 'trendscan-refresh-trigger',
        repo: `${REPO_OWNER}/${REPO_NAME}`,
        workflow: WORKFLOW_ID,
        last_dispatch: _lastDispatch,
        last_run: _lastRunId,
        last_error: _lastError,
        now: new Date().toISOString(),
      }, null, 2), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      // Manual trigger endpoint — requires token auth
      const token = request.headers.get('X-Worker-Token');
      if (!token || token !== env.WORKER_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized: missing or invalid X-Worker-Token header' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      try {
        const result = await triggerRefresh(env);
        _lastDispatch = new Date().toISOString();
        _lastError = null;
        await new Promise(r => setTimeout(r, 3000));
        const latestRun = await getLatestRunId(env);
        if (latestRun) _lastRunId = latestRun;
        return new Response(JSON.stringify({
          ok: true,
          dispatch_status: result.status,
          latest_run: latestRun,
        }, null, 2), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (e) {
        _lastError = e.message;
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found', path: url.pathname }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
