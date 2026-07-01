const questionInput = document.getElementById("questionInput");
const submitBtn = document.getElementById("submitBtn");
const submitLabel = document.getElementById("submitLabel");
const resultArea = document.getElementById("resultArea");
const ledger = document.getElementById("ledger");
const chartWrap = document.getElementById("chartWrap");
const reportBody = document.getElementById("reportBody");
const reportActions = document.getElementById("reportActions");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

let lastReportMarkdown = "";

const CHART_COLORS = ["#3FE28C", "#D9A44E", "#7FA394", "#E2735F"];

function fmtUsdCompact(n) {
  if (n === null || n === undefined) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(0);
}

function fmtShortDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Build an inline SVG line chart (no dependency) for one or more series
 * of { date, tvl } points. Returns an HTML string.
 */
function buildLineChartSVG(series, { width = 640, height = 220 } = {}) {
  const padL = 54, padR = 14, padT = 14, padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const allVals = series.flatMap((s) => s.points.map((p) => p.tvl));
  const minV = Math.min(...allVals);
  const maxV = Math.max(...allVals);
  const span = maxV - minV || 1;

  const allDates = series[0].points.map((p) => p.date);
  const n = allDates.length;

  const x = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - minV) / span) * innerH;

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">`;

  // horizontal gridlines + y labels (min/mid/max)
  [0, 0.5, 1].forEach((t) => {
    const val = minV + span * t;
    const yy = padT + innerH - t * innerH;
    svg += `<line x1="${padL}" y1="${yy}" x2="${width - padR}" y2="${yy}" stroke="#1E3A30" stroke-width="1" />`;
    svg += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" class="chart-axis-label">${fmtUsdCompact(val)}</text>`;
  });

  // x labels: first and last date
  svg += `<text x="${padL}" y="${height - 6}" class="chart-axis-label">${fmtShortDate(allDates[0])}</text>`;
  svg += `<text x="${width - padR}" y="${height - 6}" text-anchor="end" class="chart-axis-label">${fmtShortDate(allDates[n - 1])}</text>`;

  series.forEach((s, idx) => {
    const color = CHART_COLORS[idx % CHART_COLORS.length];
    const pts = s.points.map((p, i) => `${x(i)},${y(p.tvl)}`).join(" ");
    const areaPts = `${padL},${padT + innerH} ${pts} ${x(n - 1)},${padT + innerH}`;

    if (idx === 0) {
      svg += `<polygon points="${areaPts}" fill="${color}" opacity="0.08" />`;
    }
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`;

    // endpoint dot
    const last = s.points[s.points.length - 1];
    svg += `<circle cx="${x(n - 1)}" cy="${y(last.tvl)}" r="3.5" fill="${color}" />`;
  });

  svg += `</svg>`;
  return svg;
}

function renderChart(chartSeries) {
  if (!chartSeries || chartSeries.length === 0) {
    chartWrap.hidden = true;
    chartWrap.innerHTML = "";
    return;
  }

  const legend = chartSeries
    .map(
      (s, i) =>
        `<div class="chart-legend-item"><span class="chart-legend-swatch" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${s.label}</div>`
    )
    .join("");

  chartWrap.innerHTML = `<div class="chart-legend">${legend}</div>${buildLineChartSVG(chartSeries)}`;
  chartWrap.hidden = false;
}

/**
 * Always-on landing "pulse" — Mantle chain TVL, fetched independently of
 * any question. Pure data endpoint, no LLM cost.
 */
async function loadPulse() {
  const pulse = document.getElementById("pulse");
  const pulseValue = document.getElementById("pulseValue");
  const pulseChange = document.getElementById("pulseChange");
  const pulseSpark = document.getElementById("pulseSpark");

  try {
    const res = await fetch("/api/chain-pulse");
    const data = await res.json();
    if (!data.points || data.points.length < 2) return;

    pulseValue.textContent = fmtUsdCompact(data.currentTvl);

    if (data.changePct30d !== null) {
      const up = data.changePct30d >= 0;
      pulseChange.textContent = `${up ? "▲" : "▼"} ${Math.abs(data.changePct30d)}% / 30d`;
      pulseChange.className = "pulse-change " + (up ? "up" : "down");
    }

    const vals = data.points.map((p) => p.tvl);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = maxV - minV || 1;
    const w = 240, h = 48;
    const pathPts = data.points
      .map((p, i) => {
        const px = (i / (data.points.length - 1)) * w;
        const py = h - ((p.tvl - minV) / span) * h;
        return `${px},${py}`;
      })
      .join(" ");

    pulseSpark.innerHTML = `<polyline points="${pathPts}" fill="none" stroke="#3FE28C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
    pulse.hidden = false;
  } catch (e) {
    // silent — the pulse is a nice-to-have, never block the main UI on it
  }
}
loadPulse();

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    questionInput.value = chip.dataset.q;
    questionInput.focus();
  });
});

