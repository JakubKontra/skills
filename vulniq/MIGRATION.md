# Migrating to Vulniq 1.2 / 1.3

This document covers upgrading from Vulniq 1.1 (pre-APTS) to 1.2+ (APTS Foundation-tier aligned). It is not needed for new installs — those should just follow `docs/vulniq.md`.

> **1.2 → 1.3 is a no-op migration.** No breaking changes; 1.3 just adds scan-hook enforcement and developer tooling on top of 1.2's governance substrate. If you're already on 1.2, you can pull 1.3 and nothing in your config, RoE, or audit log will break. The scan-hook gate is opt-in via SKILL.md protocol — agents that don't call it still work, but you lose the code-enforced governance. See `CHANGELOG.md` for what each version added.

## TL;DR

- Pull the new skill files.
- **Optional but recommended:** create `vulniq.roe.json` at your project root (see §1 below).
- **Nothing in your config breaks.** Existing `vulniq.config.json` files keep working with all new fields defaulted.
- **Your existing `.vulniq/` state is preserved.** `scan-history.json`, `suppressions.json`, and `audits/` are untouched. The new `audit-log.ndjson` starts fresh at your first 1.2 scan.

## 1. Create a Rules of Engagement file (recommended)

RoE is the authoritative boundary document in APTS (D1 — Scope Enforcement). Without it, Vulniq still scans, but runs with **implicit scope** (whole project minus excludes). A `vulniq.warn` is emitted instead of `vulniq.ok`.

```bash
cp .claude/skills/vulniq/assets/vulniq.roe.example.json vulniq.roe.json
# Edit to match your project:
#  - operator.name / operator.email (goes in the audit log + Conformance Claim)
#  - projectRoot  (almost always ".")
#  - allowedPaths (globs — files Vulniq may read)
#  - forbiddenPaths (globs — files Vulniq MUST NOT read)
#  - assetCriticality (optional — surfaced in reports)
#  - scanWindow (optional — ISO-8601 start/end)
```

Validate:

```bash
node .claude/skills/vulniq/scripts/cli.mjs roe validate
# or, if you npm-linked: vulniq roe validate
```

See the schema at `vulniq/schemas/roe.schema.json`.

## 2. Optional config additions

Every existing config keeps working. These fields are new and default sensibly:

| Field | Default | Purpose |
|---|---|---|
| `autonomyLevel` | `"L3"` | APTS Graduated Autonomy level (L1 assisted → L4 unattended). |
| `autonomyLevelOverride` | `null` | Per-run demotion (e.g. `"L2"` to require approval per finding). |
| `stepTimeoutMs` | `300000` | Soft per-step timeout; triggers `step.timeout` event + halt. |
| `apts.enabled` | `true` | Run APTS pre-flight + conformance. Set `false` to restore 1.1-like behaviour. |
| `apts.tier` | `"foundation"` | Currently only Foundation is implemented. |
| `checks.manipulationResistance` | `{enabled: true, severity: "info"}` | New 11th check category for prompt-injection patterns. |

Add any of them to your `vulniq.config.json` if you want to override defaults. Otherwise, do nothing.

## 3. If you want fewer changes (compatibility mode)

To keep 1.1 behaviour as closely as possible:

```json
{
  "apts": { "enabled": false }
}
```

This skips Step -1, Step 6.5, Conformance Claim generation, and scan-hook enforcement. You still get the new CLI commands (`roe`, `audit-log`, `halt`, `pause`, etc.) but running a scan does not require any of them.

Note: reports will still include the new fields (`confidenceScore`, `validationStatus`, `evidenceHash`, `classification`) in SARIF and markdown, since those are per-finding, not per-scan. They are additive and do not break SARIF 2.1.0 consumers.

## 4. Two "audits" — name disambiguation

1.1 had one concept called "audit" — ingested external audit documents at `.vulniq/audits/`. 1.2 adds a second, unrelated one called "audit log" at `.vulniq/audit-log.ndjson`. Remember:

| Concept | Path | Written by |
|---|---|---|
| **External audit** | `.vulniq/audits/<slug>.json` | `cli.mjs ingest-audit` — existed in 1.1 |
| **Audit log** | `.vulniq/audit-log.ndjson` | `cli.mjs audit-log <event>` — new in 1.2 |

They are independent. You can use external audits without audit log, or vice versa.

## 5. CI workflow updates

If you were already uploading Vulniq's SARIF to GitHub Code Scanning manually, you can now use the composite action:

```yaml
- uses: ./.claude/skills/vulniq/actions/vulniq
  with:
    sarif-path: reports/latest.sarif.json
```

See `vulniq/actions/vulniq/README.md` for the full input reference and `.github/workflows/vulniq-example.yml` for a working example.

## 6. CLI invocations

The short `vulniq <cmd>` form is new but optional. The long form still works:

```bash
# New short form (requires npm link or npx)
vulniq apts-checklist

# Legacy long form (always works)
node .claude/skills/vulniq/scripts/cli.mjs apts-checklist
```

## 7. What you gain after migrating

- Per-scan **APTS Conformance Claim** alongside SARIF and markdown.
- Tamper-evident audit log you can verify any time with `cli.mjs audit-verify`.
- `halt` / `pause` with full state dump for operational control.
- Confidence scores + evidence hashes on every finding.
- A new MR check category for prompt-injection observations.
- Ready-to-commit JSON Schemas for IDE/ajv validation.
- A test suite (`npm test`) that locks in all of the above.
