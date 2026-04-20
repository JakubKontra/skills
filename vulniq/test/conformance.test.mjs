// Tests for scripts/conformance.mjs
//
// buildConformanceClaim() reads references/apts-foundation.json (inside the
// skill package) and also looks at the working project's config, RoE, and
// audit log. Each test runs from a fresh temp dir so nothing from the host
// project leaks in.

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildConformanceClaim,
  renderConformanceMarkdown,
  writeConformance,
} from "../scripts/conformance.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FOUNDATION_PATH = path.resolve(TEST_DIR, "..", "references", "apts-foundation.json");

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

function expectedTalliesFromFoundation() {
  const foundation = JSON.parse(fs.readFileSync(FOUNDATION_PATH, "utf-8"));
  const tallies = { met: 0, partial: 0, "not-applicable": 0, "not-met": 0 };
  for (const d of foundation.domains) {
    for (const r of d.requirements) {
      tallies[r.classification] = (tallies[r.classification] || 0) + 1;
    }
  }
  return { tallies, domainCount: foundation.domains.length, domains: foundation.domains };
}

test("buildConformanceClaim() returns 8 domains", () => {
  const claim = buildConformanceClaim();
  const { domainCount } = expectedTalliesFromFoundation();
  assert.equal(claim.domains.length, 8);
  assert.equal(claim.domains.length, domainCount);
});

test("each domain has id, name, summary, and a requirements array", () => {
  const claim = buildConformanceClaim();
  for (const d of claim.domains) {
    assert.equal(typeof d.id, "string");
    assert.ok(d.id.length > 0);
    assert.equal(typeof d.name, "string");
    assert.equal(typeof d.summary, "string");
    assert.ok(Array.isArray(d.requirements));
    assert.ok(d.requirements.length > 0);
  }
});

test("tallies in the claim match live counts from apts-foundation.json", () => {
  const { tallies: expected } = expectedTalliesFromFoundation();
  const claim = buildConformanceClaim();
  assert.equal(claim.tallies.met, expected.met);
  assert.equal(claim.tallies.partial, expected.partial);
  assert.equal(claim.tallies["not-applicable"], expected["not-applicable"]);
  assert.equal(claim.tallies["not-met"] || 0, expected["not-met"] || 0);
});

test("renderConformanceMarkdown contains all 8 numbered section headers", () => {
  const claim = buildConformanceClaim();
  const md = renderConformanceMarkdown(claim);
  const headers = [
    "## 1. Platform identification",
    "## 2. Foundation Model disclosure",
    "## 3. Operator and scope",
    "## 4. Posture",
    "## 5. Audit trail integrity",
    "## 6. Last scan",
    "## 7. Requirement coverage (Foundation tier)",
    "## 8. Attribution",
  ];
  for (const h of headers) {
    assert.ok(md.includes(h), `Missing header: ${h}`);
  }
});

test("renderConformanceMarkdown contains every domain's ID and name header", () => {
  const { domains } = expectedTalliesFromFoundation();
  const claim = buildConformanceClaim();
  const md = renderConformanceMarkdown(claim);
  for (const d of domains) {
    const expected = `### ${d.id} — ${d.name}`;
    assert.ok(md.includes(expected), `Missing domain heading: ${expected}`);
  }
});

test("writeConformance writes a report file and returns its path + claim", () => {
  const result = writeConformance();
  assert.equal(typeof result.path, "string");
  assert.equal(typeof result.filename, "string");
  assert.ok(result.filename.endsWith("-conformance.md"));
  assert.ok(fs.existsSync(result.path), "conformance file should exist");
  const body = fs.readFileSync(result.path, "utf-8");
  assert.ok(body.includes("APTS Conformance Claim"));
  assert.ok(body.includes("## 7. Requirement coverage (Foundation tier)"));
  assert.equal(typeof result.claim.tallies, "object");
});
