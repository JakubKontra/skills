#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadConfig,
  getProjectDir,
  getStorageDir,
  getReportsDir,
  getScanHistoryPath,
  getSuppressionsPath,
  getAuditsDir,
  getHaltFilePath,
  getPauseFilePath,
  getStateSnapshotsDir,
  getAuditLogPath,
  getRoEPath,
} from "./config.mjs";
import { validateRoE, loadRoE } from "./roe.mjs";
import { appendEntry, verifyChain, EVENTS, CLASSIFICATIONS, sha256, loadAll } from "./audit-log.mjs";
import { writeConformance } from "./conformance.mjs";
import { runHook, getStatus as scanHookStatus, PHASES as SCAN_HOOK_PHASES } from "./scan-hook.mjs";

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

  // Extract finding counts from report content (look for severity headers)
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

// ─── Save SARIF ──────────────────────────────────────────────────────────────

function saveSarif(title) {
  if (!title) {
    json({ command: "save-sarif", status: "error", message: "Title required" });
    return;
  }

  const content = readStdin();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    json({ command: "save-sarif", status: "error", message: "Invalid JSON on stdin" });
    return;
  }

  if (!parsed.version || !parsed.runs) {
    json({ command: "save-sarif", status: "error", message: "Missing required SARIF fields (version, runs)" });
    return;
  }

  const reportsDir = getReportsDir();
  ensureDir(reportsDir);

  const ts = timestamp();
  const slug = slugify(title);
  const filename = `${ts}-${slug}.sarif.json`;
  const filepath = path.join(reportsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2), "utf-8");

  json({ command: "save-sarif", status: "ok", path: filepath, filename });
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

// ─── Suppress ────────────────────────────────────────────────────────────────

function suppress(ruleId, location) {
  if (!ruleId) {
    json({ command: "suppress", status: "error", message: "ruleId required" });
    return;
  }

  const suppressionsPath = getSuppressionsPath();
  ensureDir(path.dirname(suppressionsPath));

  let suppressions = [];
  if (fs.existsSync(suppressionsPath)) {
    try {
      suppressions = JSON.parse(fs.readFileSync(suppressionsPath, "utf-8"));
    } catch {
      suppressions = [];
    }
  }

  const key = location ? `${ruleId}:${location}` : ruleId;
  const existing = suppressions.find((s) => s.key === key);
  if (existing) {
    json({ command: "suppress", status: "ok", message: "Already suppressed", suppression: existing });
    return;
  }

  const entry = {
    key,
    ruleId,
    location: location || null,
    addedDate: timestamp(),
  };

  suppressions.push(entry);
  fs.writeFileSync(suppressionsPath, JSON.stringify(suppressions, null, 2), "utf-8");

  json({ command: "suppress", status: "ok", suppression: entry });
}

// ─── Ingest Audit ───────────────────────────────────────────────────────────

function ingestAudit(title) {
  if (!title) {
    json({ command: "ingest-audit", status: "error", message: "Title required" });
    return;
  }

  const content = readStdin();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    json({ command: "ingest-audit", status: "error", message: "Invalid JSON on stdin. The agent should parse the raw audit document and pipe structured JSON." });
    return;
  }

  if (!parsed.findings || !Array.isArray(parsed.findings)) {
    json({ command: "ingest-audit", status: "error", message: "JSON must have a 'findings' array" });
    return;
  }

  const auditsDir = getAuditsDir();
  ensureDir(auditsDir);

  const slug = slugify(title);
  const filename = `${slug}.json`;
  const filepath = path.join(auditsDir, filename);

  // Add ingestion metadata
  parsed.ingestedDate = timestamp();
  parsed.title = parsed.title || title;

  fs.writeFileSync(filepath, JSON.stringify(parsed, null, 2), "utf-8");

  json({
    command: "ingest-audit",
    status: "ok",
    path: filepath,
    filename,
    findingCount: parsed.findings.length,
    title: parsed.title,
  });
}

// ─── List Audits ────────────────────────────────────────────────────────────

function listAudits() {
  const auditsDir = getAuditsDir();
  if (!fs.existsSync(auditsDir)) {
    json({ command: "list-audits", status: "ok", audits: [], message: "No audits ingested" });
    return;
  }

  const files = fs.readdirSync(auditsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    json({ command: "list-audits", status: "ok", audits: [], message: "No audits ingested" });
    return;
  }

  const audits = files.map((f) => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(auditsDir, f), "utf-8"));
      const findings = data.findings || [];
      const open = findings.filter((fi) => fi.status === "open").length;
      const fixed = findings.filter((fi) => fi.status === "fixed").length;
      const notScanned = findings.filter((fi) => fi.status === "not-scanned" || !fi.vulniqMapping).length;

      return {
        file: f,
        title: data.title,
        ingestedDate: data.ingestedDate,
        metadata: data.metadata || {},
        totalFindings: findings.length,
        open,
        fixed,
        notScanned,
      };
    } catch {
      return { file: f, error: "Failed to parse" };
    }
  });

  json({ command: "list-audits", status: "ok", audits });
}

