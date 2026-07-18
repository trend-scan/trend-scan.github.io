/**
 * FactorWatch Scraper — fetches factor data from factorwatch.ai
 *
 * Targets 3 pages:
 *   - / (FW 3000 factor spread monitor + estimate revisions)
 *   - /sp500.html (S&P 500 factor spread monitor + estimate revisions)
 *   - /baskets.html (thematic baskets performance table)
 *
 * Data is server-rendered in HTML tables — no API/JSON endpoints.
 * Parsing uses regex (tables have consistent structure with id="monitor").
 *
 * Rate limiting: 1 request per page, 2-second delay between pages.
 * Total: 3 HTTP requests per build run.
 *
 * Attribution: Data provided by factorwatch.ai (Alex Corrino).
 * The site is a free educational project; robots.txt allows all crawlers.
 *
 * Graceful degradation: if any page fails, returns null for that section.
 * The caller (build_snapshot.js) handles null by setting factor_watch to null.
 */

import { fetchWithTimeout } from '../../src/lib/scanner/fetchWithTimeout.js';

const FW_BASE = 'https://factorwatch.ai';
const USER_AGENT = 'TrendScan-Snapshot/1.0 (https://trend-scan.github.io)';
const DELAY_MS = 2000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Fetch a FactorWatch page with proper headers.
 */
async function fetchPage(path) {
  const url = `${FW_BASE}${path}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, 15000);
    if (!res.ok) {
      console.warn(`  ✗ FW ${path}: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`  ✗ FW ${path}: ${e.message}`);
    return null;
  }
}

/**
 * Parse a cell like "+0.7% (+0.8σ)" into { ret: 0.7, sigma: 0.8 }.
 * Cells without sigma (e.g. YTD column) return { ret: number, sigma: null }.
 */
function parseRetSigma(cellText) {
  if (!cellText || cellText === '—' || cellText === '') return { ret: null, sigma: null };
  // Match: +0.7% (+0.8σ) or -6.9% (-3.0σ) or +1.6% (no sigma)
  const m = cellText.match(/([+-]?[\d.]+)%(?:\s*\(([+-]?[\d.]+)σ\))?/);
  if (!m) return { ret: null, sigma: null };
  return {
    ret: parseFloat(m[1]),
    sigma: m[2] != null ? parseFloat(m[2]) : null,
  };
}

/**
 * Parse a simple percentage cell like "+38%" or "-13%" into a number.
 */
