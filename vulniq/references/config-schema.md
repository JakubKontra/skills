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

| Directory | Purpose |
|-----------|---------|
| `.vulniq/` | Internal state (scan history, suppressions, audits) |
| `.vulniq/audits/` | Ingested external audit documents as structured JSON |
| `./reports/` | Generated scan reports (MD + SARIF) |

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