// ─── RoE ─────────────────────────────────────────────────────────────────────

function roeCommand(sub) {
  if (sub === "validate" || !sub) {
    const result = validateRoE();
    let scopeHash = null;
    const roePath = getRoEPath();
    if (fs.existsSync(roePath)) {
      const raw = fs.readFileSync(roePath, "utf-8");
      scopeHash = sha256(raw);
      try {
        appendEntry({
          event: "scope.hash.recorded",
          classification: "PUBLIC",
          context: { path: path.relative(getProjectDir(), roePath), scopeHash },
          reasoning: "RoE file hashed for integrity monitoring (APTS-MR-012, AL-016)",
        });
      } catch {
        // audit log append failure should not block validation
      }
    }
    json({ command: "roe", status: result.status, ...result, scopeHash });
    return;
  }
  if (sub === "show") {
    json({ command: "roe", status: "ok", roe: loadRoE() });
    return;
  }
  if (sub === "hash") {
    const roePath = getRoEPath();
    if (!fs.existsSync(roePath)) {
      json({ command: "roe", status: "error", message: `No RoE at ${roePath}` });
      return;
    }
    const raw = fs.readFileSync(roePath, "utf-8");
    json({ command: "roe", status: "ok", path: roePath, scopeHash: sha256(raw) });
    return;
  }
  json({ command: "roe", status: "error", message: `Unknown subcommand '${sub}'. Use: validate, show, hash` });
}

// ─── Audit Log (APTS D5) ─────────────────────────────────────────────────────

function auditLogCommand(event) {
  if (!event) {
    json({ command: "audit-log", status: "error", message: `Event name required. Allowed: ${EVENTS.join(", ")}` });
    return;
  }
  const stdin = fs.readFileSync(0, "utf-8").trim();
  let body = {};
  if (stdin) {
    try {
      body = JSON.parse(stdin);
    } catch (e) {
      json({ command: "audit-log", status: "error", message: `Invalid JSON on stdin: ${e.message}` });
      return;
    }
  }
  try {
    const entry = appendEntry({ ...body, event });
    json({ command: "audit-log", status: "ok", entry });
  } catch (e) {
    json({ command: "audit-log", status: "error", message: e.message });
  }
}

function auditVerifyCommand() {
  const result = verifyChain();
  json({ command: "audit-verify", ...result });
}

// ─── Halt (kill switch + state dump, APTS HO-008) ────────────────────────────

function dumpStateSnapshot(kind, reason) {
  const dir = getStateSnapshotsDir();
  ensureDir(dir);
  const ts = timestamp();
  const filename = `${kind}-state-${ts}.json`;
  const filepath = path.join(dir, filename);

  let lastAuditEntry = null;
  let auditLength = 0;
  try {
    const all = loadAll();
    auditLength = all.length;
    lastAuditEntry = all[all.length - 1] || null;
  } catch {
    // audit log unreadable; snapshot proceeds with null
  }

  let roeSummary = null;
  try {
    const roe = loadRoE();
    roeSummary = roe._found
      ? {
          operator: roe.operator || null,
          projectRoot: roe.projectRoot,
          scanWindow: roe.scanWindow || null,
          allowedPathsCount: (roe.allowedPaths || []).length,
          forbiddenPathsCount: (roe.forbiddenPaths || []).length,
        }
      : { _found: false };
  } catch {
    roeSummary = { _found: false, error: "failed to load" };
  }

  let config = null;
  try {
    config = loadConfig();
  } catch {
    // fall through
  }

  const snapshot = {
    kind,
    reason: reason || null,
    ts,
    auditLogIndex: auditLength,
    lastAuditEntry,
    roe: roeSummary,
    autonomyLevel: config?.autonomyLevel || null,
    haltFile: getHaltFilePath(),
    pauseFile: getPauseFilePath(),
  };

  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2), "utf-8");
  return { path: filepath, filename, auditLogIndex: auditLength };
}

