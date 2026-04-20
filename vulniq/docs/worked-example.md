# Worked Example: Running Vulniq Against a Real Project

This walkthrough shows an actual end-to-end `/vulniq` session: what the operator types, what Claude does, what the CLI emits, and what lands in `./reports/` and `.vulniq/`. If you just want to know "what will happen when I run this?", read this document.

---

## Scenario

You're about to run Vulniq for the first time on a Next.js + Express monorepo. You've just run:

```bash
npx skills add JakubKontra/skills --skill vulniq
```

The skill is installed at `.claude/skills/vulniq/`. Your project layout:

```
my-app/
├── apps/
│   ├── billing/     # Next.js
│   └── api/         # Express
├── packages/
│   └── ui/
├── package.json
└── .git/
```

No `vulniq.config.json`, no `vulniq.roe.json` yet.

---

## Step 1 — Create a Rules of Engagement file (once per project)

```bash
cp .claude/skills/vulniq/assets/vulniq.roe.example.json vulniq.roe.json
```

Then edit it:

```json
{
  "$schema": "../schemas/roe.schema.json",
  "version": "1.0",
  "projectRoot": ".",
  "operator": {
    "name": "You",
    "email": "you@example.com",
    "role": "Engineer"
  },
  "allowedPaths": ["apps/**", "packages/**", "package.json"],
  "forbiddenPaths": ["infrastructure/**", "secrets/**"],
  "assetCriticality": {
    "apps/billing/**": "high",
    "apps/api/**": "high",
    "packages/ui/**": "medium"
  }
}
```

Validate it:

```bash
node .claude/skills/vulniq/scripts/cli.mjs roe validate
```

Output:

```json
{"command":"roe","status":"ok","roe":{"_found":true,"path":"/path/to/my-app/vulniq.roe.json",...},"errors":[],"warnings":[],"scopeHash":"sha256:620e09de7b4d…"}
```

The `scopeHash` is the SHA-256 of the RoE file. It's now recorded in the audit log (`.vulniq/audit-log.ndjson`), so mid-scan changes to the RoE are detectable.

---

## Step 2 — Invoke the skill

In Claude Code:

```
/vulniq
```

Claude takes over and follows the Execution Protocol in SKILL.md. Here's a condensed view of what happens and the CLI calls Vulniq makes internally.

### Step -1: APTS Pre-flight

```
Vulniq: Starting scan. Checking halt + pause state…
  cli.mjs halt-status   → {active: false}
  cli.mjs pause-status  → {active: false}
  cli.mjs roe validate  → status: ok, scopeHash: sha256:620e09de…
  cli.mjs audit-verify  → status: ok, entries: 1
  cli.mjs audit-log scan.started ← {classification: PUBLIC, context: {cwd: "/path/to/my-app", operator: "You"}}
  cli.mjs scan-hook preflight.start
  cli.mjs scan-hook preflight.end
```

The audit log now has 3 entries:
1. `scope.hash.recorded` (from roe validate)
2. `scan.started`
3. `scan.hook preflight.start`
4. `scan.hook preflight.end`

### Step 0–2: Config load, project detection, external scans

```
Vulniq: No vulniq.config.json found — using defaults.
Vulniq: Detected Next.js (apps/billing/) + Express (apps/api/), monorepo.
Vulniq: Running `npm audit --json` and `git ls-files '*.env*'` in parallel…
  cli.mjs scan-hook config.loaded
  cli.mjs scan-hook project.detected
  cli.mjs scan-hook audits.loaded         (no external audits)
  cli.mjs scan-hook external.scans.done
```

### Step 3: Code analysis

Claude runs 11 check categories in parallel. For each Grep match, it Reads 15-20 lines of surrounding context and decides whether to confirm as a finding.

Example flow for one finding:

```
Vulniq: Grep for SEC-001 pattern in apps/billing/.env.production
  → matched: GOOGLE_MAPS_API_KEY=AIzaSyB2…
Vulniq: Reading apps/billing/.env.production for context…
  → tracked by git (confirmed via git ls-files)
  → 36-char key, not a placeholder
Vulniq: CONFIRMED as SEC-001 (critical).
  cli.mjs audit-log finding.emitted ← {
    classification: RESTRICTED,
    decision: {ruleId: SEC-001, severity: critical, validationStatus: VERIFIED},
    confidence: 0.92,
    evidenceHash: sha256:3f2a7b…,
    reasoning: "Matched SEC-001; value length 36 chars; tracked by git",
    context: {file: "apps/billing/.env.production", line: 6}
  }
```

