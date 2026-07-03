// api/lib/promptEngine.js
//
// Two LLM calls, matching the PRD's "separate retrieval from reasoning":
//   1. extractIntent  — turns a natural-language question into a structured plan
//   2. generateReport — reasons ONLY over retrieved evidence, never invents facts
//
// Uses Google's Gemini API (free tier via Google AI Studio — no credit card,
// no expiration, generous daily quota on Flash). Swap MODEL or the fetch
// target below if you later move to a paid provider.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

async function callGemini({ system, userText, maxTokens = 1500 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      const err = new Error("RATE_LIMIT");
      err.code = "RATE_LIMIT";
      throw err;
    }
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const candidate = data.candidates && data.candidates[0];
  const text = candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  return text;
}

/**
 * Stage 1-3 of the PRD pipeline: intent detection, entity extraction, time
 * normalization — collapsed into a single structured-output call.
 */
async function extractIntent(question, nowISO) {
  const system = `You are the intent parser for Mantle Atlas, a blockchain research agent.
Given a user's research question, extract the researchable core of it as a
structured research plan.
Respond with ONLY a JSON object, no markdown fences, no preamble. Schema:

{
  "intent": "protocol_tvl" | "chain_tvl" | "comparison" | "unsupported",
  "protocolNameGuess": string | null,
  "protocolNameGuessB": string | null,   // only for comparison intent
  "timeRangeDays": number,               // resolve relative phrases like "last 90 days" to a day count; default 30 if unspecified
  "metric": "tvl" | "activity" | null
}

Current UTC time for resolving relative dates: ${nowISO}

Rules for mapping loosely-phrased or broad questions — don't require an
exact match to a template, find the closest researchable intent:
- If a specific protocol is named, use "protocol_tvl" (or "comparison" if two are named).
- If the question is broad/general about "Mantle", "the ecosystem", "what's
  happening", etc. with no specific protocol named, default to "chain_tvl" —
  chain-wide TVL trend is a reasonable researchable answer to a broad
  ecosystem question.
- If the question mixes a researchable part with a subjective/advice-seeking
  part (e.g. "what's going on with Mantle and should I move my liquidity
  there?"), extract ONLY the researchable part into the plan and ignore the
  advice-seeking framing — this agent reports evidence, it never gives
  investment recommendations. Do not use "unsupported" just because part of
  the question asked for advice.
- Only use "unsupported" if there is truly no researchable TVL question
  in there at all (e.g. pure greeting, pure opinion request with zero
  ecosystem/protocol reference, or a totally unrelated topic).`;

  const raw = await callGemini({
    system,
    userText: question,
    maxTokens: 400,
  });

  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { intent: "unsupported", raw };
  }
}

/**
 * Stage 7 of the PRD pipeline: reasoning over validated evidence only.
 * evidence is a plain JS object — never free text the model could confuse
 * for instructions.
 */
async function generateReport({ question, plan, evidence, confidence, caveats }) {
  const system = `You are Mantle Atlas, an institutional blockchain research analyst for the Mantle ecosystem.

Rules:
- You NEVER invent blockchain facts. Only reason over the JSON evidence provided in the user message.
- Distinguish clearly between Facts (directly in the evidence), Interpretation (your reasoning), and Unknowns (gaps in the evidence).
- Never exaggerate or speculate without grounding in the evidence.
- Tone: professional, objective, evidence-based. Not conversational, not hype-y.
- You NEVER give investment recommendations or tell the reader what to do with their money (no "you should," "consider moving," "a good opportunity," etc.). If the original research_question included advice-seeking framing (e.g. "should I...", "how should I play..."), add one brief line in the Executive Summary noting this report covers the evidence only, not a recommendation.
- Always end with a stated Confidence level (High/Medium/Low) and a one-line reason for that rating.
- Always include the data source(s) and the UTC date range covered.

Produce a Markdown report with EXACTLY these sections, in this order:
## Executive Summary
## Historical Context
## Evidence
## Interpretation
## Why It Matters
## Confidence
## Caveats & Limitations
## Sources

For the Sources section: render each source as a markdown link using the
exact "citeUrl" fields found in the evidence JSON (these are human-readable
pages, not raw API endpoints) — e.g.
"- [DefiLlama — Ondo Finance](https://defillama.com/protocol/ondo-finance)".
Never invent, guess, or alter a URL. If a piece of evidence has no citeUrl,
name the provider in plain text without a link instead of fabricating one.
If a piece of evidence has "scope": "mantle-only", add a short parenthetical
after that link noting the page defaults to a combined all-chain view and
the reader should filter to Mantle to see the figures used in this report —
otherwise the numbers on the page will look inconsistent with this report.

Keep it tight: this is a research brief, not an essay. Prefer short paragraphs and bullet points over long prose blocks.`;

  const userPayload = {
    research_question: question,
    research_plan: plan,
    evidence,
    system_computed_confidence: confidence,
    system_flagged_caveats: caveats,
  };

  return callGemini({
    system,
    userText: `Research question: "${question}"\n\nStructured evidence (JSON):\n${JSON.stringify(
      userPayload,
      null,
      2
    )}\n\nProduce the institutional report now.`,
    maxTokens: 1800,
  });
}

module.exports = { extractIntent, generateReport };
