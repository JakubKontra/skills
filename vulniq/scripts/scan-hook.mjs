// Scan-hook enforcement layer.
//
// Moves APTS-governance step-boundary checks from agent-dependent
// (SKILL.md instructions that Claude might forget) to code-enforced.
// The CLI refuses to progress unless the agent calls runHook(phase)
// at every step boundary in the correct order.
//
// Phase state is derived from the audit log itself — there is no
// separate state file. Starting a new `preflight.start` resets the
// state machine, so a crashed scan can cleanly start over without
// manual cleanup.

import { appendEntry, verifyChain, loadAll } from "./audit-log.mjs";

export const PHASES = [
  "preflight.start",
  "preflight.end",
  "config.loaded",
  "project.detected",
  "audits.loaded",
  "external.scans.done",
  "code.analysis.done",
  "custom.patterns.done",
  "scores.computed",
  "sarif.saved",
  "conformance.saved",
  "report.saved",
  "scan.finalised",
];

const EVIDENCE_HASH_RE = /^sha256:[a-f0-9]{64}$/;

function findLastScanHook(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].event === "scan.hook") return { entry: entries[i], index: i };
  }
  return null;
}

function findLastPreflightStart(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.event === "scan.hook" && e.context && e.context.phase === "preflight.start") {
      return i;
    }
  }
  return -1;
}

function entriesSinceLastPreflightStart(entries) {
  const idx = findLastPreflightStart(entries);
  if (idx < 0) return entries.slice();
  return entries.slice(idx + 1);
}

export function getLastPhase() {
  const all = loadAll();
  const last = findLastScanHook(all);
  if (!last) return null;
  return last.entry.context?.phase || null;
}

function nextExpectedFrom(lastPhase) {
  if (lastPhase === null) return "preflight.start";
  const i = PHASES.indexOf(lastPhase);
  if (i < 0 || i === PHASES.length - 1) return null;
  return PHASES[i + 1];
}

export function getStatus() {
  const lastPhase = getLastPhase();
  const nextExpected = nextExpectedFrom(lastPhase);
  const complete = lastPhase === PHASES[PHASES.length - 1];
  return { lastPhase, nextExpected, complete };
}

function validatePreflightEnd(scanEntries) {
  let hasScopeHash = false;
  for (const e of scanEntries) {
    if (e.event === "scope.drift") {
      throw new Error(
        "preflight.end refused: scope.drift event recorded during preflight (APTS-HO-014 legal violation). " +
          "Resolve scope conflict in vulniq.roe.json before restarting the scan."
      );
    }
    if (e.event === "scope.hash.recorded") hasScopeHash = true;
  }
  if (!hasScopeHash) {
    throw new Error(
      "preflight.end refused: no scope.hash.recorded event since preflight.start " +
        "(APTS-SE-001, SE-006, MR-012). Run `roe validate` before closing preflight."
    );
  }
}

function validateCodeAnalysisDone(scanEntries) {
  const findings = scanEntries.filter((e) => e.event === "finding.emitted");
  for (const f of findings) {
    const hash = f.evidenceHash;
    if (!hash || typeof hash !== "string" || !EVIDENCE_HASH_RE.test(hash)) {
      throw new Error(
        `code.analysis.done refused: finding at index ${f.index} has invalid or missing evidenceHash ` +
          `(APTS-AR-010). Got: ${JSON.stringify(hash)}. Required: sha256:<64-hex>.`
      );
    }
    const conf = f.confidence;
    if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) {
      throw new Error(
        `code.analysis.done refused: finding at index ${f.index} has invalid confidence ` +
          `(APTS-AR-004). Got: ${JSON.stringify(conf)}. Required: number in [0.0, 1.0].`
      );
    }
  }
}

function validateConformanceSaved(scanEntries, body) {
  const hasFinding = scanEntries.some((e) => e.event === "finding.emitted");
  const hasCodeAnalysisPhase = scanEntries.some(
    (e) => e.event === "scan.hook" && e.context && e.context.phase === "code.analysis.done"
  );
  if (!hasFinding && !hasCodeAnalysisPhase) {
    if (body && body.allowEmpty === true) {
      return { warning: "conformance.saved: no findings and no code.analysis.done phase recorded; allowEmpty=true bypass." };
    }
    throw new Error(
      "conformance.saved refused: no finding.emitted and no code.analysis.done phase recorded in this scan " +
        "(prevents claiming conformance for a no-op scan). Pass {\"allowEmpty\": true} on stdin to bypass."
    );
  }
  return null;
}

function validateScanFinalised() {
  const chain = verifyChain();
  if (chain.status !== "ok") {
    throw new Error(
      `scan.finalised refused: audit chain is broken (${chain.reason || "unknown"} at index ${chain.firstBadIndex ?? "?"}). ` +
        "APTS-AR-012 requires tamper-evident chain integrity before closing a scan."
    );
  }
}

export function runHook(phase, body) {
  if (!PHASES.includes(phase)) {
    throw new Error(
      `Unknown phase '${phase}'. Allowed: ${PHASES.join(", ")}`
    );
  }

  const all = loadAll();
  const last = findLastScanHook(all);

  // Ordering check: preflight.start always allowed (resets state machine).
  if (phase === "preflight.start") {
    // pass through — valid at any time (starts a new scan)
  } else if (!last) {
    throw new Error(
      `First scan-hook must be 'preflight.start'; got '${phase}'.`
    );
  } else {
    const lastPhase = last.entry.context?.phase;
    const expected = nextExpectedFrom(lastPhase);
    if (expected === null) {
      throw new Error(
        `Scan already finalised at phase '${lastPhase}'. Call 'preflight.start' to begin a new scan.`
      );
    }
    if (phase !== expected) {
      const err = new Error(
        `Out-of-order scan-hook: last phase was '${lastPhase}', next expected is '${expected}', got '${phase}'.`
      );
      err.expected = expected;
      err.lastPhase = lastPhase;
      throw err;
    }
  }

  const body0 = body && typeof body === "object" ? body : {};
  const scanEntries = phase === "preflight.start" ? [] : entriesSinceLastPreflightStart(all);

  let warning = null;
  switch (phase) {
    case "preflight.end":
      validatePreflightEnd(scanEntries);
      break;
    case "code.analysis.done":
      validateCodeAnalysisDone(scanEntries);
      break;
    case "conformance.saved": {
      const r = validateConformanceSaved(scanEntries, body0);
      if (r && r.warning) warning = r.warning;
      break;
    }
    case "scan.finalised":
      validateScanFinalised();
      break;
    default:
      break;
  }

  const context = { phase, ...body0 };
  const entry = appendEntry({
    event: "scan.hook",
    classification: "PUBLIC",
    reasoning: `Scan-hook enforcement for ${phase}`,
    context,
  });

  return warning ? { entry, warning } : { entry };
}
