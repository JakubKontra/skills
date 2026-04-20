# Vulniq Governance Gate (GitHub Action)

A composite GitHub Action that runs the **Vulniq governance gate** in CI and, optionally, uploads a pre-produced SARIF file to GitHub Code Scanning.

## What this action does

This action **is not a security scanner**. The actual Vulniq scan is performed by Claude Code, which interactively drives `Grep` + `Read` loops against your codebase under the Rules of Engagement (RoE). That cannot run headless in a GitHub runner.

What the action *does* do on every invocation:

1. Validates your `vulniq.roe.json` (Rules of Engagement) and records a `scope.hash.recorded` event to the audit log.
2. Verifies the hash-chained audit log (`audit-verify`). If broken, the action fails by default — this is the tamper-evidence guarantee.
3. Generates the APTS Conformance Claim (`conformance`) and appends it to the job's step summary.
4. *Optionally,* if you pass `sarif-path`, uploads that SARIF file to GitHub Code Scanning via `github/codeql-action/upload-sarif@v3`.

If you want findings to show up in the Code Scanning tab, you need to run the Vulniq scan via Claude Code separately, then feed the resulting `.sarif.json` file into this action.

## Inputs

| Name                    | Required | Default               | Description                                                                                              |
| ----------------------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `config-path`           | no       | `vulniq.config.json`  | Path to `vulniq.config.json`. The CLI walks up from the working directory to find it.                    |
| `roe-path`              | no       | `vulniq.roe.json`     | Path to the Rules of Engagement file.                                                                    |
| `sarif-path`            | no       | (empty)               | Path to a pre-produced SARIF file. When set, the action uploads it to Code Scanning.                     |
| `fail-on-broken-chain`  | no       | `true`                | Fail the action if `audit-verify` reports the hash chain is broken.                                      |
| `upload-sarif`          | no       | `true`                | Whether to upload SARIF when `sarif-path` is provided. Set to `false` to skip upload even when provided. |
| `category`              | no       | `vulniq`              | Code Scanning category passed to `upload-sarif`.                                                         |

## Requirements

- Node.js 18+ on the runner. Install it with `actions/setup-node@v4` before invoking this action — this action will not install Node for you.
- `jq` — pre-installed on all GitHub-hosted runners.
- The Vulniq skill checked out at `vulniq/` in the same checkout as this action (the action resolves the CLI via `$GITHUB_ACTION_PATH/../../scripts/cli.mjs`).
- `permissions: security-events: write` on the job if you are uploading SARIF.

## Examples

### (a) Governance-only (no SARIF)

```yaml
jobs:
  vulniq-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: ./vulniq/actions/vulniq
        with:
          roe-path: vulniq.roe.json
```

### (b) Upload SARIF produced by a prior Vulniq run

```yaml
jobs:
  vulniq-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Option: pull the SARIF from an artifact produced by a separate
      # Claude-Code-driven scan job, or commit it to the repo under reports/.
      - uses: actions/download-artifact@v4
        with:
          name: vulniq-sarif
          path: reports/

      - uses: ./vulniq/actions/vulniq
        with:
          roe-path: vulniq.roe.json
          sarif-path: reports/latest.sarif.json
          category: vulniq
```

## Obtaining a SARIF file to upload

1. From a workstation with Claude Code configured, open the Vulniq skill and run a scan under RoE.
2. After findings are triaged, Vulniq emits a SARIF document that you pipe into its CLI:

   ```bash
   cat findings.sarif.json | node vulniq/scripts/cli.mjs save-sarif "ci-scan"
   ```

3. This writes `./reports/<timestamp>-ci-scan.sarif.json`. Copy that file to a location your CI job can access:
   - commit it under `reports/` (simplest),
   - publish it as a GitHub Actions artifact from a separate job, or
   - store it in an object bucket and fetch in CI.
4. Wire the resulting path into the `sarif-path` input.

## SBOM hygiene (APTS-TP-006)

This action ships **zero npm dependencies**. It only uses:

- **Node** (caller-provided via `actions/setup-node`),
- **`jq`** (pre-installed on GitHub-hosted runners for JSON parsing), and
- **`github/codeql-action/upload-sarif@v3`** (external, only used when uploading SARIF).

No `npm install`, no `package.json` inside the action directory, no `node_modules` checked in. The Vulniq CLI itself is pure Node standard library. The third-party surface is limited to GitHub's first-party CodeQL SARIF uploader.

### Self-test

This repo dogfoods the action: every push to `main` or a `feat/**` branch (and every pull request) runs the Vulniq governance-gate action against the skills monorepo itself. The workflow also runs the Vulniq unit test suite and validates the shipped JSON Schemas against their example documents, so any drift in `vulniq/schemas/**` or `vulniq/assets/**` fails CI before the action is invoked.

See [`.github/workflows/vulniq-example.yml`](../../../.github/workflows/vulniq-example.yml) for the full definition. The two jobs (`test` and `governance-gate`) run in parallel on the same triggers.

## Troubleshooting

- **"Vulniq CLI not found at ..."** — ensure the skills repo (containing `vulniq/scripts/cli.mjs`) is checked out at the same commit. If you are consuming Vulniq as a submodule or subtree, adjust your checkout accordingly.
- **"Audit log hash chain is broken"** — someone (or an errant process) modified or truncated `.vulniq/audit.jsonl`. Investigate before releasing. If you genuinely need CI to continue, set `fail-on-broken-chain: 'false'`, but treat the chain break as a security incident.
- **RoE validation returns `warn`** — the run continues and a `::notice::` is emitted. Inspect the job log for the warning message.
