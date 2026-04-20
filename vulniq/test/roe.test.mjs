// Tests for scripts/roe.mjs
//
// roe.mjs resolves paths relative to process.cwd() (via getProjectDir()).
// Each test creates a temp dir, writes a vulniq.config.json (so getProjectDir
// anchors there), optionally writes vulniq.roe.json, chdirs in, runs the
// check, then restores cwd and removes the temp dir.

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadRoE,
  validateRoE,
  validateScanWindow,
  isInScope,
  getAssetCriticality,
} from "../scripts/roe.mjs";

let tempDir;
let originalCwd;

before(() => {
  originalCwd = process.cwd();
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vulniq-test-"));
  fs.writeFileSync(path.join(tempDir, "vulniq.config.json"), "{}");
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

after(() => {
  process.chdir(originalCwd);
});

function writeRoE(obj) {
  fs.writeFileSync(path.join(tempDir, "vulniq.roe.json"), typeof obj === "string" ? obj : JSON.stringify(obj));
}

// ─── loadRoE ────────────────────────────────────────────────────────────────

test("loadRoE() with no file returns _found: false", () => {
  const roe = loadRoE();
  assert.equal(roe._found, false);
  assert.equal(typeof roe.path, "string");
});

test("loadRoE() with invalid JSON returns _found: false and an error field", () => {
  writeRoE("this is not json");
  const roe = loadRoE();
  assert.equal(roe._found, false);
  assert.match(roe.error, /^Invalid JSON:/);
});

test("loadRoE() with a valid file returns the parsed content + _found: true", () => {
  writeRoE({ projectRoot: ".", operator: { name: "x" }, custom: 42 });
  const roe = loadRoE();
  assert.equal(roe._found, true);
  assert.equal(roe.projectRoot, ".");
  assert.equal(roe.custom, 42);
  assert.equal(roe.operator.name, "x");
});

// ─── validateRoE ────────────────────────────────────────────────────────────

test("validateRoE() with no file returns warn", () => {
  const res = validateRoE();
  assert.equal(res.status, "warn");
  assert.ok(res.warnings.some((w) => /No vulniq\.roe\.json found/.test(w)));
});

test("validateRoE() with missing projectRoot returns error", () => {
  writeRoE({ operator: { name: "x" }, allowedPaths: ["src/**"] });
  const res = validateRoE();
  assert.equal(res.status, "error");
  assert.ok(res.errors.some((e) => /projectRoot/.test(e)));
});

test("validateRoE() with mismatched projectRoot returns error", () => {
  writeRoE({ projectRoot: "/definitely/not/cwd", operator: { name: "x" }, allowedPaths: ["src/**"] });
  const res = validateRoE();
  assert.equal(res.status, "error");
  assert.ok(res.errors.some((e) => /projectRoot/.test(e)));
});

test("validateRoE() with missing operator.name returns warn (recommended, not required)", () => {
  writeRoE({ projectRoot: ".", allowedPaths: ["src/**"] });
  const res = validateRoE();
  assert.equal(res.status, "warn");
  assert.ok(res.warnings.some((w) => /operator\.name/.test(w)));
  assert.equal(res.errors.length, 0);
});

test("validateRoE() with missing allowedPaths returns warn", () => {
  writeRoE({ projectRoot: ".", operator: { name: "x" } });
  const res = validateRoE();
  assert.equal(res.status, "warn");
  assert.ok(res.warnings.some((w) => /allowedPaths/.test(w)));
  assert.equal(res.errors.length, 0);
});

test("validateRoE() with scanWindow.start in the future returns error", () => {
  writeRoE({
    projectRoot: ".",
    operator: { name: "x" },
    allowedPaths: ["src/**"],
    scanWindow: { start: "2099-01-01T00:00:00Z" },
  });
  const res = validateRoE();
  assert.equal(res.status, "error");
  assert.ok(res.errors.some((e) => /before scanWindow\.start/.test(e)));
});

test("validateRoE() with scanWindow.end in the past returns error", () => {
  writeRoE({
    projectRoot: ".",
    operator: { name: "x" },
    allowedPaths: ["src/**"],
    scanWindow: { end: "2000-01-01T00:00:00Z" },
  });
  const res = validateRoE();
  assert.equal(res.status, "error");
  assert.ok(res.errors.some((e) => /after scanWindow\.end/.test(e)));
});

test("validateRoE() with a valid minimal RoE returns ok with empty errors/warnings", () => {
  writeRoE({
    projectRoot: ".",
    operator: { name: "x" },
    allowedPaths: ["src/**"],
    scanWindow: { start: "2000-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z" },
  });
  const res = validateRoE();
  assert.equal(res.status, "ok");
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
});

// ─── validateScanWindow ─────────────────────────────────────────────────────

test("validateScanWindow({}) is valid", () => {
  assert.deepEqual(validateScanWindow({}), { valid: true });
});

test("validateScanWindow with a malformed start is invalid", () => {
  const r = validateScanWindow({ start: "definitely-not-iso" });
  assert.equal(r.valid, false);
  assert.match(r.reason, /not a valid ISO/);
});

test("validateScanWindow with a future start is invalid", () => {
  const r = validateScanWindow({ start: "2099-01-01T00:00:00Z" });
  assert.equal(r.valid, false);
  assert.match(r.reason, /before scanWindow\.start/);
});

test("validateScanWindow with a past end is invalid", () => {
  const r = validateScanWindow({ end: "2000-01-01T00:00:00Z" });
  assert.equal(r.valid, false);
  assert.match(r.reason, /after scanWindow\.end/);
});

test("validateScanWindow with past start and future end is valid", () => {
  const r = validateScanWindow({
    start: "2000-01-01T00:00:00Z",
    end: "2099-01-01T00:00:00Z",
  });
  assert.deepEqual(r, { valid: true });
});

// ─── isInScope ──────────────────────────────────────────────────────────────

test("isInScope() with no RoE returns true", () => {
  assert.equal(isInScope("anywhere/file.js", null), true);
  assert.equal(isInScope("anywhere/file.js", { _found: false }), true);
});

test("isInScope() allowedPaths match → true", () => {
  const roe = { _found: true, allowedPaths: ["src/**"] };
  assert.equal(isInScope("src/app.js", roe), true);
});

test("isInScope() allowedPaths no match → false", () => {
  const roe = { _found: true, allowedPaths: ["src/**"] };
  assert.equal(isInScope("docs/readme.md", roe), false);
});

test("isInScope() forbiddenPaths override allowedPaths", () => {
  const roe = {
    _found: true,
    allowedPaths: ["src/**"],
    forbiddenPaths: ["src/secrets/**"],
  };
  assert.equal(isInScope("src/secrets/key.js", roe), false);
  assert.equal(isInScope("src/app.js", roe), true);
});

test("isInScope() ** glob matches any depth", () => {
  const roe = { _found: true, allowedPaths: ["src/**"] };
  assert.equal(isInScope("src/a.js", roe), true);
  assert.equal(isInScope("src/a/b/c/d.js", roe), true);
});

test("isInScope() single * matches a single segment only (not across /)", () => {
  const roe = { _found: true, allowedPaths: ["src/*"] };
  assert.equal(isInScope("src/a.js", roe), true);
  assert.equal(isInScope("src/a/b.js", roe), false);
});

// ─── getAssetCriticality ────────────────────────────────────────────────────

test("getAssetCriticality() returns null when no RoE or no assetCriticality", () => {
  assert.equal(getAssetCriticality("any.js", null), null);
  assert.equal(getAssetCriticality("any.js", { _found: false }), null);
  assert.equal(getAssetCriticality("any.js", { _found: true }), null);
});

test("getAssetCriticality() returns the matching tier", () => {
  const roe = {
    _found: true,
    assetCriticality: { "apps/billing/**": "high", "packages/ui/**": "low" },
  };
  assert.equal(getAssetCriticality("apps/billing/charge.js", roe), "high");
  assert.equal(getAssetCriticality("packages/ui/button.tsx", roe), "low");
});

test("getAssetCriticality() returns null on no match", () => {
  const roe = { _found: true, assetCriticality: { "apps/billing/**": "high" } };
  assert.equal(getAssetCriticality("apps/other/x.js", roe), null);
});