After 3 minutes of scanning across ~200 files:

```
Vulniq: Code analysis complete. 14 findings (3 critical, 5 high, 4 medium, 2 low, 12 info MR-* observations).
  cli.mjs scan-hook code.analysis.done
```

If any finding had `confidence < 0.75`, Vulniq also emits `confidence.escalation`.

### Step 5–6.5: Score, SARIF, Conformance Claim

```
Vulniq: Computing scores…
  Overall: C (62/100)
  Secrets: 40/100  (1 critical)
  XSS: 80/100     (2 high)
  Headers: 55/100 (missing CSP + HSTS)
  …
  cli.mjs scan-hook scores.computed
Vulniq: Writing SARIF…
  cli.mjs save-sarif "Q2-2026 Security Audit"
  → ./reports/2026-04-20T140322-q2-2026-security-audit.sarif.json
  cli.mjs scan-hook sarif.saved
Vulniq: Generating APTS Conformance Claim…
  cli.mjs conformance
  → ./reports/2026-04-20T140322-conformance.md
  → tallies: {met: 52, partial: 7, not-applicable: 12, not-met: 0}
  → auditChain: ok
  cli.mjs scan-hook conformance.saved
```

### Step 7–8: Markdown report + finalise

```
Vulniq: Writing Markdown report…
  cli.mjs save-report "Q2-2026 Security Audit"
  → ./reports/2026-04-20T140322-q2-2026-security-audit.md
  cli.mjs scan-hook report.saved

Vulniq: Post-scan integrity check…
  git status --porcelain → (no unexpected mutations)
  cli.mjs audit-verify    → status: ok, entries: 47
  cli.mjs audit-log scan.completed
  cli.mjs scan-hook scan.finalised
```

---

## Step 3 — What you see in the Claude Code conversation

```
✅ Scan complete.

Grade: C (62/100)
Duration: 3m 14s
Files scanned: 214

CRITICAL findings (must fix before production):
  SEC-001  apps/billing/.env.production:6     Google Maps API key committed to git
  SEC-005  packages/db/connection.ts:12       Postgres connection string with password
  OWA-001  apps/api/src/users.ts:47           Raw SQL with string interpolation

Top 5:
  (above 3 + ...)
  HDR-001  apps/billing/next.config.mjs       Missing Content-Security-Policy
  AUTH-001 apps/billing/lib/auth.ts:23        JWT stored in localStorage

APTS Conformance: Foundation tier, autonomy L3, audit chain ok.
  Full claim: ./reports/2026-04-20T140322-conformance.md

Artefacts:
  ./reports/2026-04-20T140322-q2-2026-security-audit.md
  ./reports/2026-04-20T140322-q2-2026-security-audit.sarif.json
  ./reports/2026-04-20T140322-conformance.md

Next: suppress false positives with `cli.mjs suppress <id>` or start fixing criticals.
```

---

## Step 4 — What ends up on disk

After the scan:

```
my-app/
├── vulniq.roe.json                     ← committed
├── reports/                            ← commit these to track posture over time
│   ├── 2026-04-20T140322-q2-2026-security-audit.md
│   ├── 2026-04-20T140322-q2-2026-security-audit.sarif.json
│   └── 2026-04-20T140322-conformance.md
└── .vulniq/
    ├── audit-log.ndjson                ← 47-line hash-chained log of every decision
    ├── scan-history.json               ← metadata: grade, score, date
    └── snapshots/                      ← empty unless halt/pause was triggered
```

What to commit to git:

| File | Commit? | Why |
|---|---|---|
| `vulniq.roe.json` | yes | boundary document |
| `vulniq.config.json` | yes (if present) | config is operator intent |
| `reports/*.md`, `*.sarif.json`, `*-conformance.md` | yes | posture history |
| `.vulniq/audit-log.ndjson` | **it depends** | audit evidence, but may contain RESTRICTED events — see classification |
| `.vulniq/scan-history.json` | yes (optional) | score trend |
| `.vulniq/suppressions.json` | yes | team-agreed false positives |
| `.vulniq/snapshots/` | gitignore | debug-only |
| `.vulniq/HALT`, `.vulniq/PAUSE` | gitignore | transient flags |
| `.vulniq/audits/` | yes | ingested external audits for remediation tracking |

