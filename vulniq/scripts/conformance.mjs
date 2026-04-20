import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getReportsDir,
  getScanHistoryPath,
  loadConfig,
} from "./config.mjs";
import { loadRoE } from "./roe.mjs";
import { verifyChain, loadAll } from "./audit-log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");
const FOUNDATION_PATH = path.join(SKILL_DIR, "references", "apts-foundation.json");
const PACKAGE_PATH = path.join(SKILL_DIR, "package.json");

function readPlatformVersion() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf-8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

export function buildConformanceClaim() {
  const foundation = JSON.parse(fs.readFileSync(FOUNDATION_PATH, "utf-8"));
  const config = loadConfig();
  const roe = loadRoE();
  const chainResult = verifyChain();
  const history = loadScanHistory();
  const events = loadAll();

  const lastScan = history.length > 0 ? history[history.length - 1] : null;

  const tallies = { met: 0, partial: 0, "not-applicable": 0, "not-met": 0 };
  for (const domain of foundation.domains) {
    for (const req of domain.requirements) {
      tallies[req.classification] = (tallies[req.classification] || 0) + 1;
    }
  }

  return {
    standard: foundation.standard,
    standardVersion: foundation.standardVersion,
    tier: foundation.tier,
    generated: new Date().toISOString(),
    platform: {
      name: "Vulniq",
      version: readPlatformVersion(),
      autonomyLevel: config.autonomyLevel || "L3",
    },
    foundationModel: {
      provider: "Anthropic",
      product: "Claude Code",
      model: "runtime-session",
    },
    operator: roe._found ? roe.operator || null : null,
    scope: roe._found
      ? {
          projectRoot: roe.projectRoot,
          allowedPaths: roe.allowedPaths || [],
          forbiddenPaths: roe.forbiddenPaths || [],
          scanWindow: roe.scanWindow || null,
        }
      : null,
    posture: {
      readOnly: true,
      ciaImpact: { confidentiality: "LOW", integrity: "LOW", availability: "LOW" },
      actionAllowlist: [
        "Grep",
        "Read",
        "Glob",
        "Bash(npm audit)",
        "Bash(git ls-files)",
        "Bash(git log)",
        "Bash(git status)",
        "Bash(node <skill>/scripts/cli.mjs)",
      ],
    },
    lastScan,
    auditChain: chainResult,
    auditEventCount: events.length,
    tallies,
    domains: foundation.domains,
  };
}

export function renderConformanceMarkdown(claim) {
  const lines = [];
  lines.push(`# APTS Conformance Claim — ${claim.platform.name} v${claim.platform.version}`);
  lines.push("");
  lines.push(`**Standard:** ${claim.standard} ${claim.standardVersion} — Tier: **${claim.tier}**`);
  lines.push(`**Generated:** ${claim.generated}`);
  lines.push(`**Autonomy level:** ${claim.platform.autonomyLevel}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("## 1. Platform identification");
  lines.push(`- Name: ${claim.platform.name}`);
  lines.push(`- Version: ${claim.platform.version}`);
  lines.push(`- Autonomy Level: ${claim.platform.autonomyLevel}`);
  lines.push("");

  lines.push("## 2. Foundation Model disclosure");
  lines.push(`- Provider: ${claim.foundationModel.provider}`);
  lines.push(`- Product: ${claim.foundationModel.product}`);
  lines.push(`- Model: ${claim.foundationModel.model}`);
  lines.push("");

  lines.push("## 3. Operator and scope");
  if (claim.operator) {
    lines.push(`- Operator: ${claim.operator.name || "(unspecified)"}${claim.operator.email ? ` <${claim.operator.email}>` : ""}`);
    if (claim.operator.role) lines.push(`- Role: ${claim.operator.role}`);
  } else {
    lines.push("- Operator: (not declared — RoE missing)");
  }
  if (claim.scope) {
    lines.push(`- Project root: \`${claim.scope.projectRoot}\``);
    lines.push(`- Allowed paths: ${claim.scope.allowedPaths.length > 0 ? claim.scope.allowedPaths.map((p) => `\`${p}\``).join(", ") : "(implicit — all)"}`);
    if (claim.scope.forbiddenPaths.length > 0) {
      lines.push(`- Forbidden paths: ${claim.scope.forbiddenPaths.map((p) => `\`${p}\``).join(", ")}`);
    }
    if (claim.scope.scanWindow) {
      lines.push(`- Scan window: ${claim.scope.scanWindow.start || "(open)"} → ${claim.scope.scanWindow.end || "(open)"}`);
    }
  }
  lines.push("");

  lines.push("## 4. Posture");
  lines.push(`- Read-only: ${claim.posture.readOnly ? "yes" : "no"}`);
  lines.push(`- CIA impact: C=${claim.posture.ciaImpact.confidentiality}, I=${claim.posture.ciaImpact.integrity}, A=${claim.posture.ciaImpact.availability}`);
  lines.push(`- Action allowlist: ${claim.posture.actionAllowlist.map((a) => `\`${a}\``).join(", ")}`);
  lines.push("");

  lines.push("## 5. Audit trail integrity");
  lines.push(`- Entries: ${claim.auditEventCount}`);
  lines.push(`- Chain status: **${claim.auditChain.status}**`);
  if (claim.auditChain.status === "broken") {
    lines.push(`- First bad index: ${claim.auditChain.firstBadIndex}`);
    lines.push(`- Reason: ${claim.auditChain.reason}`);
  }
  lines.push("");

  lines.push("## 6. Last scan");
  if (claim.lastScan) {
    lines.push(`- Date: ${claim.lastScan.date}`);
    lines.push(`- Title: ${claim.lastScan.title}`);
    lines.push(`- Grade: ${claim.lastScan.grade || "n/a"} (${claim.lastScan.score ?? "n/a"}/100)`);
    const fc = claim.lastScan.findingCounts || {};
    lines.push(`- Findings: ${fc.critical || 0} critical · ${fc.high || 0} high · ${fc.medium || 0} medium · ${fc.low || 0} low`);
  } else {
    lines.push("- No scans recorded yet.");
  }
  lines.push("");

  lines.push("## 7. Requirement coverage (Foundation tier)");
  lines.push("");
  lines.push(`| Status | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Met | ${claim.tallies.met || 0} |`);
  lines.push(`| Partial | ${claim.tallies.partial || 0} |`);
  lines.push(`| Not applicable | ${claim.tallies["not-applicable"] || 0} |`);
  lines.push(`| Not met | ${claim.tallies["not-met"] || 0} |`);
  lines.push("");

  for (const domain of claim.domains) {
    lines.push(`### ${domain.id} — ${domain.name}`);
    lines.push("");
    lines.push(`${domain.summary}`);
    lines.push("");
    lines.push(`| Requirement | Title | Status | Evidence |`);
    lines.push(`|---|---|---|---|`);
    for (const req of domain.requirements) {
      lines.push(`| ${req.id} | ${req.title} | ${req.classification} | ${req.evidence || "—"} |`);
    }
    lines.push("");
  }

  lines.push("## 8. Attribution");
  lines.push("This claim is a self-assessment aligned to OWASP APTS (CC BY-SA 4.0). Review requirements at https://github.com/OWASP/APTS.");

  return lines.join("\n") + "\n";
}

function loadScanHistory() {
  const p = getScanHistoryPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

export function writeConformance() {
  const claim = buildConformanceClaim();
  const md = renderConformanceMarkdown(claim);
  const reportsDir = getReportsDir();
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${ts}-conformance.md`;
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, md, "utf-8");
  return { path: filepath, filename, claim };
}
