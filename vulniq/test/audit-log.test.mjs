// Tests for scripts/audit-log.mjs
//
// audit-log.mjs uses process.cwd()-relative resolution (walks up looking for
// vulniq.config.json). Each test creates a temp dir, writes a config file,
// chdirs in, exercises the API, and restores the original cwd + removes the
// temp dir. Tests never share state on disk.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  sha256,
  appendEntry,
  verifyChain,
  loadAll,
  EVENTS,
  CLASSIFICATIONS,
  hashSnippet,
} from "../scripts/audit-log.mjs";
import { getAuditLogPath } from "../scripts/config.mjs";

let tempDir;
let originalCwd;

before(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vulniq-test-"));
  fs.writeFileSync(path.join(tempDir, "vulniq.config.json"), "{}");
  process.chdir(tempDir);
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function resetLog() {
  const p = getAuditLogPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

test("sha256() is stable and returns sha256:<64-hex>", () => {
  const a = sha256("hello");
  const b = sha256("hello");
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(sha256("hello"), sha256("world"));
});

test("hashSnippet() hashes strings and treats null/undefined as empty", () => {
  assert.match(hashSnippet("x"), /^sha256:[0-9a-f]{64}$/);
  assert.equal(hashSnippet(null), hashSnippet(""));
  assert.equal(hashSnippet(undefined), hashSnippet(""));
});

test("EVENTS and CLASSIFICATIONS are exported arrays", () => {
  assert.ok(Array.isArray(EVENTS) && EVENTS.length > 0);
  assert.ok(Array.isArray(CLASSIFICATIONS) && CLASSIFICATIONS.length > 0);
  assert.ok(CLASSIFICATIONS.includes("PUBLIC"));
  assert.ok(EVENTS.includes("scan.started"));
});

test("verifyChain() on an empty log returns status ok with 0 entries", () => {
  resetLog();
  const res = verifyChain();
  assert.equal(res.status, "ok");
  assert.equal(res.entries, 0);
});

test("first appendEntry creates a valid genesis entry (prevHash = sha256:GENESIS)", () => {
  resetLog();
  const entry = appendEntry({
    event: "scan.started",
    classification: "PUBLIC",
    reasoning: "genesis",
  });
  assert.equal(entry.index, 0);
  assert.equal(entry.prevHash, "sha256:GENESIS");
  assert.match(entry.thisHash, /^sha256:[0-9a-f]{64}$/);
  const res = verifyChain();
  assert.equal(res.status, "ok");
  assert.equal(res.entries, 1);
});

test("multiple appends form a valid chain with monotonic indices", () => {
  resetLog();
  const e0 = appendEntry({ event: "scan.started", classification: "PUBLIC", reasoning: "a" });
  const e1 = appendEntry({ event: "step.entered", classification: "PUBLIC", reasoning: "b" });
  const e2 = appendEntry({ event: "step.exited", classification: "PUBLIC", reasoning: "c" });

  assert.equal(e0.index, 0);
  assert.equal(e1.index, 1);
  assert.equal(e2.index, 2);

  assert.equal(e1.prevHash, e0.thisHash);
  assert.equal(e2.prevHash, e1.thisHash);

  const res = verifyChain();
  assert.equal(res.status, "ok");
  assert.equal(res.entries, 3);
});

test("appendEntry rejects unknown event names", () => {
  resetLog();
  assert.throws(
    () => appendEntry({ event: "not.a.real.event", classification: "PUBLIC" }),
    /Unknown event/
  );
});

test("appendEntry rejects unknown classification", () => {
  resetLog();
  assert.throws(
    () => appendEntry({ event: "scan.started", classification: "TOTALLY_MADE_UP" }),
    /Unknown classification/
  );
});

test("tampering with a non-hash field in a middle entry is detected", () => {
  resetLog();
  appendEntry({ event: "scan.started", classification: "PUBLIC", reasoning: "one" });
  appendEntry({ event: "step.entered", classification: "PUBLIC", reasoning: "two" });
  appendEntry({ event: "step.exited", classification: "PUBLIC", reasoning: "three" });

  const p = getAuditLogPath();
  const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
  const mid = JSON.parse(lines[1]);
  mid.reasoning = "tampered"; // thisHash/prevHash untouched
  lines[1] = JSON.stringify(mid);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

  const res = verifyChain();
  assert.equal(res.status, "broken");
  assert.equal(res.firstBadIndex, 1);
});

test("tampering with prevHash in a middle entry is detected", () => {
  resetLog();
  appendEntry({ event: "scan.started", classification: "PUBLIC", reasoning: "one" });
  appendEntry({ event: "step.entered", classification: "PUBLIC", reasoning: "two" });
  appendEntry({ event: "step.exited", classification: "PUBLIC", reasoning: "three" });

  const p = getAuditLogPath();
  const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
  const mid = JSON.parse(lines[1]);
  mid.prevHash = "sha256:" + "0".repeat(64);
  lines[1] = JSON.stringify(mid);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

  const res = verifyChain();
  assert.equal(res.status, "broken");
  assert.equal(res.firstBadIndex, 1);
});

test("a deleted entry (creating an index gap) is detected", () => {
  resetLog();
  appendEntry({ event: "scan.started", classification: "PUBLIC", reasoning: "one" });
  appendEntry({ event: "step.entered", classification: "PUBLIC", reasoning: "two" });
  appendEntry({ event: "step.exited", classification: "PUBLIC", reasoning: "three" });
  appendEntry({ event: "scan.completed", classification: "PUBLIC", reasoning: "four" });

  const p = getAuditLogPath();
  const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
  // Remove index 2; keep indices as-is on remaining rows so they read 0,1,3
  const kept = [lines[0], lines[1], lines[3]];
  fs.writeFileSync(p, kept.join("\n") + "\n", "utf-8");

  const res = verifyChain();
  assert.equal(res.status, "broken");
  // The surviving row previously at index 3 now sits at position 2,
  // so the first bad index reported is 2 (index mismatch).
  assert.equal(res.firstBadIndex, 2);
});

test("loadAll() returns the written entries in order", () => {
  resetLog();
  appendEntry({ event: "scan.started", classification: "PUBLIC", reasoning: "one" });
  appendEntry({ event: "scan.completed", classification: "PUBLIC", reasoning: "two" });
  const all = loadAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].event, "scan.started");
  assert.equal(all[1].event, "scan.completed");
});
