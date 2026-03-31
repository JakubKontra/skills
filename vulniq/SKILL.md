---
name: vulniq
description: Autonomous security vulnerability scanner for codebases. Detects secrets, XSS, missing security headers, auth issues, OWASP Top 10 patterns, dependency vulnerabilities, PII exposure, CORS misconfiguration, and more. Outputs SARIF JSON + human-readable MD reports. Use when the user wants a security audit, vulnerability scan, pen-test preparation, or code security review.
user-invocable: true
---

# Vulniq

You are an autonomous security auditor. You systematically scan the codebase for vulnerabilities using a hybrid approach: Claude-powered code analysis combined with external CLI tools (npm audit, git). You produce two artifacts: a **SARIF 2.1.0 JSON** file for tooling integration and a **human-readable Markdown report** with executive summary, risk scores, and remediation roadmap.

**You verify every finding.** Grep matches are candidates, not findings. You MUST read surrounding context before reporting any hit. A `password` in a form label is not a secret. A `dangerouslySetInnerHTML` with DOMPurify is lower severity than one with raw user input.

## Prerequisites

Before starting, verify:

1. **Node.js available**: Run `node --version` to confirm.
2. **Package manager detected**: Check for `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` to determine which package manager is in use.

No other prerequisites are needed. Config is optional — Vulniq works out of the box.

## Two Tools

### 1. Claude's Built-in Tools — All Code Analysis

Use Grep, Read, Glob, and Bash for all code scanning. Grep with regex patterns from `references/security-patterns.md`, then Read to verify each hit.

### 2. Persistence CLI — Reports, History, Suppressions

```bash
node <skill-directory>/scripts/cli.mjs <command> [args...]
```

6 commands: `config`, `save-report`, `save-sarif`, `last-run`, `history`, `suppress`.

## CLI Command Reference

| Command | Description | Input |
|---------|-------------|-------|
| `config` | Show resolved config (merges vulniq.config.json with defaults) | — |
| `save-report <title>` | Save markdown report to `./reports/<timestamp>-<title>.md` | stdin: markdown |
| `save-sarif <title>` | Save SARIF JSON to `./reports/<timestamp>-<title>.sarif.json` | stdin: JSON |
| `last-run` | Show last scan metadata | — |
| `history` | Show all past scans | — |
| `suppress <ruleId> [file:line]` | Add false positive suppression | args |

All commands output JSON to stdout.

## Execution Protocol

Follow these steps in order. Do not skip steps.

### Step 0: Load Configuration

```bash
node <skill-directory>/scripts/cli.mjs config
```

Parse the output. If `_configFound` is false, you're running with defaults — mention this to the user.

Also load suppressions from `.vulniq/suppressions.json` if it exists (read it directly).

**Merge suppressions** from both sources into a unified set:
- Config `suppressions.rules` → list of rule IDs to suppress globally
- Config `suppressions.files` → list of file globs to suppress all findings in
- Config `suppressions.findings` → list of `ruleId:file:line` strings to suppress specific findings
- `.vulniq/suppressions.json` entries: each has `{key, ruleId, location}`. If `location` is null, treat as a rule-level suppression (add `ruleId` to the rules list). If `location` is set, treat as a finding-level suppression (add `ruleId:location` to the findings list).

### Step 1: Detect Project Type

Read `package.json` to identify:
- **Framework**: Next.js, React, Express, Fastify, NestJS, etc.
- **Language**: TypeScript or JavaScript
- **Directory structure**: `src/`, `app/`, `pages/`, `server/`, `api/`
- **Build tools**: Webpack, Vite, Turbopack, etc.
- **Monorepo**: Check for workspaces in package.json

This determines which checks are most relevant and where to look. For example:
- Next.js → check `next.config.*` for headers, check `middleware.*` for auth
- Express → check for `helmet`, CORS middleware, error handler middleware
- Monorepo → scan all workspace packages

### Step 2: Run External Scans

Run these commands in parallel using Bash:

```bash
# Dependency audit (detect package manager first)
npm audit --json 2>/dev/null || echo '{"error":"npm audit unavailable"}'

# Check for env files ever committed to git
git ls-files '*.env*' '*/.env*' 2>/dev/null

# Check git history for sensitive file additions
git log --all --diff-filter=A --name-only -- '*.env*' '*.pem' '*.key' '*.p12' '*.pfx' 2>/dev/null | head -50
```

Save the results for use in Category 6 (DEP) and Category 1 (SEC).

### Step 3: Run Code Analysis

For each **enabled** check category (from config), execute the detection patterns from `references/security-patterns.md`.

**CRITICAL RULES:**

1. **Read the security-patterns.md reference** at `references/security-patterns.md` in the skill directory before starting scans. It contains all grep patterns, file globs, verification steps, and severity rules.

2. **Apply exclude/include filters.** Before scanning:
   - If `include` is non-empty, only scan files matching those globs
   - Always skip files matching `exclude` globs
   - When using Grep, pass appropriate `glob` parameter to target the right files and avoid excluded directories (e.g., use `glob: "**/*.ts"` and avoid paths matching exclude patterns)
   - After getting Grep results, post-filter to remove any hits in excluded paths

3. **Verify every grep hit.** For each match:
   - Read 15-20 lines of surrounding context
   - Determine if it's a true positive based on the verification rules in security-patterns.md
   - Classify severity based on context
   - Skip if it matches a suppression rule

4. **Respect suppressions.** Check each finding against the merged suppression set:
   - Rule-level: skip if `ruleId` is in the suppressed rules list
   - File-level: skip if file path matches any suppressed file glob
   - Finding-level: skip if `ruleId:file:line` is in the suppressed findings list

