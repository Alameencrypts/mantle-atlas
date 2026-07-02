// api/lib/dataSources.js
//
// This is the concrete implementation behind the `mantle-data-indexer` skill.
// It talks to real, public, no-auth-required data sources so the app returns
// real evidence today. If/when the official Mantle Data Indexer endpoint is
// available, swap the internals of these functions — the shape returned to
// the rest of the app stays the same.
//
// Sources used:
//   - DefiLlama (https://api.llama.fi) — protocol + chain TVL, no API key needed

const LLAMA_BASE = "https://api.llama.fi";

async function fetchJson(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Upstream ${url} returned ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Cache the full protocol list in-memory per warm lambda instance to avoid
// refetching ~3MB of JSON on every request.
let _protocolListCache = null;
let _protocolListCacheAt = 0;
const PROTOCOL_LIST_TTL_MS = 1000 * 60 * 30; // 30 min

async function getAllProtocols() {
  const now = Date.now();
  if (_protocolListCache && now - _protocolListCacheAt < PROTOCOL_LIST_TTL_MS) {
    return _protocolListCache;
  }
  const data = await fetchJson(`${LLAMA_BASE}/protocols`);
  _protocolListCache = data;
  _protocolListCacheAt = now;
  return data;
}

/**
 * Resolve a loose protocol name (e.g. "ondo", "Ondo Finance") to a DefiLlama
 * slug that has confirmed presence on the Mantle chain.
 */
async function resolveMantleProtocol(nameGuess) {
  const all = await getAllProtocols();
  const needle = nameGuess.trim().toLowerCase();

  const onMantle = all.filter(
    (p) =>
      Array.isArray(p.chains) &&
      p.chains.some((c) => c.toLowerCase() === "mantle")
  );

  // exact name match first
  let match = onMantle.find(
    (p) => p.name.toLowerCase() === needle || p.slug === needle
  );
  if (match) return match;

  // partial match
  match = onMantle.find(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      needle.includes(p.name.toLowerCase())
  );
  if (match) return match;

  return null;
}

/**
 * Full TVL time series for a protocol, scoped to the Mantle chain where possible.
 * Returns { slug, name, points: [{date, tvl}], currentTvl, source }
 */
async function getProtocolTvlHistory(slug) {
  const data = await fetchJson(`${LLAMA_BASE}/protocol/${encodeURIComponent(slug)}`);

  let series = null;
  let scope = "all-chains";

  if (data.chainTvls && data.chainTvls.Mantle && Array.isArray(data.chainTvls.Mantle.tvl)) {
    series = data.chainTvls.Mantle.tvl;
    scope = "mantle-only";
  } else if (Array.isArray(data.tvl)) {
    series = data.tvl;
  }

  const points = (series || []).map((p) => ({
    date: new Date(p.date * 1000).toISOString().slice(0, 10),
    tvl: p.totalLiquidityUSD,
  }));

  return {
    slug,
    name: data.name || slug,
    scope,
    points,
    currentTvl: points.length ? points[points.length - 1].tvl : null,
    source: `${LLAMA_BASE}/protocol/${slug}`,
    citeUrl: `https://defillama.com/protocol/${slug}`,
  };
}

/**
 * Mantle chain-wide historical TVL.
 */
async function getMantleChainTvlHistory() {
  const data = await fetchJson(`${LLAMA_BASE}/v2/historicalChainTvl/Mantle`);
  const points = data.map((p) => ({
    date: new Date(p.date * 1000).toISOString().slice(0, 10),
    tvl: p.tvl,
  }));
  return {
    points,
    currentTvl: points.length ? points[points.length - 1].tvl : null,
    source: `${LLAMA_BASE}/v2/historicalChainTvl/Mantle`,
    citeUrl: `https://defillama.com/chain/Mantle`,
  };
}

/**
 * Filter a points[] series down to an absolute UTC date range (inclusive).
 */
function filterRange(points, startISO, endISO) {
  return points.filter((p) => p.date >= startISO.slice(0, 10) && p.date <= endISO.slice(0, 10));
}

module.exports = {
  resolveMantleProtocol,
  getProtocolTvlHistory,
  getMantleChainTvlHistory,
  filterRange,
};
