/**
 * TrendScan Yahoo Finance Proxy — Cloudflare Worker
 *
 * Proxies Yahoo Finance chart API requests, adding CORS headers so the
 * browser can call it directly. Yahoo Finance doesn't send CORS headers,
 * so this worker is required for browser-side access.
 *
 * SECURITY: Two layers of protection against quota abuse:
 *   1. Origin allowlist (CORS) — blocks browser requests from non-TrendScan sites
 *   2. Shared-secret token — blocks non-browser requests (curl, Python, etc.)
 *      CORS is browser-enforced only; server-to-server requests bypass it.
 *      The X-TrendScan-Token header must match WORKER_TOKEN secret below.
 *
 * Deploy:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Name: trendscan-yahoo-proxy
 *   3. Copy this entire file into the editor
 *   4. Set the WORKER_TOKEN secret (Settings → Variables → Add):
 *        WORKER_TOKEN = <random 32-char string>
 *      Generate one with: openssl rand -hex 16
 *   5. Click "Deploy"
 *   6. In TrendScan, set the token in localStorage:
 *        localStorage.setItem('YAHOO_PROXY_TOKEN', '<same 32-char string>')
 *      Or add as VITE_YAHOO_PROXY_TOKEN in GitHub Actions secrets (safe —
 *      the token is bundled but only useful for THIS worker, not for other
 *      purposes, and rotating it is trivial).
 *
 * Usage:
 *   GET https://<worker-url>/chart/AAPL?range=1y&interval=1d
 *   Header: X-TrendScan-Token: <token>
 *   → proxies to https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d
 *   → returns the same JSON with CORS headers added
 *
 * Free tier: 100,000 requests/day. The token + origin check prevents third
 * parties from burning this quota via server-to-server requests.
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// Allowlist of origins that may use this proxy (browser CORS check).
const ALLOWED_ORIGINS = new Set([
  'https://trend-scan.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]);

// Shared secret token. Set via Cloudflare Worker secrets:
//   Wrangler CLI:  wrangler secret put WORKER_TOKEN
//   Dashboard:     Workers → your-worker → Settings → Variables → Add
//                  Name: WORKER_TOKEN, Value: <random 32-char string>
// Generate one with: openssl rand -hex 16
//
// The token is read from `env.WORKER_TOKEN` at runtime (Cloudflare injects
// secrets into the `env` argument of the fetch handler). If unset, the token
// check is skipped and a warning is logged — this allows development without
// a token, but production should always set it.

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : null;
  return allowOrigin
    ? { 'Access-Control-Allow-Origin': allowOrigin }
    : {};
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          ...corsHeaders(origin),
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-TrendScan-Token',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // Health check — open to all (no CORS or token needed)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'trendscan-yahoo-proxy',
        tokenRequired: !!env.WORKER_TOKEN,
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    }

    // ── Token check (blocks non-browser requests) ──────────────────────────
    // CORS is browser-enforced only — a Python script or curl can bypass it
    // by simply not sending an Origin header. The shared-secret token stops
    // that: the client must send X-TrendScan-Token matching WORKER_TOKEN.
    //
    // The token is injected into the client bundle via VITE_YAHOO_PROXY_TOKEN.
    // This is acceptable because:
    //   1. The token is only useful for THIS worker (not a general-purpose secret)
    //   2. Rotating it is trivial (update secret + redeploy worker + bundle)
    //   3. Combined with the origin allowlist, it raises the bar high enough
    //      to deter casual abuse
    const expectedToken = env.WORKER_TOKEN || '';
    if (expectedToken) {
      const providedToken = request.headers.get('X-TrendScan-Token') || '';
      if (providedToken !== expectedToken) {
        return new Response(JSON.stringify({
          error: 'Unauthorized: missing or invalid X-TrendScan-Token header',
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders(origin),
          },
        });
      }
    } else {
      // No token configured — log a warning (visible in Cloudflare logs).
      // In production, WORKER_TOKEN should always be set.
      console.warn('[trendscan-yahoo-proxy] WORKER_TOKEN not set — running without token auth. Set it via `wrangler secret put WORKER_TOKEN`.');
    }

    // Extract symbol from path: /chart/AAPL → AAPL
    const match = url.pathname.match(/^\/chart\/(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Usage: /chart/{symbol}?range=1y&interval=1d' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    }

    const symbol = decodeURIComponent(match[1]);
    // Pass through query params (range, interval, etc.)
    const yahooUrl = `${YAHOO_BASE}/${encodeURIComponent(symbol)}${url.search}`;

    try {
      const yahooResp = await fetch(yahooUrl, {
        headers: {
          'User-Agent': 'TrendScan-Proxy/1.0',
        },
      });

      const body = await yahooResp.text();

      return new Response(body, {
        status: yahooResp.status,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
          'Cache-Control': 'public, max-age=300',  // 5 min browser cache
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    }
  },
};
