# macOS gotchas (Vigil internals)

Vigil delegates the "keep watching" guarantee to **launchd**, not to a long-lived process. Each
tick is a short, pure-Node run. These are the macOS-specific facts that shape the design.

## 1. launchd jobs get a bare environment

A LaunchAgent does **not** inherit your shell's `PATH` or `node`. Vigil therefore:
- captures the absolute node path from `process.execPath` at install time, and
- sets an explicit `PATH` in the plist that includes `/opt/homebrew/bin` (Apple Silicon
  Homebrew) so probe commands like `npm`/`git` resolve.

This is the #1 cause of "works in my terminal, silently fails under launchd."

## 2. Load / unload uses modern `bootstrap` / `bootout`

```bash
UID=$(id -u); LABEL=com.vigil.<slug>; PLIST=~/Library/LaunchAgents/$LABEL.plist
launchctl bootout   gui/$UID/$LABEL    # ignore failure if not loaded
launchctl bootstrap gui/$UID  "$PLIST"
launchctl enable    gui/$UID/$LABEL
launchctl kickstart -k gui/$UID/$LABEL # force an immediate run
```

Always `bootout` before `bootstrap` so re-install is idempotent (legacy `load -w` errors on
double-load). The domain is `gui/$UID` (the GUI session — required for notifications to render).
Inspect with `launchctl print gui/$UID/$LABEL`.

## 3. `StartInterval` does not wake the Mac, and coalesces missed runs

If the Mac sleeps through several intervals, launchd fires the job **once** on wake, not once per
missed interval. Vigil embraces this: every tick compares against the last persisted snapshot, so
a single catch-up run still surfaces "what changed since I last looked."

## 4. Waking the Mac needs `sudo` (and AC power)

To guarantee an overnight run you must schedule a wake — which requires root:

```bash
sudo pmset repeat wake MTWRFSU 03:00:00   # recurring
sudo pmset schedule wake "06/19/2026 03:00:00"   # one-shot
pmset -g sched                            # read schedule (no sudo)
sudo pmset schedule cancelall
```

A clamshell (closed-lid) Mac only wakes on schedule when on **AC power**. **Vigil never runs
`sudo` or `pmset`** — `vigil install` prints the exact command for the operator to paste. Default
behavior without it: watch whenever the Mac is awake.

## 5. `caffeinate` keeps the Mac awake during a probe (no sudo)

Each tick spawns `caffeinate -i -w <tick-pid>`: prevent idle sleep, auto-release when the tick
PID exits (leak-proof even if the tick crashes). Use `-s` instead of `-i` for long probes on AC.

## 6. Notifications need permission and respect Focus/DnD

The "app" that posts a notification under launchd is the script host (terminal-notifier bundle,
or Script Editor/osascript). macOS may silently suppress the first notification until the operator
allows it in **System Settings → Notifications**, and **Focus / Do Not Disturb** swallows banners
entirely. Vigil treats `events.ndjson` as the source of truth and notifications as best-effort.
Run `cli.mjs notify --test` to trigger the permission prompt.

## 7. Task mode: `claude -p` auth under launchd

The `task` probe spawns `claude -p` from the launchd job. The plist sets `HOME` and adds
`~/.local/bin` to `PATH`, so on a normal single-user Mac the judge authenticates with your
existing Claude Code subscription (credentials under `~/.claude`) — **no API key needed** (verified).
If auth ever fails in the bare launchd environment (you'll see an auth error in
`.vigil/tick.log`), use one of these fallbacks by adding it to the plist `EnvironmentVariables`
and re-`install`:

```bash
claude setup-token        # generates a long-lived token → set CLAUDE_CODE_OAUTH_TOKEN
# or
export ANTHROPIC_API_KEY=sk-ant-...   # from the Claude Console
```

Each judge tick is a full headless Claude run — **it costs tokens** (~$0.05–0.15 per check with
`haiku`). Choose the interval consciously; task mode is not free, unlike the no-LLM health mode.

## 8. Full teardown

```bash
node scripts/cli.mjs stop                          # bootout + remove plist
# manual equivalent:
launchctl bootout gui/$(id -u)/com.vigil.<slug>
rm ~/Library/LaunchAgents/com.vigil.<slug>.plist
rm -rf .vigil                                      # discard state/history (optional)
```