function haltCommand(flag) {
  const p = getHaltFilePath();
  ensureDir(path.dirname(p));
  if (flag === "--release") {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    json({ command: "halt", status: "ok", released: true, path: p });
    return;
  }
  fs.writeFileSync(p, `HALT triggered at ${new Date().toISOString()}\n`, "utf-8");
  const snapshot = dumpStateSnapshot("halt", "Operator invoked `cli.mjs halt`");
  try {
    appendEntry({
      event: "halt.triggered",
      classification: "STANDARD",
      reasoning: "Operator invoked `cli.mjs halt`",
      context: { snapshotPath: path.relative(getProjectDir(), snapshot.path), auditLogIndex: snapshot.auditLogIndex },
    });
  } catch {
    // audit log append failure should not block halt
  }
  json({ command: "halt", status: "ok", halted: true, path: p, snapshot });
}

function haltStatus() {
  const p = getHaltFilePath();
  const active = fs.existsSync(p);
  json({ command: "halt-status", status: "ok", active, path: p });
}

// ─── Pause (preserves state, APTS HO-006) ────────────────────────────────────

function pauseCommand(flag) {
  const p = getPauseFilePath();
  ensureDir(path.dirname(p));
  if (flag === "--release") {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    try {
      appendEntry({
        event: "pause.released",
        classification: "PUBLIC",
        reasoning: "Operator invoked `cli.mjs pause --release`",
      });
    } catch {}
    json({ command: "pause", status: "ok", released: true, path: p });
    return;
  }
  fs.writeFileSync(p, `PAUSE requested at ${new Date().toISOString()}\n`, "utf-8");
  const snapshot = dumpStateSnapshot("pause", "Operator invoked `cli.mjs pause`");
  try {
    appendEntry({
      event: "pause.requested",
      classification: "PUBLIC",
      reasoning: "Operator invoked `cli.mjs pause`",
      context: { snapshotPath: path.relative(getProjectDir(), snapshot.path), auditLogIndex: snapshot.auditLogIndex },
    });
  } catch {}
  json({ command: "pause", status: "ok", paused: true, path: p, snapshot });
}

function pauseStatus() {
  const p = getPauseFilePath();
  const active = fs.existsSync(p);
  json({ command: "pause-status", status: "ok", active, path: p });
}

// ─── Conformance Claim ───────────────────────────────────────────────────────

function conformanceCommand() {
  try {
    const result = writeConformance();
    json({
      command: "conformance",
      status: "ok",
      path: result.path,
      filename: result.filename,
      tallies: result.claim.tallies,
      auditChain: result.claim.auditChain.status,
    });
  } catch (e) {
    json({ command: "conformance", status: "error", message: e.message });
  }
}

// ─── Scan-hook (step-boundary enforcement) ───────────────────────────────────

function scanHookCommand(phase) {
  if (phase === "status") {
    const s = scanHookStatus();
    json({
      command: "scan-hook",
      status: "ok",
      lastPhase: s.lastPhase,
      nextExpected: s.nextExpected,
      complete: s.complete,
    });
    return;
  }

  if (!phase) {
    json({
      command: "scan-hook",
      status: "error",
      message: `Phase required. Allowed: ${SCAN_HOOK_PHASES.join(", ")}, or 'status'`,
    });
    process.exit(1);
  }

  let stdin = "";
  if (!process.stdin.isTTY) {
    stdin = fs.readFileSync(0, "utf-8").trim();
  }
  let body = {};
  if (stdin) {
    try {
      body = JSON.parse(stdin);
    } catch (e) {
      json({ command: "scan-hook", status: "error", message: `Invalid JSON on stdin: ${e.message}` });
      process.exit(1);
    }
  }

  try {
    const result = runHook(phase, body);
    const out = { command: "scan-hook", status: "ok", entry: result.entry, phase };
    if (result.warning) out.warning = result.warning;
    json(out);
  } catch (e) {
    const out = {
      command: "scan-hook",
      status: "error",
      message: e.message,
    };
    if (e.expected) out.expected = e.expected;
    if (e.lastPhase) out.lastPhase = e.lastPhase;
    json(out);
    process.exit(1);
  }
}

// ─── APTS Checklist (summary) ────────────────────────────────────────────────

