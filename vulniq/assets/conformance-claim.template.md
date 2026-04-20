# APTS Conformance Claim Template

> This file is a reference for the structure of conformance claims produced by `node scripts/cli.mjs conformance`. The generator populates the sections automatically from live state; this document exists so operators can review the shape before running.

---

## 1. Platform identification
- Name: Vulniq
- Version: <semver>
- Autonomy Level: L1 / L2 / **L3** / L4 (selected)

## 2. Foundation Model disclosure
- Provider: Anthropic
- Product: Claude Code
- Model: <session-provided>

## 3. Operator and scope
- Operator: <from vulniq.roe.json>
- Role: <role>
- Project root: <absolute path>
- Allowed paths: <globs>
- Forbidden paths: <globs>
- Scan window: <ISO start> → <ISO end>

## 4. Posture
- Read-only: yes
- CIA impact: C=LOW, I=LOW, A=LOW
- Action allowlist: `Grep`, `Read`, `Glob`, `Bash(npm audit)`, `Bash(git ls-files)`, `Bash(git log)`, `Bash(git status)`, `Bash(node <skill>/scripts/cli.mjs)`

## 5. Audit trail integrity
- Entries: <N>
- Chain status: **ok** / **broken**

## 6. Last scan
- Date: <ts>
- Title: <title>
- Grade: <letter> (<score>/100)
- Findings: X critical · Y high · Z medium · W low

## 7. Requirement coverage (Foundation tier)

Tally table across all 8 domains, then per-domain requirement lists with `met` / `partial` / `not-applicable` / `not-met` status and evidence pointers.

## 8. Attribution
OWASP APTS (CC BY-SA 4.0) — https://github.com/OWASP/APTS
