// Integration tests for scripts/cli.mjs
//
// Each test spawns the CLI in a fresh temp dir (with a vulniq.config.json so
// getProjectDir anchors there), feeding stdin where needed, and parses the
// JSON written to stdout. No test relies on, or leaves behind, any state
// outside its own temp dir.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(TEST_DIR, "..", "scripts", "cli.mjs");

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vulniq-test-"));
  fs.writeFileSync(path.join(tempDir, "vulniq.config.json"), "{}");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function run(args, { cwd = tempDir, stdin = null } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input: stdin === null ? "" : stdin,
    encoding: "utf-8",
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  // CLI commands output JSON; last non-empty line is the result object.
  let json = null;
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length > 0) {
    try {
      json = JSON.parse(lines[lines.length - 1]);
    } catch {
      json = null;
    }
  }
  return { stdout, stderr, code: result.status, json };
}

// ─── apts-checklist ─────────────────────────────────────────────────────────

test("apts-checklist returns ok with 8 domains", () => {
  const r = run(["apts-checklist"]);
  assert.equal(r.code, 0);
  assert.ok(r.json, "expected JSON on stdout");
  assert.equal(r.json.status, "ok");
  assert.equal(r.json.command, "apts-checklist");
  assert.ok(Array.isArray(r.json.domains));
  assert.equal(r.json.domains.length, 8);
});

// ─── roe validate ───────────────────────────────────────────────────────────

test("roe validate with no RoE returns warn and null scopeHash", () => {
  const r = run(["roe", "validate"]);
  assert.equal(r.code, 0);
  assert.equal(r.json.command, "roe");
  assert.equal(r.json.status, "warn");
  assert.equal(r.json.scopeHash, null);
});

test("roe validate with a valid RoE returns ok and sha256 scopeHash", () => {
  fs.writeFileSync(
    path.join(tempDir, "vulniq.roe.json"),
    JSON.stringify({
      projectRoot: ".",
      operator: { name: "Tester" },
      allowedPaths: ["src/**"],
      scanWindow: { start: "2000-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z" },
    })
  );
  const r = run(["roe", "validate"]);
  assert.equal(r.code, 0);
  assert.equal(r.json.status, "ok");
  assert.ok(typeof r.json.scopeHash === "string");
  assert.match(r.json.scopeHash, /^sha256:[0-9a-f]{64}$/);
});

// ─── audit-log ──────────────────────────────────────────────────────────────

test("audit-log scan.started appends entry 0 with a valid hash", () => {
  const r = run(["audit-log", "scan.started"], {
    stdin: JSON.stringify({ classification: "PUBLIC", reasoning: "test" }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.json.status, "ok");
  assert.ok(r.json.entry);
  assert.equal(r.json.entry.index, 0);
  assert.equal(r.json.entry.event, "scan.started");
  assert.match(r.json.entry.thisHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(r.json.entry.prevHash, "sha256:GENESIS");
});

test("audit-log with unknown event returns status error", () => {
  const r = run(["audit-log", "no.such.event"], {
    stdin: JSON.stringify({ classification: "PUBLIC" }),
  });
  assert.equal(r.json.status, "error");
  assert.match(r.json.message, /Unknown event/);
});

test("audit-verify after two appends returns ok with entries: 2", () => {
  run(["audit-log", "scan.started"], {
    stdin: JSON.stringify({ classification: "PUBLIC", reasoning: "one" }),
  });
  run(["audit-log", "scan.completed"], {
    stdin: JSON.stringify({ classification: "PUBLIC", reasoning: "two" }),
  });
  const r = run(["audit-verify"]);
  assert.equal(r.json.status, "ok");
  assert.equal(r.json.entries, 2);
});

// ─── halt / halt-status ─────────────────────────────────────────────────────

test("halt writes HALT flag and dumps a snapshot; halt-status reflects it; --release clears it", () => {
  const haltRes = run(["halt"]);
  assert.equal(haltRes.json.status, "ok");
  assert.equal(haltRes.json.halted, true);
  assert.ok(fs.existsSync(path.join(tempDir, ".vulniq", "HALT")));
  assert.ok(haltRes.json.snapshot);
  assert.ok(typeof haltRes.json.snapshot.path === "string");
  assert.ok(fs.existsSync(haltRes.json.snapshot.path), "snapshot file should exist");

  const statusRes = run(["halt-status"]);
  assert.equal(statusRes.json.active, true);

  const releaseRes = run(["halt", "--release"]);
  assert.equal(releaseRes.json.released, true);
  assert.equal(fs.existsSync(path.join(tempDir, ".vulniq", "HALT")), false);

  const after = run(["halt-status"]);
  assert.equal(after.json.active, false);
});

// ─── pause / pause-status ───────────────────────────────────────────────────

test("pause creates PAUSE file + snapshot; --release clears it", () => {
  const pauseRes = run(["pause"]);
  assert.equal(pauseRes.json.status, "ok");
  assert.equal(pauseRes.json.paused, true);
  assert.ok(fs.existsSync(path.join(tempDir, ".vulniq", "PAUSE")));
  assert.ok(pauseRes.json.snapshot);
  assert.ok(fs.existsSync(pauseRes.json.snapshot.path));

  const statusRes = run(["pause-status"]);
  assert.equal(statusRes.json.active, true);

  const releaseRes = run(["pause", "--release"]);
  assert.equal(releaseRes.json.released, true);
  assert.equal(fs.existsSync(path.join(tempDir, ".vulniq", "PAUSE")), false);
});

// ─── conformance ────────────────────────────────────────────────────────────

test("conformance returns ok with a path and tallies object", () => {
  const r = run(["conformance"]);
  assert.equal(r.json.status, "ok");
  assert.equal(typeof r.json.path, "string");
  assert.ok(fs.existsSync(r.json.path), "conformance file should exist on disk");
  assert.equal(typeof r.json.tallies, "object");
  assert.ok(
    Number.isInteger(r.json.tallies.met) && r.json.tallies.met > 0,
    "tallies.met should be a positive integer"
  );
});
