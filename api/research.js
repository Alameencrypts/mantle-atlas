// api/research.js — Vercel serverless function
// POST { question: string } -> { report, metadata }

const {
  resolveMantleProtocol,
  getProtocolTvlHistory,
  getMantleChainTvlHistory,
  getWalletActivity,
  filterRange,
} = require("./lib/dataSources");
const { extractIntent, generateReport } = require("./lib/promptEngine");

function daysAgoISO(days, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function blockedReport(reason) {
  return {
    blocked: true,
    executionSource: null,
    endpointUsed: null,
    utcQueryTime: new Date().toISOString(),
    reason,
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(200).json({
      report:
        "## Execution Blocked\n\nThe reasoning layer is not configured (missing `GEMINI_API_KEY`). This is a configuration gap, not a data-availability issue — no research was attempted.",
      metadata: blockedReport("missing_GEMINI_API_KEY"),
    });
    return;
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string" || question.trim().length < 4) {
    res.status(400).json({ error: "Provide a research question in `question`." });
    return;
  }

  const nowISO = new Date().toISOString();
  const queryStart = Date.now();

  let plan;
  try {
    plan = await extractIntent(question, nowISO);
  } catch (err) {
    res.status(200).json({
      report: `## Execution Blocked\n\nCould not reach the reasoning layer to interpret this question.\n\n**Detail:** ${err.message}`,
      metadata: blockedReport("intent_extraction_failed"),
    });
    return;
  }

  if (plan.intent === "unsupported") {
    res.status(200).json({
      report:
        "## Unable to Process\n\nThis question doesn't map to a supported research type yet. Mantle Atlas currently supports:\n\n- Protocol TVL analysis (e.g. \"Why did Ondo TVL increase over the last 90 days?\")\n- Wallet lookups (paste a 0x... address)\n- Mantle chain-wide TVL trends\n- Two-protocol comparisons\n\nTry rephrasing around one of these.",
      metadata: { blocked: false, intent: "unsupported", utcQueryTime: nowISO },
    });
    return;
  }

  const timeRangeDays = plan.timeRangeDays || 30;
  const startISO = daysAgoISO(timeRangeDays, new Date(nowISO));
  const endISO = nowISO;

  const evidence = {};
  const caveats = [];
  let confidence = "Medium";
  let endpointUsed = [];

  try {
    if (plan.intent === "protocol_tvl" || plan.intent === "comparison") {
      const names =
        plan.intent === "comparison"
          ? [plan.protocolNameGuess, plan.protocolNameGuessB].filter(Boolean)
          : [plan.protocolNameGuess].filter(Boolean);

      if (names.length === 0) {
        caveats.push("No protocol name could be extracted from the question.");
        confidence = "Low";
      }

      evidence.protocols = [];
      for (const nameGuess of names) {
        const resolved = await resolveMantleProtocol(nameGuess);
        if (!resolved) {
          caveats.push(`Could not resolve "${nameGuess}" to a known protocol deployed on Mantle.`);
          continue;
        }
        const history = await getProtocolTvlHistory(resolved.slug);
        const windowed = filterRange(history.points, startISO, endISO);
        evidence.protocols.push({
          queriedAs: nameGuess,
          resolvedName: resolved.name,
          slug: resolved.slug,
          scope: history.scope,
          currentTvl: history.currentTvl,
          windowPoints: windowed,
          windowStart: windowed[0]?.tvl ?? null,
          windowEnd: windowed[windowed.length - 1]?.tvl ?? null,
          category: resolved.category || null,
        });
        endpointUsed.push(history.source);
      }

      if (evidence.protocols.length === 0) {
        confidence = "Low";
        caveats.push("No usable TVL evidence was retrieved for this question.");
      } else if (evidence.protocols.some((p) => p.windowPoints.length < 2)) {
        confidence = "Medium";
        caveats.push("Sparse data points within the requested window; trend may be under-resolved.");
      } else {
        confidence = "High";
      }
    } else if (plan.intent === "chain_tvl") {
      const chain = await getMantleChainTvlHistory();
      const windowed = filterRange(chain.points, startISO, endISO);
      evidence.chainTvl = {
        currentTvl: chain.currentTvl,
        windowPoints: windowed,
        windowStart: windowed[0]?.tvl ?? null,
        windowEnd: windowed[windowed.length - 1]?.tvl ?? null,
      };
      endpointUsed.push(chain.source);
      confidence = windowed.length >= 2 ? "High" : "Low";
    } else if (plan.intent === "wallet_lookup") {
      if (!plan.walletAddress) {
        caveats.push("No wallet address detected in the question.");
        confidence = "Low";
      } else {
        const wallet = await getWalletActivity(plan.walletAddress);
        evidence.wallet = wallet;
        endpointUsed.push(wallet.source);
        if (wallet.blocked) {
          confidence = "Low";
          caveats.push(`Wallet endpoint unreachable: ${wallet.reason}.`);
        } else if (wallet.empty) {
          confidence = "Low";
          caveats.push("No transaction history found for this address.");
        } else {
          confidence = "Medium";
        }
      }
    }
  } catch (err) {
    caveats.push(`Data retrieval error: ${err.message}`);
    confidence = "Low";
  }

  let reportMarkdown;
  try {
    reportMarkdown = await generateReport({
      question,
      plan,
      evidence,
      confidence,
      caveats,
    });
  } catch (err) {
    res.status(200).json({
      report: `## Execution Blocked\n\nEvidence was retrieved successfully but the reasoning layer failed to produce a report.\n\n**Detail:** ${err.message}`,
      metadata: {
        blocked: true,
        reason: "report_generation_failed",
        evidence,
        utcQueryTime: nowISO,
      },
    });
    return;
  }

  res.status(200).json({
    report: reportMarkdown,
    metadata: {
      blocked: false,
      intent: plan.intent,
      utcQueryTime: nowISO,
      utcAnalysisRangeStart: startISO,
      utcAnalysisRangeEnd: endISO,
      endpointsUsed: endpointUsed,
      confidence,
      caveats,
      latencyMs: Date.now() - queryStart,
    },
  });
};
