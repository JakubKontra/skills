# Vulniq Changelog

All notable changes to this skill are documented here. Format is loosely based on [Keep a Changelog](https://keepachangelog.com/), and the project follows semantic versioning.

## 1.3.0 — 2026-04-20 — "Scan-hook enforcement + developer tooling"

Builds on the 1.2.0 APTS governance substrate by moving 6 Foundation-tier requirements from agent-dependent (SKILL.md prose) to **code-enforced** (CLI refuses violations), and adds the full developer-tooling surface: CLI ergonomics, JSON Schemas, GitHub Action, CI, test suite, distribution bin.

### Added — code-enforced governance

- **Scan-hook enforcement layer** — new `scripts/scan-hook.mjs` + `cli.mjs scan-hook <phase>` command. 13 ordered phases (`preflight.start` → `scan.finalised`). The CLI refuses out-of-order or skipped calls with exit code 1; phase-specific validators block continuation when:
  - `preflight.end` is called without a `scope.hash.recorded` event or if any `scope.drift` occurred (enforces APTS-SE-001, SE-006, MR-012, HO-014)
  - `code.analysis.done` is called with any `finding.emitted` missing a valid `evidenceHash` or with `confidence` outside `[0.0, 1.0]` (enforces APTS-AR-004, AR-010)
  - `scan.finalised` is called with a broken audit chain (enforces APTS-AR-012)
- **Moved 6 APTS requirements from agent-dependent to code-enforced**: SE-001, SE-006, MR-012, HO-014, AR-004, AR-010. Summary in `references/apts-compliance.md`.
- **`scan-hook status`** subcommand — introspection of current phase + next-expected phase.

### Added — developer tooling

- **JSON Schemas** under `vulniq/schemas/` (draft-2020-12):
  - `roe.schema.json`, `config.schema.json`, `audit-log-entry.schema.json`, `apts-foundation.schema.json`, `sarif-properties.schema.json`
  - Usage README at `vulniq/schemas/README.md` with ajv and VS Code snippets.
  - Example files (`assets/config.example.json`, `assets/vulniq.roe.example.json`) carry `$schema` pointers for auto-validation.
- **Test suite** — 69 tests (`vulniq/test/`) via `node --test`. Zero dependencies. Covers hash chain, chain-break detection, RoE validation, `isInScope` glob matching, conformance claim structure, CLI integration (halt/pause/conformance/audit-verify), scan-hook enforcement.
- **`vulniq` CLI binary** — `vulniq/package.json` declares `bin: {"vulniq": "./scripts/cli.mjs"}`. `npm link` or `npx .claude/skills/vulniq` puts `vulniq` on PATH. Shebang on `scripts/cli.mjs` + `bin/vulniq` POSIX shell wrapper for environments without npm bin.
- **`--help` / `-h` / `help` / `--version` / `-v`** CLI flags. Bare `vulniq` prints help instead of error JSON. Unknown commands exit with code 1.
- **GitHub Action** — composite action at `vulniq/actions/vulniq/action.yml` runs the governance gate in CI (RoE validate → audit-verify → conformance → optional SARIF upload to GitHub Code Scanning). Example workflow at `.github/workflows/vulniq-example.yml`. Release workflow at `.github/workflows/vulniq-release.yml` fires on `v*` tag pushes.

### Added — release docs

- **`CHANGELOG.md`** — this file.
- **`MIGRATION.md`** — 1.1 → 1.2/1.3 upgrade guide with opt-out compatibility mode.
- **`docs/worked-example.md`** — end-to-end `/vulniq` session walkthrough with CLI calls, audit-log trail, on-disk artefacts, and audit-verify guidance.

### Changed

- **`conformance.mjs`** — platform version now read dynamically from `package.json` instead of hardcoded. Conformance Claim output always matches the installed version.
- **`cli.mjs`** — bare invocation prints help; unknown commands exit 1 (was 0) so CI catches typos.
- **SKILL.md** — new "Scan-hook enforcement" section near the top. Every step of the Execution Protocol now has an explicit `cli.mjs scan-hook <phase>` invocation at its end.

### Known gaps (carried forward from 1.2.0 — classed as "partial" or deferred)

| ID | What's missing | Why |
|---|---|---|
| SC-010 | Continuous health telemetry | Only per-step timeout today |
| HO-002 / AL-008 | Live operator dashboard (TUI) | Deferred |
| HO-015 | Multi-channel notifications (Slack/webhook/email) | Deferred |
| AR-015 | AES-256-GCM encryption of RESTRICTED events | Delegated to operator's filesystem encryption |
| MR-012 | Cryptographic signing (GPG/Sigstore) of RoE | Only hashing today; full signing delegated to git-signed commits |
| MR-019 | Encrypted credential vault | Only masking + hashing today |

See `references/apts-compliance.md` for full status of each requirement.

---

## 1.2.0 — 2026-04-20 — "APTS alignment"

### The big change

Vulniq is now aligned to the **OWASP APTS (Autonomous Penetration Testing Standard) Foundation tier**, covering all 8 domains (52 met / 7 partial / 12 N/A / 0 not-met of 71 Foundation requirements). Every scan emits an **APTS Conformance Claim** as a third output artefact alongside SARIF and the markdown report, and every decision is logged in a **tamper-evident, hash-chained audit log** at `.vulniq/audit-log.ndjson`.

This release is a substantial governance upgrade. The scanner's detection logic is unchanged, but the controls *around* the scan are new: formal Rules of Engagement, multiple kill switches, per-step timeouts, operator identity, asset criticality, and a self-auditing cryptographic event trail. (Note: the scan-hook gate that *enforces* these in code rather than prose landed in 1.3.0 — in 1.2.0 the controls are documented in SKILL.md and assumed to be honoured by the agent.)

### Added — APTS governance

- **Rules of Engagement** — new `vulniq.roe.json` file at the project root declares projectRoot, operator identity, scan window, allowedPaths/forbiddenPaths globs, and asset-criticality tiers. Validated at Step -1 via `cli.mjs roe validate`. See `assets/vulniq.roe.example.json`.
- **Hash-chained audit log** — `.vulniq/audit-log.ndjson` (append-only NDJSON). Each entry includes `prevHash`/`thisHash` SHA-256 chain. New `audit-log`, `audit-verify` CLI commands. Tampering detectable with `cli.mjs audit-verify`.
- **Kill switch + pause** — `.vulniq/HALT` and `.vulniq/PAUSE` flag files. New `halt`, `halt-status`, `halt --release`, `pause`, `pause-status`, `pause --release` CLI commands. Both `halt` and `pause` dump a full state snapshot to `.vulniq/snapshots/<kind>-state-<ts>.json`.
- **APTS Conformance Claim** — new per-scan markdown artefact at `./reports/<ts>-conformance.md` covering all 8 domains with status and evidence pointers. Generated via `cli.mjs conformance`.
- **`apts-checklist` CLI** — prints per-domain Foundation coverage tallies (met / partial / not-applicable / not-met).
- **Manipulation Resistance (MR) check category** — 5 new rules (MR-001..MR-005) detect prompt-injection-shaped content in scanned code (info severity). See `references/manipulation-resistance.md` for the D6 doctrine.
- **Confidence scoring + validation status + evidence hash** — every finding now carries `confidenceScore` (0.0-1.0), `validationStatus` (VERIFIED / UNVERIFIED / FALSE_POSITIVE_SUPPRESSED), `evidenceHash` (SHA-256 of the code snippet), and `classification` (PUBLIC / STANDARD / CONFIDENTIAL / RESTRICTED). Exported in SARIF `properties` and echoed in the markdown report.
- **Authority Delegation Matrix** — new `references/apts-compliance.md` §D3 enumerates who can authorise which actions.
- **Incident Response procedures** — new `references/apts-compliance.md` §D7 IR defines what constitutes an incident and the 6-step response.
- **SBOM declaration** — Vulniq uses Node stdlib only; 0 npm dependencies. Verified in `references/apts-compliance.md` §D7 SBOM.

### Changed

- **Config** — new fields `autonomyLevel` (default `"L3"`), `autonomyLevelOverride` (default `null`), `stepTimeoutMs` (default `300000`), `apts.enabled` (default `true`), `apts.tier` (default `"foundation"`), `checks.manipulationResistance`.
- **SKILL.md Step -1 (new)** — pre-flight step: halt/pause check, RoE validate, audit log init.
- **SKILL.md Step 3** — emits `finding.emitted` audit events per finding with confidence + evidenceHash + classification. Also emits `confidence.escalation` for findings with confidence < 0.75, `scope.drift` for out-of-scope access attempts, and `legal.violation` for forbidden-path touches.
- **SKILL.md Step 6.5 (new)** — generate Conformance Claim before the markdown report.
- **SKILL.md Step 8** — post-scan `git status` integrity check + `audit-verify` chain integrity check before reporting complete.
- **Markdown report template** — new sections: APTS Conformance summary, Confidence & False-Positive Methodology (with per-scan FP rate), Coverage Matrix, Needs Triage.
- **11 check categories** (was 10) — added MR for Manipulation Resistance.

### Security

- The audit log is append-only and its isolation (APTS-AR-020) is enforced by convention in SKILL.md. Any `Write`/`Edit` of `.vulniq/audit-log.ndjson` will be detected by `audit-verify` at the next check.
- Secret findings (SEC-*) classified RESTRICTED. SARIF output carries partial masking + SHA-256 hash only; never plaintext credentials.
- RoE file hashed at Step -1 (`scope.hash.recorded` event) and re-hashed every 30 file operations or 10 minutes (APTS-AL-016 boundary recheck) to detect mid-scan tampering.

---

## 1.1.0 — 2026-03-XX — "External audit ingestion"

### Added

- **External audit ingestion** — agent parses pen-test reports / security reviews into structured JSON and saves to `.vulniq/audits/`. Findings with `vulniqMapping` are cross-referenced against scan results; the markdown report gets an "Audit Remediation Status" section.
- `ingest-audit` and `list-audits` CLI commands.
- 10 security check categories stabilised: SEC, XSS, HDR, PII, AUTH, DEP, OWA, COR, ERR, CHN.

---

## 1.0.0 — 2026-02-XX — "Initial release"

### Added

- Autonomous static security scanner skill for Claude Code.
- SARIF 2.1.0 + markdown dual output.
- Per-category scoring with letter grade (A–F).
- Config file `vulniq.config.json` with check toggles, exclude/include globs, severity threshold, custom patterns, suppressions.
- CLI at `scripts/cli.mjs` with commands: `config`, `save-report`, `save-sarif`, `last-run`, `history`, `suppress`.
- Persistent storage at `.vulniq/` (scan history, suppressions).
