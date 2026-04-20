# Vulniq Configuration Schema

Configuration file: `vulniq.config.json` in the project root. **All fields are optional** — Vulniq works with zero config.

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `checks` | object | all enabled | Enable/disable individual check categories |
| `checks.<name>.enabled` | boolean | `true` | Whether to run this check |
| `checks.<name>.severity` | string | varies | Override default severity for this category |
| `exclude` | string[] | see below | Glob patterns for files to skip |
| `include` | string[] | `[]` | If non-empty, **only** scan matching files |
| `severityThreshold` | string | `"low"` | Minimum severity to include in report: `"critical"`, `"high"`, `"medium"`, `"low"`, `"info"` |
| `maxFindings` | number | `500` | Stop reporting after this many findings |
| `reportTitle` | string | `"Security Audit"` | Custom title for the report |
| `customPatterns` | array | `[]` | User-defined grep patterns with severity |
| `suppressions` | object | `{}` | Suppression rules |
| `autonomyLevel` | string | `"L3"` | APTS Graduated Autonomy level: `"L1"` (assisted), `"L2"` (supervised), `"L3"` (high), `"L4"` (full). |
| `autonomyLevelOverride` | string\|null | `null` | Per-run override that demotes autonomy (e.g. set `"L2"` to require approval per finding). |
| `stepTimeoutMs` | number | `300000` | Per-step soft timeout; exceeding emits `step.timeout` audit event and halts. |
| `apts` | object | `{ enabled: true, tier: "foundation" }` | APTS compliance declaration. Set `enabled: false` to skip APTS pre-flight and conformance generation. |

## Check Categories

| Key | Default Severity | Description |
|-----|-----------------|-------------|
| `secrets` | critical | Hardcoded API keys, tokens, passwords, private keys, .env files in git |
| `xss` | high | dangerouslySetInnerHTML, eval, innerHTML, document.write |
| `securityHeaders` | medium | Missing CSP, HSTS, X-Frame-Options, etc. |
| `piiExposure` | high | PII in Sentry/logging, missing beforeSend, Replay capturing forms |
| `auth` | high | localStorage tokens, missing route protection, CSRF, cookie flags |
| `dependencies` | high | npm audit vulnerabilities |
| `owasp` | high | OWASP Top 10 patterns (injection, broken access control, etc.) |
| `cors` | medium | Wildcard origins, reflective CORS, credentials misconfiguration |
| `errorHandling` | medium | Stack traces in responses, missing error boundaries |
| `dependencyChain` | medium | Missing lockfile, deprecated packages, supply chain risks |
| `manipulationResistance` | info | Prompt-injection-shaped content in scanned code (APTS D6) |

## Default Exclude Patterns

```json
[
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
  "*.min.js",
  "*.bundle.js",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
]
```

## Custom Patterns

Add your own detection rules:

```json
{
  "customPatterns": [
    {
      "id": "CUSTOM-001",
      "pattern": "my-internal-api\\.example\\.com",
      "fileGlob": "**/*.ts",
      "severity": "high",
      "message": "Internal API URL should not be hardcoded"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique rule ID (prefix with `CUSTOM-`) |
| `pattern` | string | yes | Regex pattern to search for |
| `fileGlob` | string | yes | File glob to limit search scope |
| `severity` | string | yes | `"critical"`, `"high"`, `"medium"`, `"low"` |
| `message` | string | yes | Description shown in findings |

## Suppressions

Suppress known false positives:

```json
{
  "suppressions": {
    "rules": ["SEC-003"],
    "files": ["src/test/**", "**/*.test.*"],
    "findings": ["SEC-001:src/config/api.ts:42"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `rules` | string[] | Rule IDs to suppress globally |
| `files` | string[] | File globs — suppress all findings in matching files |
| `findings` | string[] | Specific `ruleId:file:line` to suppress |

Suppressions can also be added via CLI:
```bash
node <skill-dir>/scripts/cli.mjs suppress SEC-001 src/config/api.ts:42
```

These are stored in `.vulniq/suppressions.json` and merged with config suppressions at scan time.

## Storage Directories

| Path | Purpose |
|-----------|---------|
| `.vulniq/` | Internal state (scan history, suppressions, external audits, APTS audit log) |
| `.vulniq/audits/` | Ingested **external** audit documents (pen-test reports) as structured JSON |
| `.vulniq/audit-log.ndjson` | APTS hash-chained **audit log** (internal event trail, never hand-edited) |
| `.vulniq/HALT` | Kill-switch flag — presence halts any running scan |
| `./reports/` | Generated scan reports (MD + SARIF) and Conformance Claims |

> **Naming note:** Vulniq has two distinct "audit" concepts. **External audits** (`.vulniq/audits/`) are outside documents Vulniq ingests to track remediation. The **audit log** (`.vulniq/audit-log.ndjson`) is Vulniq's own hash-chained event trail required by APTS D5 (Auditability). They are independent.

## Rules of Engagement (APTS D1)

If APTS is enabled (`apts.enabled: true`, the default), Vulniq looks for `vulniq.roe.json` at the project root before scanning. The RoE formalises scope, scan window, operator identity, and asset criticality. See `assets/vulniq.roe.example.json` for a template.

### RoE schema

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | yes | Schema version (currently `"1.0"`) |
| `projectRoot` | string | yes | Path (relative to the RoE file) of the project root; must match CWD at scan time |
| `operator.name` | string | yes | Name of the person authorising the scan |
| `operator.email` | string | recommended | Contact for audit trail |
| `operator.role` | string | recommended | Role (e.g., `"Security Engineer"`) |
| `scanWindow.start` | ISO-8601 string | no | Scans attempted before this timestamp halt |
| `scanWindow.end` | ISO-8601 string | no | Scans attempted after this timestamp halt |
| `allowedPaths` | string[] (globs) | recommended | If provided, only matching files are in scope |
| `forbiddenPaths` | string[] (globs) | no | Files matching these globs are out of scope even if under `allowedPaths` |
| `assetCriticality` | `{glob: tier}` | no | Criticality tier (`"high"`, `"medium"`, `"low"`) per glob; surfaced in reports |
| `notes` | string | no | Free-text authorisation notes preserved in Conformance Claim |

Validate with:
```bash
node <skill-dir>/scripts/cli.mjs roe validate
```

## Audit Ingestion

External audit documents can be ingested to enrich scan results. The CLI provides two commands:

```bash
# Ingest a structured audit (pipe JSON via stdin)
cat audit.json | node <skill-dir>/scripts/cli.mjs ingest-audit "OIM Group Audit"

# List all ingested audits
node <skill-dir>/scripts/cli.mjs list-audits
```

The agent parses raw audit documents into structured JSON before piping to the CLI. Each finding includes:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (e.g., `AUDIT-001`) |
| `title` | string | Short title of the finding |
| `severity` | string | `critical`, `high`, `medium`, `low`, `info` |
| `category` | string | Finding category (e.g., `auth`, `secrets`, `infrastructure`) |
| `description` | string | Full description |
| `location` | string | File/component reference from the audit |
| `fix` | string | Recommended fix |
| `status` | string | `open`, `fixed`, or `not-scanned` |
| `vulniqMapping` | string\|null | Corresponding Vulniq rule ID, or null if outside scan scope |
