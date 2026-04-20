import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getAuditLogPath } from "./config.mjs";

export const CLASSIFICATIONS = ["PUBLIC", "STANDARD", "CONFIDENTIAL", "RESTRICTED"];

export const EVENTS = [
  "scan.started",
  "step.entered",
  "step.exited",
  "step.timeout",
  "file.read",
  "finding.emitted",
  "suppression.applied",
  "scope.drift",
  "scope.hash.recorded",
  "boundary.recheck",
  "confidence.escalation",
  "impact.threshold.exceeded",
  "legal.violation",
  "pause.requested",
  "pause.released",
  "audit.ingested",
  "halt.triggered",
  "scan.completed",
  "scan.hook",
];

const GENESIS_HASH = "sha256:GENESIS";

export function sha256(input) {
  return "sha256:" + crypto.createHash("sha256").update(input).digest("hex");
}

function canonical(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonical).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

function readAll() {
  const p = getAuditLogPath();
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function lastHash() {
  const entries = readAll();
  if (entries.length === 0) return GENESIS_HASH;
  return entries[entries.length - 1].thisHash;
}

function nextIndex() {
  return readAll().length;
}

export function appendEntry(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Entry must be an object");
  }
  if (!EVENTS.includes(raw.event)) {
    throw new Error(`Unknown event '${raw.event}'. Allowed: ${EVENTS.join(", ")}`);
  }
  const classification = raw.classification || "STANDARD";
  if (!CLASSIFICATIONS.includes(classification)) {
    throw new Error(`Unknown classification '${classification}'. Allowed: ${CLASSIFICATIONS.join(", ")}`);
  }

  const entry = {
    index: nextIndex(),
    ts: new Date().toISOString(),
    event: raw.event,
    stepId: raw.stepId || null,
    classification,
    decision: raw.decision || null,
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    evidenceHash: raw.evidenceHash || null,
    reasoning: raw.reasoning || null,
    context: raw.context || null,
    prevHash: lastHash(),
  };
  entry.thisHash = sha256(entry.prevHash + "|" + canonical(entry));

  const p = getAuditLogPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + "\n", "utf-8");

  return entry;
}

export function verifyChain() {
  const entries = readAll();
  if (entries.length === 0) {
    return { status: "ok", entries: 0, message: "No audit log yet" };
  }

  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.index !== i) {
      return { status: "broken", firstBadIndex: i, reason: `index mismatch: expected ${i}, got ${entry.index}` };
    }
    if (entry.prevHash !== expectedPrev) {
      return { status: "broken", firstBadIndex: i, reason: `prevHash mismatch: expected ${expectedPrev}, got ${entry.prevHash}` };
    }
    const { thisHash, ...withoutHash } = entry;
    const recompute = sha256(entry.prevHash + "|" + canonical(withoutHash));
    if (thisHash !== recompute) {
      return { status: "broken", firstBadIndex: i, reason: `thisHash mismatch at index ${i}` };
    }
    expectedPrev = thisHash;
  }

  return { status: "ok", entries: entries.length, lastHash: expectedPrev };
}

export function hashSnippet(text) {
  return sha256(text || "");
}

export function loadAll() {
  return readAll();
}
