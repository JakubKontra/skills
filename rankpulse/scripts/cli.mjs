#!/usr/bin/env node
import fs from "fs";
import path from "path";
import {
  loadConfig,
  getProjectDir,
  getStorageDir,
  getReportsDir,
  getScanHistoryPath,
  getBaselinesDir,
} from "./config.mjs";

function json(obj) {
  console.log(JSON.stringify(obj));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readStdin() {
  return fs.readFileSync(0, "utf-8");
}

// ─── Config ──────────────────────────────────────────────────────────────────

function showConfig() {
  try {
    json({ command: "config", status: "ok", config: loadConfig() });
  } catch (e) {
    json({ command: "config", status: "error", message: e.message });
  }
}

// ─── Save Report ─────────────────────────────────────────────────────────────

function saveReport(title) {
  if (!title) {
    json({ command: "save-report", status: "error", message: "Title required" });
    return;
  }

  const content = readStdin();
  const reportsDir = getReportsDir();
  ensureDir(reportsDir);

  const ts = timestamp();
  const slug = slugify(title);
  const filename = `${ts}-${slug}.md`;
  const filepath = path.join(reportsDir, filename);

  fs.writeFileSync(filepath, content, "utf-8");

  // Update scan history
  updateScanHistory(ts, title, filepath, content);

  json({ command: "save-report", status: "ok", path: filepath, filename });
}

function updateScanHistory(ts, title, reportPath, content) {
  const historyPath = getScanHistoryPath();
  ensureDir(path.dirname(historyPath));

  let history = [];
  if (fs.existsSync(historyPath)) {
    try {
      history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    } catch {
      history = [];
    }
  }

  // Extract finding counts from report content
  const criticalMatch = content.match(/### Critical \((\d+) finding/);
  const highMatch = content.match(/### High \((\d+) finding/);
  const mediumMatch = content.match(/### Medium \((\d+) finding/);
  const lowMatch = content.match(/### Low \((\d+) finding/);

  // Extract score from report
  const scoreMatch = content.match(/\*\*Overall\*\*\s*\|\s*\*\*([A-F])\s*\((\d+)\/100\)/);

  // Store report path relative to project root
  const relativeReportPath = path.relative(getProjectDir(), reportPath);

  history.push({
    date: ts,
    title,
    reportPath: relativeReportPath,
    findingCounts: {
      critical: criticalMatch ? parseInt(criticalMatch[1]) : 0,
      high: highMatch ? parseInt(highMatch[1]) : 0,
      medium: mediumMatch ? parseInt(mediumMatch[1]) : 0,
      low: lowMatch ? parseInt(lowMatch[1]) : 0,
    },
    grade: scoreMatch ? scoreMatch[1] : null,
    score: scoreMatch ? parseInt(scoreMatch[2]) : null,
  });

  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
}

// ─── Last Run ────────────────────────────────────────────────────────────────

function lastRun() {
  const historyPath = getScanHistoryPath();
  if (!fs.existsSync(historyPath)) {
    json({ command: "last-run", status: "ok", lastRun: null, message: "No scans found" });
    return;
  }

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    if (history.length === 0) {
      json({ command: "last-run", status: "ok", lastRun: null, message: "No scans found" });
      return;
    }
    const last = history[history.length - 1];
    json({ command: "last-run", status: "ok", lastRun: last, totalScans: history.length });
  } catch {
    json({ command: "last-run", status: "error", message: "Failed to read scan history" });
  }
}

// ─── History ─────────────────────────────────────────────────────────────────

function showHistory() {
  const historyPath = getScanHistoryPath();
  if (!fs.existsSync(historyPath)) {
    json({ command: "history", status: "ok", scans: [], message: "No scans found" });
    return;
  }

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
    json({ command: "history", status: "ok", scans: [...history].reverse(), totalScans: history.length });
  } catch {
    json({ command: "history", status: "error", message: "Failed to read scan history" });
  }
}

// ─── Save Baseline ──────────────────────────────────────────────────────────

function saveBaseline(title) {
  if (!title) {
    json({ command: "save-baseline", status: "error", message: "Title required" });
    return;
  }

  const content = readStdin();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    json({ command: "save-baseline", status: "error", message: "Invalid JSON on stdin" });
    return;
  }

  const baselinesDir = getBaselinesDir();
  ensureDir(baselinesDir);

  const ts = timestamp();
  const slug = slugify(title);
  const filename = `${ts}-${slug}.json`;
  const filepath = path.join(baselinesDir, filename);

  parsed.savedDate = ts;
  parsed.title = title;

  fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2), "utf-8");

  json({ command: "save-baseline", status: "ok", path: filepath, filename });
}

// ─── Compare Baseline ───────────────────────────────────────────────────────

function compareBaseline() {
  const baselinesDir = getBaselinesDir();
  if (!fs.existsSync(baselinesDir)) {
    json({ command: "compare-baseline", status: "ok", baselines: [], message: "No baselines found" });
    return;
  }

  const files = fs.readdirSync(baselinesDir).filter((f) => f.endsWith(".json")).sort();
  if (files.length === 0) {
    json({ command: "compare-baseline", status: "ok", baselines: [], message: "No baselines found" });
    return;
  }

  const baselines = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(baselinesDir, f), "utf-8"));
    } catch {
      return { file: f, error: "Failed to parse" };
    }
  });

  const latest = baselines[baselines.length - 1];
  const previous = baselines.length > 1 ? baselines[baselines.length - 2] : null;

  json({
    command: "compare-baseline",
    status: "ok",
    latest,
    previous,
    totalBaselines: baselines.length,
    allBaselines: baselines.map((b) => ({ title: b.title, date: b.savedDate })),
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "config":
    showConfig();
    break;
  case "save-report":
    saveReport(args.join(" "));
    break;
  case "last-run":
    lastRun();
    break;
  case "history":
    showHistory();
    break;
  case "save-baseline":
    saveBaseline(args.join(" "));
    break;
  case "compare-baseline":
    compareBaseline();
    break;
  default:
    json({
      command: cmd || null,
      status: "error",
      message: `Unknown command: ${cmd || "(none)"}. Available: config, save-report, last-run, history, save-baseline, compare-baseline`,
    });
}
