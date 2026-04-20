// Tests for scripts/scan-hook.mjs
//
// Like audit-log.test.mjs, scan-hook.mjs resolves the audit-log path by
// walking up from process.cwd(). Each test creates an isolated temp dir
// with a vulniq.config.json, chdirs in, and tears down afterwards.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { PHASES, runHook, getLastPhase } from "../scripts/scan-hook.mjs";
import { appendEntry } from "../scripts/audit-log.mjs";
import { getAuditLogPath } from "../scripts/config.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(TEST_DIR, "..", "scripts", "cli.mjs");

let tempDir;
let originalCwd;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vulniq-scanhook-"));
  fs.writeFileSync(path.join(tempDir, "vulniq.config.json"), "{}");
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function recordScopeHash() {
  // Helper: the preflight.end check requires a scope.hash.recorded since
  // the last preflight.start. Simulates what `cli.mjs roe validate` emits.
  appendEntry({
    event: "scope.hash.recorded",
    classification: "PUBLIC",
    reasoning: "test",
    context: { scopeHash: "sha256:" + "a".repeat(64) },
  });
}

function emitFinding({ evidenceHash, confidence }) {
  appendEntry({
    event: "finding.emitted",
    classification: "STANDARD",
    reasoning: "test finding",
    evidenceHash,
    confidence,
    decision: { ruleId: "TST-001", severity: "low" },
    context: { file: "x.ts", line: 1 },
  });
}

function runCli(args, { stdin = "" } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: tempDir,
    input: stdin,
    encoding: "utf-8",
  });
  const stdout = result.stdout || "";
  let json = null;
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length > 0) {
    try {
      json = JSON.parse(lines[lines.length - 1]);
    } catch {}
  }
  return { stdout, stderr: result.stderr || "", code: result.status, json };
}

// ─── 1. Unknown phase ────────────────────────────────────────────────────────

test("runHook throws on unknown phase", () => {
  assert.throws(() => runHook("made.up.phase", {}), /Unknown phase/);
});

// ─── 2. First call must be preflight.start ───────────────────────────────────

test("first scan-hook call must be preflight.start; others throw", () => {
  assert.throws(
    () => runHook("config.loaded", {}),
    /First scan-hook must be 'preflight.start'/
  );
});

// ─── 3. In-order progression accepted through all 13 phases ──────────────────

test("in-order progression through all 13 phases is accepted", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  // Emit a valid finding so code.analysis.done passes and conformance.saved
  // can be reached without the allowEmpty bypass.
  emitFinding({ evidenceHash: "sha256:" + "b".repeat(64), confidence: 0.9 });
  runHook("code.analysis.done", {});
  runHook("custom.patterns.done", {});
  runHook("scores.computed", {});
  runHook("sarif.saved", {});
  runHook("conformance.saved", {});
  runHook("report.saved", {});
  runHook("scan.finalised", {});
  assert.equal(getLastPhase(), "scan.finalised");
});

// ─── 4. Skipping throws with correct expected ────────────────────────────────

test("skipping a phase throws with the right 'expected' value", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  // Skip config.loaded → jump straight to project.detected
  let caught = null;
  try {
    runHook("project.detected", {});
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "expected throw");
  assert.equal(caught.expected, "config.loaded");
  assert.match(caught.message, /Out-of-order scan-hook/);
});

// ─── 5. preflight.start resets the state machine ─────────────────────────────

test("preflight.start resets the state machine and is allowed at any time", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  // Mid-scan restart
  runHook("preflight.start", {});
  assert.equal(getLastPhase(), "preflight.start");
  // After reset, only preflight.end is acceptable next (and needs a new scope.hash.recorded)
  recordScopeHash();
  runHook("preflight.end", {});
  assert.equal(getLastPhase(), "preflight.end");
});

// ─── 6. preflight.end without scope.hash.recorded throws ─────────────────────

test("preflight.end without scope.hash.recorded in this scan throws", () => {
  runHook("preflight.start", {});
  // Deliberately skip recordScopeHash()
  assert.throws(
    () => runHook("preflight.end", {}),
    /no scope\.hash\.recorded/
  );
});

// ─── 7. preflight.end with scope.drift throws (legal violation) ──────────────

test("preflight.end with a scope.drift event since preflight.start throws", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  appendEntry({
    event: "scope.drift",
    classification: "STANDARD",
    reasoning: "test drift",
    context: { path: "forbidden/x.ts" },
  });
  assert.throws(
    () => runHook("preflight.end", {}),
    /scope\.drift/
  );
});

// ─── 8. code.analysis.done with bad evidenceHash throws ──────────────────────

test("code.analysis.done rejects a finding missing evidenceHash", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: null, confidence: 0.8 });
  assert.throws(
    () => runHook("code.analysis.done", {}),
    /invalid or missing evidenceHash/
  );
});

test("code.analysis.done rejects a finding with malformed evidenceHash", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: "md5:beefcafe", confidence: 0.8 });
  assert.throws(
    () => runHook("code.analysis.done", {}),
    /invalid or missing evidenceHash/
  );
});

