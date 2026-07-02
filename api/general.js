// api/general.js
// Fallback "general research" intent for Mantle Atlas.
// Handles any Mantle ecosystem question the structured router doesn't support.
// Uses Gemini 2.5 Flash + Google Search grounding + a static Mantle knowledge base.
// Requires: GEMINI_API_KEY env var (same one you already use).

// ---------------------------------------------------------------------------
// STATIC MANTLE KNOWLEDGE BASE
// Injected into every general query so identity/basics questions answer
// instantly and accurately even if search grounding misses.
// ---------------------------------------------------------------------------
const MANTLE_KB = `
MANTLE ECOSYSTEM — CORE FACTS (verified as of mid-2026, treat as reliable baseline)

ORIGIN & GOVERNANCE
- Mantle Network is an Ethereum Layer 2 (optimistic rollup architecture with modular data availability via EigenDA).
- Mantle emerged from BitDAO. In 2023, BitDAO token holders approved the merger of BitDAO and Mantle under one brand ("One Brand, One Token"), converting BIT tokens to MNT.
- BitDAO was co-founded/backed by Ben Zhou (co-founder & CEO of Bybit) and launched with backing from Bybit and Peter Thiel among early supporters. Mantle does not have a single "founder" in the traditional sense — it is a DAO-governed ecosystem born from BitDAO. Key figures include Ben Zhou (Bybit) as the driving early backer, and the Mantle core contributor team led by figures such as Jordi Alexander (Chief Alchemist).
- Governance: Mantle Governance (MIPs — Mantle Improvement Proposals), voted by MNT holders. Mantle Treasury is one of the largest DAO treasuries in crypto (multi-billion USD).

TOKEN & ASSETS
- MNT: native token. Used for gas on Mantle Network, governance voting, and ecosystem incentives.
- mETH: Mantle's liquid staking token for ETH (via Mantle LSP / mETH Protocol). Stake ETH → receive mETH (yield-bearing).
- cmETH: restaked/liquid restaking version of mETH introduced by mETH Protocol, integrating restaking yield (e.g. EigenLayer, Symbiotic ecosystems).
- COOK: governance token of mETH Protocol.
- FBTC: Function's Bitcoin wrapped asset, prominent in the Mantle ecosystem for BTC liquidity.

KEY PRODUCTS & INITIATIVES
- Mantle Network: the L2 chain itself.
- mETH Protocol: liquid staking + restaking (mETH, cmETH, COOK).
- Function (FBTC): BTC on Mantle.
- Mantle Index Four (MI4): tokenized index fund initiative (crypto's "S&P 500" concept).
- Mantle Banking / UR: neobank initiative bridging fiat and crypto accounts.
- MantleX: AI initiative within the ecosystem (agents, AI-driven research and tooling).
- EcoFund: Mantle's ecosystem venture fund supporting builders.

NOTABLE ECOSYSTEM PROTOCOLS (DeFi on Mantle)
- Merchant Moe (DEX), Agni Finance (DEX), INIT Capital / Lendle (lending), Ondo Finance (RWA - USDY on Mantle), Ethena (USDe integrations), Pendle (yield trading), Stargate (bridging), Treehouse (fixed income).

TECH STACK
- Modular architecture: execution (OP Stack derived), data availability (EigenDA), settlement on Ethereum.
- Mantle v2 Tectonic upgrade aligned it closer to OP Stack / Bedrock.
- Native yield thesis: treasury and LSP integration make Mantle a "yield-bearing L2."

Answer questions using this baseline plus live search results. If search results conflict with this KB on recent events, prefer the search results and note the recency.
`.trim();

// ---------------------------------------------------------------------------
// GEMINI CALL WITH GOOGLE SEARCH GROUNDING
// ---------------------------------------------------------------------------
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function callGemini(question, { useSearch = true } = {}) {
  const systemPrompt = `You are Mantle Atlas, an institutional-grade research agent for the Mantle blockchain ecosystem.

Rules:
- Answer ONLY questions relevant to Mantle, its ecosystem, tokens, protocols, governance, or closely related crypto context. If the question is completely unrelated to crypto/Mantle, say so briefly and suggest a Mantle-related angle.
- Write in a concise, analytical, report style. Use markdown: a short title (##), a 2-3 sentence executive summary, then sections with headers as needed.
- Ground claims in the provided knowledge base and live search results. Cite sources inline as [1], [2] matching the source list you were given.
- Be precise about dates. Today is ${new Date().toISOString().slice(0, 10)} UTC.
- Never fabricate numbers. If data isn't available, say so.

KNOWLEDGE BASE:
${MANTLE_KB}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: question }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];

  const text =
    candidate?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";

  // Extract grounding sources (web citations) if present
  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  const sources = chunks
    .map((c, i) => ({
      index: i + 1,
      title: c?.web?.title || "Source",
      url: c?.web?.uri || "",
    }))
    .filter((s) => s.url);

  return { text, sources };
}

// ---------------------------------------------------------------------------
// CORE FUNCTION — import this from your existing router if you prefer:
//   const { runGeneralResearch } = require("./general");
// ---------------------------------------------------------------------------
async function runGeneralResearch(question) {
  let text, sources, grounded = true;

  try {
    ({ text, sources } = await callGemini(question, { useSearch: true }));
    if (!text) throw new Error("Empty grounded response");
  } catch (err) {
    // Grounding quota exhausted / tool error → degrade to KB-only answer
    console.warn("Grounded call failed, retrying without search:", err.message);
    grounded = false;
    ({ text, sources } = await callGemini(question, { useSearch: false }));
    sources = [];
  }

  let report = text;
  if (!grounded) {
    report +=
      "\n\n---\n*Live web grounding was temporarily unavailable — this report is based on Mantle Atlas's verified knowledge base.*";
  }
  if (sources.length) {
    report +=
      "\n\n---\n**Sources**\n" +
      sources.map((s) => `${s.index}. [${s.title}](${s.url})`).join("\n");
  }

  return {
    intent: "general_research",
    generatedAt: new Date().toISOString(),
    question,
    report, // markdown — render the same way as your other reports
    sources,
  };
}

// ---------------------------------------------------------------------------
// VERCEL SERVERLESS HANDLER — POST { "question": "..." }
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const question = (req.body?.question || "").trim();
  if (!question) {
    return res.status(400).json({ error: "Missing 'question' in body" });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "Question too long (500 char max)" });
  }

  try {
    const result = await runGeneralResearch(question);
    return res.status(200).json(result);
  } catch (err) {
    console.error("general research error:", err);
    return res.status(500).json({
      error: "Research failed",
      detail: String(err.message || err).slice(0, 200),
    });
  }
}

export { runGeneralResearch };