function aptsChecklist() {
  try {
    const foundationPath = fileURLToPath(new URL("../references/apts-foundation.json", import.meta.url));
    const foundation = JSON.parse(fs.readFileSync(foundationPath, "utf-8"));
    const summary = foundation.domains.map((d) => ({
      id: d.id,
      name: d.name,
      reqs: d.requirements.length,
      met: d.requirements.filter((r) => r.classification === "met").length,
      partial: d.requirements.filter((r) => r.classification === "partial").length,
      notApplicable: d.requirements.filter((r) => r.classification === "not-applicable").length,
      notMet: d.requirements.filter((r) => r.classification === "not-met").length,
    }));
    json({ command: "apts-checklist", status: "ok", tier: foundation.tier, standard: foundation.standard, domains: summary });
  } catch (e) {
    json({ command: "apts-checklist", status: "error", message: e.message });
  }
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  const skillDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
  let version = "unknown";
  try {
    version = JSON.parse(fs.readFileSync(path.join(skillDir, "package.json"), "utf-8")).version || "unknown";
  } catch {}

  const usage = `vulniq ${version} — Autonomous security vulnerability scanner (OWASP APTS Foundation-tier aligned)

USAGE
  vulniq <command> [args]
  node <skill-dir>/scripts/cli.mjs <command> [args]

CORE
  config                             Print the resolved config (defaults merged with vulniq.config.json)
  save-report <title>                Save a Markdown report (stdin: markdown)
  save-sarif <title>                 Save a SARIF 2.1.0 report (stdin: JSON)
  last-run                           Show metadata of the most recent scan
  history                            List every past scan
  suppress <ruleId> [file:line]      Add a false-positive suppression
  ingest-audit <title>               Ingest an external audit document (stdin: JSON)
  list-audits                        List ingested external audits with remediation stats

APTS GOVERNANCE
  roe validate                       Validate vulniq.roe.json and emit scope.hash.recorded
  roe show                           Print the parsed RoE
  roe hash                           Print the SHA-256 of the RoE file
  audit-log <event>                  Append a hash-chained entry (stdin: JSON)
  audit-verify                       Walk the audit-log chain, report ok/broken
  halt [--release]                   Kill switch (writes .vulniq/HALT + state snapshot)
  halt-status                        Check whether the kill switch is active
  pause [--release]                  Pause scan with state preservation
  pause-status                       Check whether pause is active
  conformance                        Generate an APTS Conformance Claim into ./reports/
  scan-hook <phase>                  Enforce step-boundary governance (stdin: optional JSON body)
  scan-hook status                   Show last phase + next expected phase
  apts-checklist                     Per-domain APTS Foundation coverage summary

FILES
  vulniq.config.json                 Optional scanner config (project root)
  vulniq.roe.json                    Optional Rules of Engagement (project root)
  .vulniq/audit-log.ndjson           Hash-chained audit trail (never edit by hand)
  .vulniq/scan-history.json          Scan metadata
  .vulniq/suppressions.json          False-positive suppressions
  ./reports/                         Generated reports + Conformance Claims

DOCS
  https://github.com/JakubKontra/skills/tree/main/vulniq
  https://github.com/OWASP/APTS

All core commands output a single JSON object to stdout. --help prints this text.
`;
  process.stdout.write(usage);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  printHelp();
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  try {
    const skillDir = path.resolve(fileURLToPath(import.meta.url), "..", "..");
    const v = JSON.parse(fs.readFileSync(path.join(skillDir, "package.json"), "utf-8")).version || "unknown";
    process.stdout.write(v + "\n");
  } catch {
    process.stdout.write("unknown\n");
  }
  process.exit(0);
}

switch (cmd) {
  case "config":
    showConfig();
    break;
  case "save-report":
    saveReport(args.join(" "));
    break;
  case "save-sarif":
    saveSarif(args.join(" "));
    break;
  case "last-run":
    lastRun();
    break;
  case "history":
    showHistory();
    break;
  case "suppress":
    suppress(args[0], args[1]);
    break;
  case "ingest-audit":
    ingestAudit(args.join(" "));
    break;
  case "list-audits":
    listAudits();
    break;
  case "roe":
    roeCommand(args[0]);
    break;
  case "audit-log":
    auditLogCommand(args[0]);
    break;
  case "audit-verify":
    auditVerifyCommand();
    break;
  case "halt":
    haltCommand(args[0]);
    break;
  case "halt-status":
    haltStatus();
    break;
  case "pause":
    pauseCommand(args[0]);
    break;
  case "pause-status":
    pauseStatus();
    break;
  case "conformance":
    conformanceCommand();
    break;
  case "scan-hook":
    scanHookCommand(args[0]);
    break;
  case "apts-checklist":
    aptsChecklist();
    break;
  default:
    if (!cmd) {
      printHelp();
      process.exit(0);
    }
    json({
      command: cmd,
      status: "error",
      message: `Unknown command '${cmd}'. Known commands: config, save-report, save-sarif, last-run, history, suppress, ingest-audit, list-audits, roe, audit-log, audit-verify, halt, halt-status, pause, pause-status, conformance, scan-hook, apts-checklist. Run 'vulniq --help' for usage.`,
    });
    process.exit(1);
}
