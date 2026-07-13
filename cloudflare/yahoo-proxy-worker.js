/**
 * TrendScan Yahoo Finance Proxy — Cloudflare Worker
 *
 * Proxies Yahoo Finance chart API requests, adding CORS headers so the
 * browser can call it directly. Yahoo Finance doesn't send CORS headers,
 * so this worker is required for browser-side access.
 *
 * Deploy:
 *   1. Go to https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Name: trendscan-yahoo-proxy
 *   3. Copy this entire file into the editor
 *   4. Click "Deploy"
 *   5. Note the Worker URL (e.g. https://trendscan-yahoo-proxy.<your-subdomain>.workers.dev)
 *   6. In TrendScan, set: localStorage.setItem('YAHOO_PROXY_URL', 'https://trendscan-yahoo-proxy.<your-subdomain>.workers.dev')
 *   7. Or add the URL as VITE_YAHOO_PROXY_URL in GitHub Actions secrets
 *
 * Usage:
 *   GET https://<worker-url>/chart/AAPL?range=1y&interval=1d
 *   → proxies to https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1y&interval=1d
 *   → returns the same JSON with CORS headers added
 *
 * Free tier: 100,000 requests/day — more than enough for 372 tickers × multiple refreshes
 *
 * Security: The worker only proxies to query1.finance.yahoo.com, so it can't
 * be abused as an open proxy.
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'trendscan-yahoo-proxy' }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Extract symbol from path: /chart/AAPL → AAPL
    const match = url.pathname.match(/^\/chart\/(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'Usage: /chart/{symbol}?range=1y&interval=1d' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
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
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',  // 5 min browser cache
        },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