---

## Step 5 — Verifying the audit log

Any time after the scan:

```bash
$ node .claude/skills/vulniq/scripts/cli.mjs audit-verify
{"command":"audit-verify","status":"ok","entries":47,"lastHash":"sha256:c750f9e4…"}
```

If someone edits the log file and alters, say, the `reasoning` of entry #12:

```bash
$ node .claude/skills/vulniq/scripts/cli.mjs audit-verify
{"command":"audit-verify","status":"broken","firstBadIndex":12,"reason":"thisHash mismatch at index 12"}
```

The chain is constructed so that flipping any field anywhere invalidates every entry after it. This is the APTS-AR-012 tamper-evidence guarantee.

---

## Step 6 — Inspecting the Conformance Claim

Open `./reports/2026-04-20T140322-conformance.md`. Top of the file:

```markdown
# APTS Conformance Claim — Vulniq v1.3.0

**Standard:** OWASP APTS 1.0 — Tier: **Foundation**
**Generated:** 2026-04-20T14:03:22.488Z
**Autonomy level:** L3

## 1. Platform identification
- Name: Vulniq
- Version: 1.3.0
- Autonomy Level: L3

## 2. Foundation Model disclosure
- Provider: Anthropic
- Product: Claude Code
- Model: runtime-session

## 3. Operator and scope
- Operator: You <you@example.com>
- Role: Engineer
- Project root: `.`
- Allowed paths: `apps/**`, `packages/**`, `package.json`
- Forbidden paths: `infrastructure/**`, `secrets/**`

## 4. Posture
- Read-only: yes
- CIA impact: C=LOW, I=LOW, A=LOW
- Action allowlist: `Grep`, `Read`, `Glob`, ...

## 5. Audit trail integrity
- Entries: 47
- Chain status: **ok**

## 6. Last scan
- Date: 2026-04-20T140322
- Title: Q2-2026 Security Audit
- Grade: C (62/100)
- Findings: 3 critical · 5 high · 4 medium · 2 low

## 7. Requirement coverage (Foundation tier)

| Status | Count |
|---|---|
| Met | 52 |
| Partial | 7 |
| Not applicable | 12 |
| Not met | 0 |

### SE — Scope Enforcement
[table with all 8 SE-xxx requirements, status, evidence pointer]

### SC — Safety Controls
[...]

[...all 8 domains enumerated]

## 8. Attribution
This claim is a self-assessment aligned to OWASP APTS (CC BY-SA 4.0).
```

Ship this file alongside your SARIF and markdown report when a stakeholder asks "is your scanner APTS-aligned?"

---

## Step 7 — Next scan

Nothing changes. Run `/vulniq` again. The audit log continues appending — the next scan's `preflight.start` becomes entry #48, not a new file. Over time the audit log becomes your permanent scan record.

If the audit log grows uncomfortably large, rotate it:

```bash
mv .vulniq/audit-log.ndjson .vulniq/audit-log-archive-$(date +%Y%m%d).ndjson
```

The next scan starts a fresh chain from GENESIS. Archives are human-verifiable via `audit-verify` after being temporarily renamed back.

---

## Troubleshooting

**"RoE error: projectRoot '.' resolves to /x but CWD resolves to /y"** — you invoked Vulniq from a subdirectory. Either cd to project root or edit `projectRoot` in `vulniq.roe.json`.

**"audit-verify: status broken, firstBadIndex: N"** — someone edited `.vulniq/audit-log.ndjson` directly. The chain is broken forever from entry N onward. Preserve the file as evidence, investigate, then rotate (see step 7 above) before running another scan.

**"scan-hook error: expected 'config.loaded'"** — the agent skipped a step. Most likely Claude's context was reset mid-scan. Run `cli.mjs scan-hook status` to see where you are, then `cli.mjs scan-hook preflight.start` to restart the scan from the beginning.

**Kill switch was activated and I want to resume** — `node .claude/skills/vulniq/scripts/cli.mjs halt --release`, then `/vulniq`.

**The report complains about my confidence threshold** — findings with `confidence < 0.75` go to the "Needs Triage" section. Review them; if legitimate, fix. If false positives, suppress them.
