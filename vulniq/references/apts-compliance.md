# Vulniq ↔ OWASP APTS Compliance Map

**Standard:** OWASP Autonomous Penetration Testing Standard (APTS) — https://github.com/OWASP/APTS
**Tier claimed:** Foundation
**License:** CC BY-SA 4.0 (this document attributes OWASP APTS as the source; requirement IDs and titles are taken verbatim from the standard's `appendix/Checklists.md`)
**Vulniq version:** 1.3.0 (APTS Foundation-tier, scan-hook enforced)

This document explains how Vulniq — an autonomous static security scanner — satisfies the APTS Foundation tier across all 8 domains. The machine-readable companion is `references/apts-foundation.json`, consumed by `scripts/conformance.mjs` to generate per-scan Conformance Claims.

---

## Posture statement

Vulniq is a **static, read-only code scanner**. It executes no exploits, performs no network actions against the scanned system (other than `npm audit`, which contacts the npm registry — allowlisted), and writes only to `./reports/` (deliverables) and `.vulniq/` (state). This posture is declared, enforced at Step -1, and verified at Step 8.

- **CIA impact classification (APTS-SC-001):** Confidentiality = LOW, Integrity = LOW, Availability = LOW.
- **Autonomy level (APTS-AL-012, AL-014):** **L3 (High Autonomy)** — fully autonomous for scanning + reporting; human review required for remediation, suppression additions, and RoE changes.

---

## D1 — Scope Enforcement

Vulniq enforces scope via a formal `vulniq.roe.json` (Rules of Engagement) file at the project root. The file declares allowed paths, forbidden paths, an optional scan window, asset-criticality tiers, and operator identity. See `assets/vulniq.roe.example.json`.

**Key controls:**
- **APTS-SE-001:** RoE is machine-parseable JSON; validated by `cli.mjs roe validate`.
- **APTS-SE-004:** `scanWindow.start` / `scanWindow.end` ISO-8601 timestamps enforced pre-scan. All audit-log timestamps are ISO-8601 ms.
- **APTS-SE-005:** `assetCriticality` map (glob → high/medium/low) surfaced in reports.
- **APTS-SE-006:** Pre-action scope check before every file Read in Step 3 (`scripts/roe.mjs isInScope()`).
- **APTS-SE-008:** Scan window re-validated at every step transition; remaining time emitted in `step.entered` event.
- **APTS-SE-009:** `forbiddenPaths` is the immutable hard deny list. RoE file is SHA-256 hashed at Step -1 (`scope.hash.recorded` event) and re-checked every 30 file operations (AL-016 boundary recheck).

**Declared not-applicable:** APTS-SE-002 (IP/CIDR), APTS-SE-003 (domain/DNS) — Vulniq operates on filesystem paths only.

---

## D2 — Safety Controls & Impact Management

### Multiple independent kill switches (APTS-SC-009)
Three triggers, each detectable within one step transition (typically ≤1s, always <5s):
1. `.vulniq/HALT` flag file (created with `cli.mjs halt`)
2. `cli.mjs halt` command (also writes the flag + dumps state)
3. Operator closing the Claude Code session

### Per-step soft timeout (APTS-SC-010)
Each Step in the execution protocol has a soft budget (default 300s via `stepTimeoutMs`). If exceeded, the agent emits `step.timeout` to the audit log and halts.

### Read-only posture (APTS-SC-001, -015)
- No writes to the scanned tree.
- No network actions against targets (only `npm audit` which contacts the npm registry — declared in allowlist).
- Post-scan `git status` check in Step 8 asserts no unexpected modifications. Any diff outside `./reports/` and `.vulniq/` is flagged as a policy violation.

### Action allowlist (APTS-SC-020)
Vulniq operations are restricted to these tools/commands:

| Tool | Scope |
|---|---|
| `Grep` | read-only content search |
| `Read` | read single file |
| `Glob` | read-only file discovery |
| `Bash(npm audit --json)` | read-only dependency audit |
| `Bash(git ls-files …)` | read-only git inspection |
| `Bash(git log …)` | read-only git history |
| `Bash(git status)` | post-scan integrity check |
| `Bash(node <skill>/scripts/cli.mjs …)` | Vulniq's own CLI for state persistence |

Anything else is **out of standard**. Invocations outside this list must be logged as policy-violation events.

---

## D3 — Human Oversight & Intervention

### Approval gates (APTS-HO-001, -010)
Claude Code's tool-permission layer is the primary oversight gate: every Bash invocation and every file Edit/Write is subject to user approval (unless in auto mode, which the operator chose with full awareness).

| Action | Gate |
|---|---|
| Edit `vulniq.roe.json` | Explicit user action (no CLI mutator; edit file directly) |
| Add suppression | Explicit `cli.mjs suppress` invocation by user |
| Ingest external audit | Explicit `cli.mjs ingest-audit` invocation by user |
| Release `.vulniq/HALT` | Explicit `cli.mjs halt --release` or manual file removal |
| Release `.vulniq/PAUSE` | Explicit `cli.mjs pause --release` |
| Increase autonomy level above L3 | Not supported — requires skill upgrade |

### Activity feed & dashboard (APTS-HO-002, -015)
- **Primary feed:** `.vulniq/audit-log.ndjson` — tail-able NDJSON stream of every event.
- **Secondary feed:** Claude Code session surfaces critical events inline in Step 8.
- **Dashboard commands:** `last-run`, `history`, `list-audits`, `apts-checklist`, `halt-status`, `pause-status`, `audit-verify`.
- *Not implemented:* fan-out to Slack/email/webhooks — classified `partial` for HO-015.

### Response-time SLAs (APTS-HO-003)
- Kill switch: ≤5s (single step transition).
- Per-step timeout: configurable `stepTimeoutMs`, default 300s.
- Default-safe behaviours on failure: refuse to scan on RoE error; halt on broken audit chain; halt on step timeout; block Step 7 until integrity re-verified.

### Authority Delegation Matrix (APTS-HO-004)

| Role | May authorise |
|---|---|
| **Scan Operator** (named in `vulniq.roe.json`) | Initiating a scan, releasing HALT/PAUSE, editing RoE, adding suppressions, ingesting external audits |
| **Claude Code session** | Executing the allowlisted tools within RoE scope, emitting audit-log events, writing to `./reports/` and `.vulniq/` |
| **Reviewer** (downstream consumer) | Reading reports + Conformance Claim; cannot initiate scans without becoming Operator |
| **Anthropic (platform provider)** | Model execution only — has no authority over scan scope, RoE, or reports |

### Pause mechanism (APTS-HO-006)
`cli.mjs pause` creates `.vulniq/PAUSE` and dumps a state snapshot to `.vulniq/snapshots/pause-state-<ts>.json` (audit-log index, last entry, RoE summary, autonomy level). `pause --release` clears it. The agent checks for PAUSE at every step transition and, if present, completes the current Read and halts with state preserved.

### Mid-scan scope redirection (APTS-HO-007)
Operator may edit `vulniq.roe.json` mid-scan. On next step transition, the agent calls `roe validate` which re-hashes and emits `scope.hash.recorded` — the hash change is a permanent, signed entry in the audit log. No restart required; scope updates at the next file Read.

### One-click kill switch with state dump (APTS-HO-008)
`cli.mjs halt` — single command that writes HALT flag AND dumps state to `.vulniq/snapshots/halt-state-<ts>.json`. State includes: audit log index, last entry, RoE summary, autonomy level, paths to HALT/PAUSE files.

### Escalation triggers (APTS-HO-011, -012, -013, -014)

| Trigger | Event | Where surfaced |
|---|---|---|
| Critical finding discovered | `finding.emitted` (classification RESTRICTED/CONFIDENTIAL) | Inline in Step 8 summary, not buried |
| Confidence score < 0.75 | `confidence.escalation` | Report triage-needed section |
| Scope drift attempt | `scope.drift` + `legal.violation` (when RoE forbidden path touched) | RESTRICTED-classified audit events |
| Unexpected file mutation post-scan | `impact.threshold.exceeded` | Step 8 policy violation notice |
| Broken audit chain | aborted Step 7 | Surfaced before any report generated |
| Step timeout | `step.timeout` | Halt + audit log entry |

### Operator qualification (operator must)
- Have filesystem read access to the scanned codebase
- Have Claude Code configured with permissions for the allowlisted tools
- Understand that findings are advisory and require human triage before remediation
- Maintain the `vulniq.roe.json` as the source of truth for scope

---

## D4 — Graduated Autonomy Levels

| Level | Description | Vulniq support |
|---|---|---|
| L1 | Assisted — every action approved | Achievable via `autonomyLevelOverride: "L1"` + Claude Code per-tool prompts |
| L2 | Supervised — approval per finding | Achievable via `autonomyLevelOverride: "L2"` |
| **L3** | **High autonomy — approval per scan (default)** | **Default posture** |
| L4 | Fully autonomous — no human in loop | Out of scope (and out of standard for Foundation tier) |

### Per-level APTS requirements mapping

- **APTS-AL-001..AL-004** are L1-specific operational constraints; declared **not-applicable** at our claimed L3.
- **APTS-AL-005** (9 mandatory log fields, immutable): audit-log entries carry 12 fields (`index`, `ts`, `event`, `stepId`, `classification`, `decision`, `confidence`, `evidenceHash`, `reasoning`, `context`, `prevHash`, `thisHash`) — exceeds the minimum.
- **APTS-AL-006** (validate scope/technique/engagement before every action): enforced in Step 3.
- **APTS-AL-008** (live operator dashboard): the Claude Code session itself is the live connection; audit log is tail-able — classified `partial` (no separate GUI dashboard).
- **APTS-AL-011** (escalation triggers): enumerated above in §D3.
- **APTS-AL-012** (≤5s termination + pause): HALT + PAUSE commands both implemented.
- **APTS-AL-014** (formal boundary document): `vulniq.roe.json` with schema in `references/config-schema.md`.
- **APTS-AL-016** (boundary recheck every 30 min): implemented as every-30-operations or every-10-minutes (whichever first); emits `boundary.recheck` event with current RoE hash.

Declared level is surfaced in every markdown report header and in the Conformance Claim Section 3.

---

## D5 — Auditability & Reproducibility

### Hash-chained audit log

Location: `.vulniq/audit-log.ndjson` (NDJSON, append-only).

Each line is an event object:

```json
{
  "index": 42,
  "ts": "2026-04-20T14:30:22.417Z",
  "event": "finding.emitted",
  "stepId": "step.3",
  "classification": "STANDARD",
  "decision": { "ruleId": "SEC-001", "severity": "critical", "validationStatus": "VERIFIED" },
  "confidence": 0.92,
  "evidenceHash": "sha256:3f2a…",
  "reasoning": "Matched SEC-001 pattern in apps/crm/.env; value length 36 chars; tracked by git (confirmed via git ls-files)",
  "context": { "file": "apps/crm/.env.production", "line": 6 },
  "prevHash": "sha256:9b1e…",
  "thisHash": "sha256:c4d8…"
}
```

Where `thisHash = sha256(prevHash || canonical(entry_without_thisHash))`. The genesis entry has `prevHash = "sha256:GENESIS"`.

**Verification:** `cli.mjs audit-verify` walks the chain, recomputes every `thisHash`, and returns `{status: "ok", entries: N}` or `{status: "broken", firstBadIndex: I, reason: "..."}`.

**Isolation:** The agent must never open `.ndjson` with `Write`/`Edit`. Only `audit-log` appends. This is enforced by convention in SKILL.md and detectable by `audit-verify` (any break in the chain ⇒ tampering).

### Evidence classification (APTS-AR-015, APTS-TP-012)

| Level | When used |
|---|---|
| `PUBLIC` | Scan metadata, scores, rule IDs, RoE hash |
| `STANDARD` | Most findings (XSS, headers, CORS, etc.) |
| `CONFIDENTIAL` | PII findings, auth findings, error-handling findings |
| `RESTRICTED` | Secret findings (SEC-*), private-key discoveries, scope-drift events |

### Event catalogue

| Event | When |
|---|---|
| `scan.started` | Step -1 after RoE validation and HALT check pass |
| `step.entered` / `step.exited` | Beginning / end of each Step 0…8 |
| `step.timeout` | Step exceeded `stepTimeoutMs` |
| `file.read` | Every `Read` performed on a scanned file |
| `finding.emitted` | Each confirmed finding |
| `suppression.applied` | When a suppression blocks a finding |
| `scope.drift` | Attempted access to out-of-scope path |
| `scope.hash.recorded` | RoE file hashed at Step -1 and on every redirect |
| `boundary.recheck` | Every 30 ops / 10 min; re-hashes RoE and asserts match |
| `confidence.escalation` | Finding with confidenceScore < 0.75 |
| `impact.threshold.exceeded` | Post-scan mutation detected OR `maxFindings` reached |
| `legal.violation` | RoE-forbidden path touched OR scan window violation |
| `pause.requested` / `pause.released` | Operator paused or resumed |
| `audit.ingested` | External-audit ingestion |
| `halt.triggered` | `.vulniq/HALT` observed or `halt` command issued |
| `scan.completed` | Step 8 complete, integrity check passed |

---

## D6 — Manipulation Resistance

Full detail in `references/manipulation-resistance.md`. Key APTS mappings:

- **APTS-MR-001, -018:** Architectural separation — operator instructions arrive only via Claude Code session and `vulniq.roe.json`. Scanned content is always data, never instructions.
- **APTS-MR-003:** Error messages from `npm audit`, `git`, etc., are captured as data and logged; never interpreted as directives.
- **APTS-MR-004:** Config files in scanned projects are analysed for vulnerabilities (HDR, COR, AUTH rules) but never alter Vulniq's own config.
- **APTS-MR-005, -010:** Detection patterns MR-001..MR-005 in `references/security-patterns.md` §11 surface authority claims and linguistic manipulation as info findings.
- **APTS-MR-011:** No inbound instruction channels exist beyond Claude Code session + RoE file. No webhooks, no email, no DNS.
- **APTS-MR-012:** RoE integrity monitoring via SHA-256 hashing at Step -1 (`scope.hash.recorded`) and boundary rechecks (AL-016). Formal digital signing of the RoE file is delegated to the operator's VCS (e.g., git-signed commits) — classified `partial`.
- **APTS-MR-019:** Secret findings never surface in plaintext in reports. SARIF includes partial masking + SHA-256 hash of the snippet. Encrypted vault storage delegated to operator — classified `partial`.

**Declared not-applicable:** APTS-MR-002, -007, -008 (live network/DNS/redirect validation).

---

## D7 — Third-Party & Supply Chain Trust

### Foundation Model disclosure (APTS-TP-021)
Vulniq runs exclusively inside the invoking Claude Code session. Provider: **Anthropic**. Product: **Claude Code**. Model: determined by the session at runtime (typically Claude 4.x family). Disclosed in Conformance Claim §2 and every report header.

### Provider vetting (APTS-TP-001)
Vulniq has one external provider: **Anthropic (Claude Code)**. Vetting criteria:
- Published security documentation reviewed
- Data-handling commitments documented (Anthropic's terms of service)
- Operator confirms Claude Code deployment model (local CLI vs. web) matches data sensitivity tier
- No other external LLM or AI service called

### Authentication & credentials (APTS-TP-003)
Vulniq stores no credentials of its own. Authentication to Anthropic is handled by the host Claude Code session. `npm audit` uses local npm credentials (unchanged by Vulniq).

### Incident Response procedures (APTS-TP-005)
An **incident** in Vulniq's context is any of:
- Broken audit chain (`audit-verify` returns `status: "broken"`)
- Unexpected file mutation detected post-scan (Step 8 `git status` shows writes outside `./reports/` and `.vulniq/`)
- Scope drift not previously seen
- Policy-violation tool invocation (outside the action allowlist)

**Response steps:**
1. Preserve current state: run `cli.mjs halt` (auto-dumps snapshot).
2. Preserve the audit log: copy `.vulniq/audit-log.ndjson` and `.vulniq/snapshots/` to a separate secure location.
3. Do not overwrite, truncate, or hand-edit the audit log — this is evidence.
4. Notify the scan operator (named in RoE).
5. If the incident involves data outside the RoE scope, notify the asset owner (criticality-tier contact).
6. Do not re-scan until the integrity issue is understood; re-scanning appends to the same chain.

### SBOM (APTS-TP-006)

Vulniq's Software Bill of Materials:

| Component | Source | Version |
|---|---|---|
| Node.js standard library (`fs`, `path`, `crypto`, `url`) | Node.js runtime (operator-provided) | ≥ Node 18 |
| No npm dependencies | — | — |

Verifiable by `grep -r 'from "' vulniq/scripts/ | grep -v '\./config.mjs\|\./audit-log.mjs\|\./roe.mjs\|\./conformance.mjs'` — output lists only Node built-ins. Vulnerability monitoring: none required (stdlib only); Node security advisories apply via the operator's Node install.

### Data classification (APTS-TP-012)
Four-level classification applied to every audit-log event and every finding. See §D5 table.

### Automated credential / PII discovery (APTS-TP-013)
Core detection categories:
- **Secrets (SEC-001..SEC-008):** API keys, AWS credentials, private keys, JWTs, connection strings, env files in git, NEXT_PUBLIC leaks
- **PII (PII-001..PII-006):** Sentry PII scrubbing, sendDefaultPii, Replay masking, console logging of sensitive data, user-object logging

### Tenant isolation (APTS-TP-018)
Vulniq scopes all state to a project: config discovery walks up from CWD and stops at the first `vulniq.config.json`; `.vulniq/` is created under that project root. Two projects on the same machine do not share scan history, suppressions, audit logs, or RoE.

**Declared not-applicable:** APTS-TP-008 (cloud hardening), APTS-TP-014 (TLS/AES enforcement) — Vulniq is local, not cloud.

---

## D8 — Reporting

### Per-finding fields (added to SARIF and markdown)

| Field | Range | Source |
|---|---|---|
| `confidenceScore` | 0.0–1.0 | Verification thoroughness (rubric below) |
| `validationStatus` | `VERIFIED` / `UNVERIFIED` / `FALSE_POSITIVE_SUPPRESSED` | Agent decision after Step 3 verification |
| `evidenceHash` | `sha256:<hex>` | SHA-256 of the confirming code snippet |
| `classification` | `PUBLIC` / `STANDARD` / `CONFIDENTIAL` / `RESTRICTED` | Derived from rule category |

### False-positive rate methodology (APTS-RP-006)

Confidence scoring rubric published in every report:
- **1.0** — pattern matched AND surrounding code confirms exploitability
- **0.9** — pattern matched AND context clearly confirms true positive
- **0.7** — pattern matched AND heuristics suggest true positive but one branch of context not fully inspected
- **0.5** — pattern matched, context ambiguous (operator should verify)
- **0.3** — pattern matched, context suggests likely false positive (surfaced only because rule was borderline)

FP rate = (count of 0.3 + 0.5 findings) / (total findings). Reports disclose this percentage.

### Coverage matrix (APTS-RP-008)

Every report includes a Score Breakdown table enumerating all 11 check categories with enabled/disabled status — that IS the coverage matrix. Disabled checks are explicitly listed so reviewers can see what was NOT tested.

| Category | Rule-ID prefix | Tested vulnerability classes |
|---|---|---|
| Secrets | SEC-* | CWE-798 (hardcoded creds), CWE-200 (info exposure), OWASP A02 |
| XSS | XSS-* | CWE-79, OWASP A03 |
| Security Headers | HDR-* | NIST SP 800-53 AC-4, OWASP ASVS V14.4 |
| PII Exposure | PII-* | GDPR Art. 5(1)(c), CWE-532 |
| Authentication | AUTH-* | CWE-287, OWASP A01 |
| Dependencies | DEP-* | CWE-1104, OWASP A06 |
| OWASP Top 10 | OWA-* | A01-A08 (various) |
| CORS | COR-* | CWE-942 |
| Error Handling | ERR-* | CWE-209, CWE-497 |
| Dependency Chain | CHN-* | CWE-1357, OWASP A08 |
| Manipulation Resistance | MR-* | OWASP LLM-01, APTS D6 |

### Executive summary (APTS-RP-011)
Every report opens with a plain-language Executive Summary (2-3 sentences) covering: overall security posture, single most critical issue, primary recommendation.

### Conformance Claim artefact
`cli.mjs conformance` reads `.vulniq/scan-history.json`, `.vulniq/audit-log.ndjson`, and `references/apts-foundation.json`, then writes a per-scan claim to `./reports/<timestamp>-conformance.md` following `assets/conformance-claim.template.md`.

---

## Coverage summary

| Domain | Reqs | Met | Partial | Not-applicable | Not-met |
|---|---|---|---|---|---|
| SE — Scope Enforcement | 8 | 6 | 0 | 2 | 0 |
| SC — Safety Controls | 6 | 4 | 1 | 1 | 0 |
| HO — Human Oversight | 13 | 11 | 2 | 0 | 0 |
| AL — Graduated Autonomy | 11 | 6 | 1 | 4 | 0 |
| AR — Auditability | 7 | 6 | 1 | 0 | 0 |
| MR — Manipulation Resistance | 13 | 8 | 2 | 3 | 0 |
| TP — Third-Party Trust | 10 | 8 | 0 | 2 | 0 |
| RP — Reporting | 3 | 3 | 0 | 0 | 0 |
| **Total** | **71** | **52** | **7** | **12** | **0** |

(Not-met = 0 is the claim; reviewers are encouraged to audit.)
