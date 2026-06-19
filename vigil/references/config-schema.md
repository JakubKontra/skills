# Vigil config schema (`vigil.config.json`)

Lives in the project root. All fields are optional — a missing file resolves to the defaults
below, so `config` and `status` work before `init`. Created/overwritten by
`cli.mjs init` (stdin JSON, `--force` to overwrite).

```jsonc
{
  "schedule": {
    "intervalMinutes": 30,    // how often launchd runs a tick (min 1; floored to 60s)
    "wakeForRun": false,      // informational; Vigil never runs sudo/pmset itself
    "oneShot": false          // task mode: uninstall the agent once all task probes are "done"
  },
  "notifications": {
    "enabled": true,
    "sound": "Glass",         // from the macOS sound allowlist (Basso, Funk, Glass, Ping, ...)
    "speak": false,           // spoken summary via `say` (default off)
    "voice": "Samantha",
    "rate": 180,              // optional words-per-minute for `say`
    "minSeverity": "medium",  // only transitions >= this severity notify (low|medium|high)
    "quietHours": { "start": "22:00", "end": "08:00" }  // suppress speech in this window
  },
  "stateDir": ".vigil",       // where state/events/heartbeat live (relative to project)
  "safety": {
    "allowReadOnly": true,
    "blockDestructive": true, // reject even allowlisted commands matching the denylist
    "allowRemoteHttp": false, // http probes are localhost-only unless this is true
    "commandAllowlist": []    // exact-match commands a `shell` probe may run
  },
  "aiTask": {                 // used ONLY by `task` probes (the AI completion judge)
    "claudeBin": "claude",    // binary spawned headless for the judgment
    "model": "haiku",         // model alias passed to `claude --model`
    "confidenceThreshold": 0.8, // done only if verdict.confidence >= this
    "allowedTools": ["Read", "Grep", "Glob"] // read-only tools the judge may use
  },
  "probes": [ /* see below */ ]
}
```

## Probe types

Every probe has: `name` (unique), `type`, `severity` (`low`|`medium`|`high`, default `medium`),
`timeout` (ms, default 60000, must be ≤ the interval), `enabled` (default `true`).

| Type | Required | Optional | "ok" when |
|------|----------|----------|-----------|
| `shell` | `command` | `expectExitCode` (default 0) | exit code matches **and** command is exact-match allowlisted **and** not destructive |
| `http` | `url` | `expectStatus` (default 200) | response status matches; host must be localhost unless `allowRemoteHttp` |
| `git` | — | `warnBehind` (default 10), `warnDirty` (default true) | not dirty (if `warnDirty`) and `< warnBehind` commits behind upstream |
| `disk` | `threshold` (e.g. `"10GB"`) | `path` (default project dir) | free space ≥ threshold |
| `task` | `task` (plain-language description) | uses `aiTask` block | a read-only `claude -p` judge returns `done:true` with `confidence ≥ threshold` |

### `task` probes — AI completion judge

A `task` probe spawns Claude Code headless (`claude -p --output-format json --json-schema …
--permission-mode dontAsk --allowedTools Read,Grep,Glob`) to inspect the repo and return
`{done, confidence, reasoning}`. This is the only probe type with an **LLM in the loop** — it
costs tokens (~$0.05–0.15 per tick) and needs `claude` on PATH with working auth (see
`macos-gotchas.md`). It is read-only: the judge gets only Read/Grep/Glob and never edits.
Pair with `schedule.oneShot: true` so Vigil uninstalls itself once the task is judged done.

### Safety contract (code-enforced)

- `shell` probes spawn with `{ shell: false }` and an argv array — no shell, no metacharacter
  evaluation. A command not in `safety.commandAllowlist` (exact trimmed match) is **skipped**
  (`status: "skipped"`), never run.
- With `blockDestructive: true`, an allowlisted command is still rejected if it matches the
  denylist (`rm`, `git push`, `git commit`, `git reset`, `sudo`, `npm publish`, `deploy`,
  `kill`, `mv`, `chmod`, output redirection `>`, mutating HTTP verbs, …).
- `http` probes issue GET only and are restricted to localhost unless `allowRemoteHttp` is set.
- Writes only ever happen inside `stateDir` and the single launchd plist.
- Vigil never runs `sudo` or `pmset`; `wakeForRun` is purely advisory.
