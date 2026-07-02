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
//   - Etherscan V2 multichain API (https://api.etherscan.io/v2/api, chainid=5000)
//     — wallet/tx data for Mantle. Requires ETHERSCAN_API_KEY (free, but
//     mandatory — Mantlescan's old standalone endpoint now runs on this
//     unified system with no meaningful unauthenticated tier).

const LLAMA_BASE = "https://api.llama.fi";
// Mantlescan has migrated onto Etherscan's unified V2 multichain API.
// Mantle's chain ID is 5000. This requires a real Etherscan API key for
// every request — there is no meaningful unauthenticated tier anymore.
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const MANTLE_CHAIN_ID = 5000;

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
  };
}

/**
 * Filter a points[] series down to an absolute UTC date range (inclusive).
 */
function filterRange(points, startISO, endISO) {
  return points.filter((p) => p.date >= startISO.slice(0, 10) && p.date <= endISO.slice(0, 10));
}

/**
 * Wallet activity for the Mantle chain, via Etherscan's V2 multichain API
 * (chainid=5000). This requires a real ETHERSCAN_API_KEY — Mantlescan's old
 * standalone endpoint has migrated onto this unified system and no longer
 * has a meaningful unauthenticated tier.
 * Returns { address, txCount, firstTx, lastTx, transactions, source, blocked }
 */
async function getWalletActivity(address, { limit = 50 } = {}) {
  const apiKey = process.env.ETHERSCAN_API_KEY || "";

  if (!apiKey) {
    return {
      address,
      blocked: true,
      reason: "missing_ETHERSCAN_API_KEY",
      source: ETHERSCAN_V2_BASE,
      note: "Wallet lookups require a free Etherscan API key (Mantlescan runs on Etherscan's unified V2 multichain API now) — set ETHERSCAN_API_KEY.",
    };
  }

  const url =
    `${ETHERSCAN_V2_BASE}?chainid=${MANTLE_CHAIN_ID}&module=account&action=txlist` +
    `&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}` +
    `&sort=desc&apikey=${apiKey}`;

  try {
    const data = await fetchJson(url);

    // Etherscan-style APIs return HTTP 200 even for real errors (bad key,
    // invalid address, rate limit) — the failure only shows up in the JSON
    // body. Collapsing all of these into "empty" would hide real problems
    // as "wallet has no activity," so they're kept distinct.
    const isGenuinelyEmpty =
      data.status === "0" &&
      typeof data.message === "string" &&
      data.message.toLowerCase().includes("no transactions found");

    if (isGenuinelyEmpty) {
      return {
        address,
        blocked: false,
        empty: true,
        txCount: 0,
        transactions: [],
        source: ETHERSCAN_V2_BASE,
        note: "No transactions found for this address.",
      };
    }

    if (data.status !== "1" || !Array.isArray(data.result)) {
      return {
        address,
        blocked: true,
        reason: data.message || data.result || "unknown_api_error",
        source: ETHERSCAN_V2_BASE,
        note: "Etherscan V2 API returned an error for this address (check the API key and chain ID).",
      };
    }

    const txs = data.result;
    return {
      address,
      blocked: false,
      empty: false,
      txCount: txs.length,
      firstTx: txs[txs.length - 1]?.timeStamp
        ? new Date(Number(txs[txs.length - 1].timeStamp) * 1000).toISOString()
        : null,
      lastTx: txs[0]?.timeStamp
        ? new Date(Number(txs[0].timeStamp) * 1000).toISOString()
        : null,
      transactions: txs.slice(0, 20).map((t) => ({
        hash: t.hash,
        from: t.from,
        to: t.to,
        valueWei: t.value,
        timestamp: new Date(Number(t.timeStamp) * 1000).toISOString(),
        methodId: t.methodId,
      })),
      source: ETHERSCAN_V2_BASE,
    };
  } catch (err) {
    return {
      address,
      blocked: true,
      reason: "endpoint_unreachable",
      detail: String(err.message || err),
      source: ETHERSCAN_V2_BASE,
    };
  }
}

module.exports = {
  resolveMantleProtocol,
  getProtocolTvlHistory,
  getMantleChainTvlHistory,
  getWalletActivity,
  filterRange,
};
