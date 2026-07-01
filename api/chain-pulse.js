// api/chain-pulse.js — Vercel serverless function
// GET -> { points, currentTvl, changePct30d, source }
// Powers the always-visible "live" sparkline on the landing view.
// Deliberately has zero LLM cost: this is pure data, refreshed on page load.

const { getMantleChainTvlHistory, filterRange } = require("./lib/dataSources");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET" });
    return;
  }

  try {
    const chain = await getMantleChainTvlHistory();
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 30);

    const windowed = filterRange(chain.points, start.toISOString(), now.toISOString());
    const first = windowed[0]?.tvl ?? null;
    const last = windowed[windowed.length - 1]?.tvl ?? chain.currentTvl;
    const changePct30d =
      first && last ? Number((((last - first) / first) * 100).toFixed(2)) : null;

    res.status(200).json({
      points: windowed,
      currentTvl: chain.currentTvl,
      changePct30d,
      source: chain.source,
    });
  } catch (err) {
    res.status(200).json({
      points: [],
      currentTvl: null,
      changePct30d: null,
      error: err.message,
    });
  }
};
