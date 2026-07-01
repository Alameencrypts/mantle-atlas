const questionInput = document.getElementById("questionInput");
const submitBtn = document.getElementById("submitBtn");
const submitLabel = document.getElementById("submitLabel");
const resultArea = document.getElementById("resultArea");
const ledger = document.getElementById("ledger");
const reportBody = document.getElementById("reportBody");
const reportActions = document.getElementById("reportActions");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

let lastReportMarkdown = "";

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
    const hosts = [...new Set(meta.endpointsUsed.map((u) => {
      try { return new URL(u).hostname; } catch { return u; }
    }))];
    items.push(`<span class="ledger-item"><span class="ledger-label">source</span><span class="ledger-value">${hosts.join(", ")}</span></span>`);
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
      if (data.metadata.blocked) {
        setStatus("err", "execution blocked");
      } else {
        setStatus("live", "report generated");
      }
    } else {
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