function setStatus(mode, text) {
  statusDot.className = "status-dot" + (mode ? " " + mode : "");
  statusText.textContent = text;
}

function confidenceClass(level) {
  if (!level) return "";
  const l = level.toLowerCase();
  if (l.includes("high")) return "confidence-high";
  if (l.includes("low")) return "confidence-low";
  return "confidence-medium";
}

function fmtDate(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function renderLedger(meta) {
  const items = [];

  items.push(`<span class="ledger-item"><span class="ledger-label">query</span><span class="ledger-value">${fmtDate(meta.utcQueryTime)} UTC</span></span>`);

  if (meta.utcAnalysisRangeStart) {
    items.push(`<span class="ledger-item"><span class="ledger-label">range</span><span class="ledger-value">${fmtDate(meta.utcAnalysisRangeStart)} → ${fmtDate(meta.utcAnalysisRangeEnd)}</span></span>`);
  }

  if (meta.intent) {
    items.push(`<span class="ledger-item"><span class="ledger-label">intent</span><span class="ledger-value">${meta.intent}</span></span>`);
  }

  if (meta.endpointsUsed && meta.endpointsUsed.length) {
    const seen = new Set();
    const linkParts = [];
    for (const u of meta.endpointsUsed) {
      let host, href;
      try {
        const parsed = new URL(u);
        host = parsed.hostname;
        href = u;
      } catch {
        host = u;
        href = null;
      }
      if (seen.has(host)) continue;
      seen.add(host);
      linkParts.push(
        href
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer" class="ledger-value ledger-link">${host}</a>`
          : `<span class="ledger-value">${host}</span>`
      );
    }
    items.push(`<span class="ledger-item"><span class="ledger-label">source</span>${linkParts.join(", ")}</span>`);
  }

  if (meta.confidence) {
    items.push(`<span class="ledger-item"><span class="ledger-label">confidence</span><span class="ledger-value ${confidenceClass(meta.confidence)}">${meta.confidence}</span></span>`);
  }

  ledger.innerHTML = items.join("");
}

async function submitQuestion() {
  const question = questionInput.value.trim();
  if (!question) return;

  submitBtn.disabled = true;
  submitLabel.textContent = "Researching…";
  setStatus("busy", "querying indexer + reasoning layer");
  resultArea.hidden = false;
  ledger.innerHTML = "";
  chartWrap.hidden = true;
  chartWrap.innerHTML = "";
  reportBody.innerHTML = `<p style="color:var(--parchment-dim); font-family:'IBM Plex Mono',monospace; font-size:13px;">Extracting intent → retrieving evidence → validating → reasoning…</p>`;
  reportActions.hidden = true;

  try {
    const res = await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await res.json();

    lastReportMarkdown = data.report || "No report returned.";
    reportBody.innerHTML = marked.parse(lastReportMarkdown);

    if (data.metadata) {
      renderLedger(data.metadata);
      renderChart(data.metadata.chartSeries);
      if (data.metadata.blocked) {
        setStatus("err", "execution blocked");
      } else {
        setStatus("live", "report generated");
      }
    } else {
      renderChart(null);
      setStatus("live", "done");
    }

    reportActions.hidden = false;
  } catch (err) {
    reportBody.innerHTML = `<p style="color:var(--signal-red)">Request failed: ${err.message}</p>`;
    setStatus("err", "request failed");
  } finally {
    submitBtn.disabled = false;
    submitLabel.textContent = "Research";
  }
}

submitBtn.addEventListener("click", submitQuestion);
questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitQuestion();
});

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(lastReportMarkdown);
  copyBtn.textContent = "Copied";
  setTimeout(() => (copyBtn.textContent = "Copy report"), 1200);
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([lastReportMarkdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mantle-atlas-report.md";
  a.click();
  URL.revokeObjectURL(url);
});