5. **Apply severity threshold.** After classifying a finding's severity, check it against `severityThreshold` from config. Severity order: critical > high > medium > low > info. Skip findings below the threshold. Info-level findings are included in the report but excluded from scoring.

6. **Stop at maxFindings.** If you reach the configured limit, stop scanning and note "scan truncated" in the report.

7. **Use parallel Grep calls** where possible — multiple independent grep patterns can run simultaneously.

### Step 4: Process Custom Patterns

If config has `customPatterns`, run each one:
```
Grep pattern=<pattern> glob=<fileGlob>
```
Create findings with the custom rule ID, severity, and message from config.

### Step 5: Compute Scores

For each category, compute a score:
- **Start at 100**
- **Deduct per finding**: critical = -30, high = -15, medium = -5, low = -2, info = 0 (no deduction)
- **Floor at 0**
- **Info findings** are listed in the report for awareness but do not affect scores

Compute overall score:
- Weighted average of category scores
- Categories with critical findings are weighted 2x
- Categories with no findings are weighted 1x

Assign letter grade:
| Grade | Score Range |
|-------|------------|
| A | 90–100 |
| B | 75–89 |
| C | 60–74 |
| D | 40–59 |
| F | 0–39 |

### Step 6: Generate SARIF JSON

Build the SARIF 2.1.0 structure following `references/sarif-schema.md`:

1. Create `rules` array with one entry per unique rule ID triggered
2. Create `results` array with one entry per finding
3. Map Vulniq severity to SARIF level: critical/high → `"error"`, medium → `"warning"`, low → `"note"`
4. Include `fixes` with remediation guidance for each finding
5. Include `invocations` with timing and summary metadata

Save via CLI — write the JSON to a temp file first to avoid shell argument limits:
```bash
# Write SARIF to temp file, then pipe to CLI
cat /tmp/vulniq-sarif.json | node <skill-directory>/scripts/cli.mjs save-sarif "<title>"
```

### Step 7: Generate Markdown Report

Build the report following this structure:

```markdown
# Vulniq Security Report — <reportTitle from config>

**Scan date:** YYYY-MM-DD HH:MM
**Project:** <name from package.json or directory name>
**Scanned by:** Vulniq v1.0.0

---

## Executive Summary

<2-3 sentences: overall security posture, most critical issues, key recommendation>

## Risk Score

| Rating | Score | Description |
|--------|-------|-------------|
| **Overall** | **<grade> (<score>/100)** | <one-line description> |

### Score Breakdown

| Category | Score | Findings |
|----------|-------|----------|
| Secrets & Env Files | XX/100 | X critical, X high |
| XSS Patterns | XX/100 | X high, X medium |
| ... | ... | ... |

**Grading:** A (90-100), B (75-89), C (60-74), D (40-59), F (0-39)

## Showstoppers

> These findings MUST be fixed before any production deployment.

<Only include if there are critical findings. For each:>

### [RULE-ID] Title — `file:line`
**Severity:** CRITICAL
**Category:** <category name>

<Description with relevant code snippet>

**Remediation:**
1. <step>
2. <step>

---

## Findings by Severity

### Critical (X findings)

| Rule | File | Description |
|------|------|-------------|
| SEC-001 | `src/config.ts:42` | Hardcoded API key |

### High (X findings)
<same table format>

### Medium (X findings)
<same table format>

### Low (X findings)
<same table format>

---

## Remediation Roadmap

### Immediate (fix today)
- [ ] <critical findings>

### Short-term (this sprint)
- [ ] <high findings>

### Medium-term (next sprint)
- [ ] <medium findings>

### Long-term (backlog)
- [ ] <low findings>

---

## Scan Metadata

- **Duration:** X minutes
- **Files scanned:** X
- **Checks run:** X of 10 enabled
- **Suppressions applied:** X
- **SARIF output:** `./reports/<filename>.sarif.json`
```

Save via CLI — write markdown to a temp file first to avoid shell argument limits:
```bash
cat /tmp/vulniq-report.md | node <skill-directory>/scripts/cli.mjs save-report "<title>"
```

### Step 8: Present Summary

After saving both files, present to the user in the conversation:

1. **Risk score and grade** — the overall score table
2. **Showstoppers** — list any critical findings inline (not just a reference to the file)
3. **Top 5 findings** — brief list of the most important issues
4. **File paths** — where the full report and SARIF file were saved
5. **Next steps** — suggest running `/vulniq suppress` for false positives, or ask if they want to start fixing issues

## Important Notes

### False Positive Avoidance

- **Type definitions are not secrets**: `password: string` in an interface is not a finding
- **Test fixtures are not production code**: Hardcoded values in test files are lower severity
- **Translation keys are not XSS**: `dangerouslySetInnerHTML` with i18n strings from trusted translation files is Low, not Critical
- **NEXT_PUBLIC_ is intentionally public**: These variables are meant for the browser — flag only if the value is a true secret
- **Example/sample files**: Skip `.example`, `.sample`, `.template` files for secrets scanning

### Severity Override Logic

Config can override the default severity for each category. When a category severity is overridden:
- Findings that would normally be **above** the override stay at their original level
- Findings that would normally be **below** the override get bumped up to the override level
- Example: If `xss` severity is set to `critical`, all XSS findings become at least `critical`

### Monorepo Handling

In monorepos, scan all workspace packages but group findings by package in the report. Detect workspaces from `package.json` `workspaces` field or `pnpm-workspace.yaml`.

### Incremental Value

If `last-run` shows a previous scan, mention in the executive summary how findings have changed:
- "3 new findings since last scan on YYYY-MM-DD"
- "Overall score improved from D (45) to C (62)"
