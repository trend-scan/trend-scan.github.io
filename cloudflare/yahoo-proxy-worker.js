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

// ── IP-based rate limiting (defense in depth) ────────────────────────────────
// The token stops casual abuse, but it's baked into the client bundle — a
// determined attacker can extract it. Rate limiting caps the damage: even if
// someone has the token, a single IP can't burn the 100k/day quota.
//
// Uses Cloudflare's Cache API as a cheap counter (1 cache entry per IP per
// minute window). Free tier supports this with no extra config.
//
// Limits:
//   - 60 requests per minute per IP (matches the Board's 60-symbol refresh)
//   - Legitimate users never hit this — they request at human speed (1-2 req/s)
//   - Scripts hitting 100+ req/min get 429 Too Many Requests
const RATE_LIMIT_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

async function checkRateLimit(request, ctx) {
  // Use CF-Connecting-IP (set by Cloudflare for all requests through their
  // network). Falls back to X-Forwarded-For or 'unknown' for local dev.
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';

  const now = Date.now();
  const windowKey = Math.floor(now / RATE_LIMIT_WINDOW_MS);
  const cacheKey = `https://rate-limit.internal/${ip}/${windowKey}`;

  // Use the Cache API as a distributed counter. Each entry is a count of
  // requests from this IP in this 1-minute window.
  const cache = caches.default;
  const cached = await cache.match(new Request(cacheKey));
  const count = cached ? parseInt(await cached.text(), 10) : 0;

  if (count >= RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, count, ip };
  }

  // Increment the counter (cache for 90s — slightly longer than the window
  // so the entry expires naturally)
  const newResponse = new Response(String(count + 1), {
    headers: { 'Cache-Control': 'public, max-age=90' },
  });
  // Fire-and-forget — don't block the request on the cache write
  ctx.waitUntil(cache.put(new Request(cacheKey), newResponse.clone()));

  return { allowed: true, count: count + 1, ip };
}

export default {
  async fetch(request, env, ctx) {
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

    // Health check — open to all (no CORS, token, or rate limit needed)
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'trendscan-yahoo-proxy',
        tokenRequired: !!env.WORKER_TOKEN,
        rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
      }), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders(origin),
        },
      });
    }

    // ── Rate limit check (before token check — counts ALL requests) ────────
    const rateLimit = await checkRateLimit(request, ctx);
    if (!rateLimit.allowed) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded',
        limit: RATE_LIMIT_PER_MINUTE,
        window: '60s',
        retryAfter: 60,
        ip: rateLimit.ip,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
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
    //   3. Combined with rate limiting, it raises the bar high enough to deter
    //      all but the most determined abuse
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