function parsePct(cellText) {
  if (!cellText || cellText === '—' || cellText === '') return null;
  const m = cellText.match(/([+-]?[\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Strip HTML tags and decode entities, returning clean text.
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Extract all rows from a table HTML string.
 * Returns array of arrays of cell text (stripped of HTML).
 */
function parseTable(tableHtml) {
  const rows = [];
  const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellMatches = rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
    for (const cellMatch of cellMatches) {
      cells.push(stripHtml(cellMatch[1]));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * Find a table by its id attribute in the HTML.
 */
function findTableById(html, tableId) {
  const re = new RegExp(`<table[^>]*id=["']${tableId}["'][^>]*>([\\s\\S]*?)<\\/table>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

/**
 * Find the Nth table in the HTML (0-indexed).
 */
function findNthTable(html, n) {
  const tables = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi);
  let i = 0;
  for (const t of tables) {
    if (i === n) return t[1];
    i++;
  }
  return null;
}

/**
 * Normalize a factor name from the HTML table into a consistent key.
 * "High beta" → "high_beta", "Low volatility" → "low_volatility",
 * "Div yield" → "dividend_yield", etc.
 */
function normalizeFactorKey(name) {
  const lower = name.toLowerCase().trim();
  if (lower.includes('div')) return 'dividend_yield';
  if (lower.includes('low vol')) return 'low_volatility';
  if (lower.includes('high beta')) return 'high_beta';
  if (lower.includes('momentum')) return 'momentum';
  if (lower.includes('value')) return 'value';
  if (lower.includes('quality')) return 'quality';
  if (lower.includes('size')) return 'size';
  return lower.replace(/\s+/g, '_');
}

/**
 * Parse the factor spread monitor table (id="monitor").
 * Returns object keyed by factor name with ret + sigma for each timeframe.
 */
function parseFactorMonitor(html) {
  const tableHtml = findTableById(html, 'monitor');
  if (!tableHtml) return null;

  const rows = parseTable(tableHtml);
  if (rows.length < 2) return null;

  // Header: ['Factor', '1 day', '5 days', '20 days', '60 days', 'YTD']
  const timeframes = ['1d', '5d', '20d', '60d', 'ytd'];

  const factors = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 6) continue;
    const factorName = row[0];
    if (!factorName || factorName === 'Factor') continue;

    const factorKey = normalizeFactorKey(factorName);

    const factorData = {};
    for (let j = 0; j < timeframes.length; j++) {
      const cellText = row[j + 1];
      if (j < 4) {
        // First 4 columns have ret + sigma
        const { ret, sigma } = parseRetSigma(cellText);
        factorData[`${timeframes[j]}_ret`] = ret;
        factorData[`${timeframes[j]}_sigma`] = sigma;
      } else {
        // YTD column has only ret
        factorData[`${timeframes[j]}_ret`] = parsePct(cellText);
      }
    }
    factors[factorKey] = factorData;
  }

  return factors;
}

/**
 * Parse the estimate revisions table (4th table on the page).
 * Returns object keyed by factor name with top, bot, spread.
 */
function parseRevisions(html) {
  // The revisions table is typically the 4th table (index 3) on the page
  // It has headers: ['Factor', 'Top quintile', 'Bottom quintile', 'Top − bottom']
  const allTables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];

  for (const t of allTables) {
    const tableHtml = t[1];
    const rows = parseTable(tableHtml);
    if (rows.length < 2) continue;

    const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    // Check if this looks like a revisions table
    const hasTopBottom = header.some(h => h.includes('top')) && header.some(h => h.includes('bottom'));
    if (!hasTopBottom) continue;

    const revisions = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 4) continue;
      const factorName = row[0];
      if (!factorName || factorName === 'Factor') continue;

      const factorKey = normalizeFactorKey(factorName);

      revisions[factorKey] = {
        top: parsePct(row[1]),
        bot: parsePct(row[2]),
        spread: parsePct(row[3]),
      };
    }

    if (Object.keys(revisions).length > 0) return revisions;
  }

  return null;
}

/**
 * Parse the baskets performance table (first table on baskets.html).
 * Returns object keyed by basket name with ret for each timeframe.
 */
function parseBaskets(html) {
  const allTables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];

  for (const t of allTables) {
    const tableHtml = t[1];
    const rows = parseTable(tableHtml);
    if (rows.length < 2) continue;

    const header = rows[0].map(h => h.toLowerCase());
    // Baskets table has columns: ['Basket', '1d', '5d', '20d', '60d', 'YTD']
    if (!header[0] || !header[0].includes('basket')) continue;

    const timeframes = ['1d', '5d', '20d', '60d', 'ytd'];
    const baskets = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length < 6) continue;
      const basketName = row[0];
      if (!basketName) continue;

      const basketData = {};
      for (let j = 0; j < timeframes.length; j++) {
        basketData[`${timeframes[j]}_ret`] = parsePct(row[j + 1]);
      }
      baskets[basketName] = basketData;
    }

    if (Object.keys(baskets).length > 0) return baskets;
  }

  return null;
}

/**
 * Extract the "as of" date from the page header.
 * The header contains text like "as of 2026-07-17".
 */
function parseAsOfDate(html) {
  const m = html.match(/as of\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : new Date().toISOString().slice(0, 10);
}

/**
 * Main entry point — fetches and parses all FactorWatch data.
 * Returns { sp500, fw3000, baskets, as_of, timestamp } or null on total failure.
 */
export async function fetchFactorWatch() {
  console.log('  Fetching FactorWatch data...');

  // Page 1: FW 3000 homepage
  const fw3000Html = await fetchPage('/');
  await sleep(DELAY_MS);

  // Page 2: S&P 500
  const sp500Html = await fetchPage('/sp500.html');
  await sleep(DELAY_MS);

  // Page 3: Baskets
  const basketsHtml = await fetchPage('/baskets.html');

  if (!fw3000Html && !sp500Html) {
    console.warn('  ✗ FW: All page fetches failed');
    return null;
  }

  const result = {
    timestamp: new Date().toISOString(),
    as_of: null,
    sp500: null,
    fw3000: null,
    baskets: null,
  };

  if (fw3000Html) {
    const factors = parseFactorMonitor(fw3000Html);
    const revisions = parseRevisions(fw3000Html);
    if (factors) {
      result.fw3000 = { factors, revisions };
      result.as_of = parseAsOfDate(fw3000Html);
      console.log(`  ✓ FW 3000: ${Object.keys(factors).length} factors, ${revisions ? Object.keys(revisions).length : 0} revisions (as of ${result.as_of})`);
    } else {
      console.warn('  ✗ FW 3000: factor monitor table not found');
    }
  }

  if (sp500Html) {
    const factors = parseFactorMonitor(sp500Html);
    const revisions = parseRevisions(sp500Html);
    if (factors) {
      result.sp500 = { factors, revisions };
      if (!result.as_of) result.as_of = parseAsOfDate(sp500Html);
      console.log(`  ✓ S&P 500: ${Object.keys(factors).length} factors, ${revisions ? Object.keys(revisions).length : 0} revisions`);
    } else {
      console.warn('  ✗ S&P 500: factor monitor table not found');
    }
  }

  if (basketsHtml) {
    const baskets = parseBaskets(basketsHtml);
    if (baskets) {
      result.baskets = baskets;
      console.log(`  ✓ Baskets: ${Object.keys(baskets).length} thematic baskets`);
    } else {
      console.warn('  ✗ Baskets: table not found');
    }
  }

  // Only return if we got at least one data section
  if (!result.sp500 && !result.fw3000 && !result.baskets) {
    console.warn('  ✗ FW: No data parsed from any page');
    return null;
  }

  return result;
}
