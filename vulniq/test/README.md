# Vulniq test suite

Unit and integration tests for the Vulniq skill. **Zero external
dependencies** — only the Node.js standard library, in keeping with Vulniq's
stdlib-only SBOM claim (APTS-TP-006).

## Running

From the repository root (shell-glob expansion; works on macOS/Linux):

```sh
node --test vulniq/test/*.test.mjs
```

From inside `vulniq/` (auto-discovery picks up `test/*.test.mjs`):

```sh
cd vulniq
node --test
```

After Track 1 publishes `package.json`, `npm test` will also work from
`vulniq/`.

Requires Node.js 20+ (uses the built-in `node:test` runner).

## Files

| File | Target | Style |
|------|--------|-------|
| `audit-log.test.mjs` | `scripts/audit-log.mjs` — sha256, appendEntry, verifyChain, tamper detection | Unit, in-process |
| `roe.test.mjs` | `scripts/roe.mjs` — loadRoE, validateRoE, validateScanWindow, isInScope, getAssetCriticality | Unit, in-process |
| `conformance.test.mjs` | `scripts/conformance.mjs` — buildConformanceClaim, renderConformanceMarkdown, writeConformance | Unit, in-process |
| `cli.test.mjs` | `scripts/cli.mjs` end-to-end | Integration — spawns the CLI as a subprocess via `node:child_process` |

## Design

Vulniq's path helpers (`getProjectDir`, `getAuditLogPath`, etc.) walk up from
`process.cwd()` looking for `vulniq.config.json`. Every test therefore:

1. Creates a fresh temp dir via `fs.mkdtempSync(path.join(os.tmpdir(),
   "vulniq-test-"))`.
2. Writes a `vulniq.config.json` there so path helpers anchor inside the
   temp dir.
3. Either `process.chdir()`s in (for in-process tests) or spawns the CLI
   with `cwd: tempDir` (integration).
4. Removes the temp dir in `after()` / `afterEach()` — even on failure —
   with `fs.rmSync(dir, { recursive: true, force: true })`.

No test depends on state produced by another; tests may run in any order.

## Dependencies

Only Node.js built-ins: `node:test`, `node:assert/strict`, `node:fs`,
`node:path`, `node:os`, `node:child_process`, `node:url`.

## Adding a new test

1. If you're touching logic in `scripts/<module>.mjs`, add the test to
   `test/<module>.test.mjs` alongside the existing cases.
2. For new CLI subcommands, add an integration case to `cli.test.mjs`
   using the existing `run()` helper.
3. Always create your own temp dir per test (or per `beforeEach`); never
   write to the repo working tree.
4. Re-run `node --test vulniq/test/` and verify `ls /tmp/vulniq-test-*`
   is empty after the run.