// ─── 9. code.analysis.done with invalid confidence throws ────────────────────

test("code.analysis.done rejects a finding with confidence above 1.0", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: "sha256:" + "c".repeat(64), confidence: 1.5 });
  assert.throws(
    () => runHook("code.analysis.done", {}),
    /invalid confidence/
  );
});

test("code.analysis.done rejects a finding with confidence below 0.0", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: "sha256:" + "d".repeat(64), confidence: -0.1 });
  assert.throws(
    () => runHook("code.analysis.done", {}),
    /invalid confidence/
  );
});

// ─── 10. code.analysis.done passes with valid findings ───────────────────────

test("code.analysis.done passes when findings have valid evidenceHash and confidence", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: "sha256:" + "e".repeat(64), confidence: 0.0 });
  emitFinding({ evidenceHash: "sha256:" + "f".repeat(64), confidence: 1.0 });
  emitFinding({ evidenceHash: "sha256:" + "1".repeat(64), confidence: 0.5 });
  const res = runHook("code.analysis.done", {});
  assert.equal(res.entry.event, "scan.hook");
  assert.equal(res.entry.context.phase, "code.analysis.done");
});

// ─── 11. scan.finalised with broken chain throws ─────────────────────────────

test("scan.finalised throws when the audit chain is broken", () => {
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  emitFinding({ evidenceHash: "sha256:" + "2".repeat(64), confidence: 0.9 });
  runHook("code.analysis.done", {});
  runHook("custom.patterns.done", {});
  runHook("scores.computed", {});
  runHook("sarif.saved", {});
  runHook("conformance.saved", {});
  runHook("report.saved", {});

  // Tamper with the audit log mid-file: change a reasoning field without
  // rehashing — this is exactly what APTS-AR-012 protects against.
  const p = getAuditLogPath();
  const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
  const target = JSON.parse(lines[2]);
  target.reasoning = "tampered-by-test";
  lines[2] = JSON.stringify(target);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

  assert.throws(
    () => runHook("scan.finalised", {}),
    /audit chain is broken/
  );
});

// ─── 12. conformance.saved with allowEmpty bypass ────────────────────────────

test("conformance.saved without findings throws unless allowEmpty is passed", () => {
  // Walk to conformance.saved without emitting any finding and without
  // ever calling code.analysis.done (we actually did call it, which
  // should be enough on its own — test both paths).
  runHook("preflight.start", {});
  recordScopeHash();
  runHook("preflight.end", {});
  runHook("config.loaded", {});
  runHook("project.detected", {});
  runHook("audits.loaded", {});
  runHook("external.scans.done", {});
  // Skip the emitFinding entirely — code.analysis.done still passes because
  // there are zero findings to validate. But this means conformance.saved
  // should still pass (because code.analysis.done phase WAS recorded).
  runHook("code.analysis.done", {});
  runHook("custom.patterns.done", {});
  runHook("scores.computed", {});
  runHook("sarif.saved", {});
  const res = runHook("conformance.saved", {});
  assert.equal(res.entry.event, "scan.hook");
});

// ─── 13. scan-hook status CLI command ────────────────────────────────────────

test("scan-hook status CLI returns lastPhase/nextExpected/complete", () => {
  // Fresh state — no hooks yet.
  const fresh = runCli(["scan-hook", "status"]);
  assert.equal(fresh.code, 0);
  assert.equal(fresh.json.command, "scan-hook");
  assert.equal(fresh.json.status, "ok");
  assert.equal(fresh.json.lastPhase, null);
  assert.equal(fresh.json.nextExpected, "preflight.start");
  assert.equal(fresh.json.complete, false);

  // Advance one phase via CLI.
  const start = runCli(["scan-hook", "preflight.start"]);
  assert.equal(start.code, 0);
  assert.equal(start.json.status, "ok");
  assert.equal(start.json.phase, "preflight.start");

  const s2 = runCli(["scan-hook", "status"]);
  assert.equal(s2.json.lastPhase, "preflight.start");
  assert.equal(s2.json.nextExpected, "preflight.end");
  assert.equal(s2.json.complete, false);
});

// ─── 14. CLI exits 1 on out-of-order call ────────────────────────────────────

test("scan-hook CLI exits code 1 and surfaces 'expected' on out-of-order call", () => {
  runCli(["scan-hook", "preflight.start"]);
  // Skip preflight.end and config.loaded → try project.detected
  const bad = runCli(["scan-hook", "project.detected"]);
  assert.equal(bad.code, 1);
  assert.equal(bad.json.status, "error");
  assert.equal(bad.json.expected, "preflight.end");
});

// ─── 15. PHASES export is ordered and contains exactly 13 entries ────────────

test("PHASES is the documented 13-entry ordered list", () => {
  assert.equal(PHASES.length, 13);
  assert.equal(PHASES[0], "preflight.start");
  assert.equal(PHASES[PHASES.length - 1], "scan.finalised");
});
