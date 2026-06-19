#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import {
  loadConfig, validateConfig, setProjectDir, severityRank,
  getConfigPath, getProjectDir, getStateDir, getStatePath, getEventsPath,
  getHeartbeatPath, getLockPath, getHaltPath, getLabel, getPlistPath,
} from "./config.mjs";
import { runProbe } from "./probes.mjs";
import { notify as fireNotification, speak, inQuietHours } from "./notify.mjs";
import * as launchd from "./launchd.mjs";

function json(obj) {
  console.log(JSON.stringify(obj));
}

// Pull out --project / --flag args before the switch so every command sees them.
const [, , command, ...rawArgs] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = rawArgs[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
    else flags[key] = true;
  } else positional.push(a);
}
if (flags.project) setProjectDir(flags.project);

function ts() { return new Date().toISOString(); }

function ensureStateDir(config) {
  const dir = getStateDir(config);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function writeHeartbeat(config, data) {
  try {
    ensureStateDir(config);
    fs.writeFileSync(getHeartbeatPath(config), JSON.stringify({ ...data, label: getLabel() }, null, 2));
  } catch {}
}

function appendEvent(config, event) {
  try {
    ensureStateDir(config);
    fs.appendFileSync(getEventsPath(config), JSON.stringify({ ts: ts(), ...event }) + "\n");
  } catch {}
}

// ─── config ────────────────────────────────────────────────────────────────

function cmdConfig() {
  const config = loadConfig();
  json({
    command: "config", status: "ok",
    _configFound: config._configFound,
    configError: config._configError || null,
    projectDir: getProjectDir(),
    stateDir: getStateDir(config),
    config,
  });
}

// ─── init ──────────────────────────────────────────────────────────────────

function cmdInit() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath) && !flags.force) {
    json({ command: "init", status: "error",
      message: "vigil.config.json already exists; pass --force to overwrite", path: configPath });
    process.exit(1);
  }
  let input = "";
  try { input = fs.readFileSync(0, "utf-8").trim(); } catch {}
  let body = {};
  if (input) {
    try { body = JSON.parse(input); }
    catch (e) { json({ command: "init", status: "error", message: `invalid JSON on stdin: ${e.message}` }); process.exit(1); }
  }
  const config = {
    schedule: body.schedule || { intervalMinutes: 30, wakeForRun: false },
    notifications: body.notifications || { enabled: true, sound: "Glass", speak: false, voice: "Samantha", minSeverity: "medium" },
    stateDir: body.stateDir || ".vigil",
    safety: body.safety || { allowReadOnly: true, blockDestructive: true, allowRemoteHttp: false, commandAllowlist: [] },
    ...(body.aiTask ? { aiTask: body.aiTask } : {}),
    probes: body.probes || [],
  };
  // Auto-allowlist the shell commands declared in probes (operator-confirmed in protocol).
  const shellCmds = config.probes.filter((p) => p.type === "shell" && p.command).map((p) => p.command);
  config.safety.commandAllowlist = Array.from(new Set([...(config.safety.commandAllowlist || []), ...shellCmds]));

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  json({ command: "init", status: "ok", path: configPath, created: true, probeCount: config.probes.length });
}

// ─── task (one-command setup for AI completion-judge mode) ────────────────────

function cmdTask() {
  const description = positional.join(" ").trim();
  if (!description) {
    json({ command: "task", status: "error", message: 'Provide a task description, e.g. vigil task "create a DONE.md file"' });
    process.exit(1);
  }
  const configPath = getConfigPath();
  if (fs.existsSync(configPath) && !flags.force) {
    json({ command: "task", status: "error", message: "vigil.config.json already exists; pass --force to replace it with this task watch", path: configPath });
    process.exit(1);
  }
  const intervalMinutes = parseInt(flags.interval, 10) || 15;
  const timeout = Math.min(intervalMinutes * 60000 - 5000, 300000);
  const config = {
    schedule: { intervalMinutes, wakeForRun: false, oneShot: true },
    notifications: { enabled: true, sound: "Glass", speak: !!flags.speak, voice: "Samantha", minSeverity: "low" },
    stateDir: ".vigil",
    safety: { allowReadOnly: true, blockDestructive: true, allowRemoteHttp: false, commandAllowlist: [] },
    aiTask: { claudeBin: "claude", model: flags.model || "haiku", confidenceThreshold: 0.8, allowedTools: ["Read", "Grep", "Glob"] },
    probes: [{ name: "task", type: "task", task: description, severity: "high", timeout }],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const intervalSeconds = Math.max(60, intervalMinutes * 60);
  const r = launchd.install(intervalSeconds);
  json({
    command: "task", status: r.loaded ? "ok" : "error", task: description,
    path: configPath, label: r.label, plistPath: r.plistPath,
    intervalMinutes, model: config.aiTask.model, oneShot: true, loaded: r.loaded, kicked: r.kicked,
    bootstrapError: r.bootstrapError,
    notes: [
      "Vigil now checks completion every " + intervalMinutes + " min via a read-only `claude -p` judge.",
      "An LLM runs each tick (~$0.05–0.15 per check) — this mode is NOT free, unlike health-watchdog mode.",
      "When the task is judged complete, Vigil notifies you and uninstalls itself (one-shot).",
      "Needs `claude` on PATH + working auth under launchd. Run `notify --test` to grant notification permission.",
    ],
  });
  if (!r.loaded) process.exit(1);
}

// ─── install / uninstall ─────────────────────────────────────────────────────

function cmdInstall() {
  const config = loadConfig();
  if (!config._configFound) {
    json({ command: "install", status: "error", message: "No vigil.config.json found. Run `init` first." });
    process.exit(1);
  }
  const errs = validateConfig(config);
  if (errs.length) { json({ command: "install", status: "error", message: "config invalid", errors: errs }); process.exit(1); }

  const intervalSeconds = Math.max(60, Math.round(config.schedule.intervalMinutes * 60));
  if (flags["dry-run"]) {
    json({ command: "install", status: "ok", dryRun: true, label: getLabel(),
      plistPath: getPlistPath(), intervalMinutes: config.schedule.intervalMinutes,
      plistXml: launchd.buildPlist(intervalSeconds),
      commands: [`launchctl bootout ${launchd.domainTarget()}/${getLabel()}`,
        `launchctl bootstrap ${launchd.domainTarget()} ${getPlistPath()}`,
        `launchctl enable ${launchd.domainTarget()}/${getLabel()}`,
        `launchctl kickstart -k ${launchd.domainTarget()}/${getLabel()}`],
      loaded: false });
    return;
  }

  const r = launchd.install(intervalSeconds);
  const notes = ["Notification permission may need approval on first fire — run `notify --test` and click Allow."];
  if (!config.schedule.wakeForRun) {
    notes.push("wakeForRun=false: probes run on the next interval after the Mac wakes, not during sleep. To guarantee overnight runs, run (needs sudo + AC power): sudo pmset repeat wake MTWRFSU 03:00:00");
  }
  json({ command: "install", status: r.loaded ? "ok" : "error", label: r.label, plistPath: r.plistPath,
    intervalMinutes: config.schedule.intervalMinutes, wakeForRun: config.schedule.wakeForRun,
    loaded: r.loaded, kicked: r.kicked, bootstrapError: r.bootstrapError, notes });
  if (!r.loaded) process.exit(1);
}

function cmdUninstall(name) {
  const r = launchd.uninstall({ keepPlist: !!flags["keep-plist"] });
  json({ command: name, status: "ok", label: r.label, unloaded: r.unloaded, plistRemoved: r.plistRemoved, stateKept: true });
}

// ─── status ──────────────────────────────────────────────────────────────────

function cmdStatus() {
  const config = loadConfig();
  const job = launchd.jobStatus();
  const hb = readJSON(getHeartbeatPath(config), null);
  const state = readJSON(getStatePath(config), null);
  const intervalSec = config.schedule.intervalMinutes * 60;
  let lastRunAgo = null, stale = false, nextApprox = null;
  if (hb && hb.startedAt) {
    lastRunAgo = Math.round((Date.now() - new Date(hb.startedAt).getTime()) / 1000);
    stale = lastRunAgo > intervalSec * 2;
    nextApprox = new Date(new Date(hb.startedAt).getTime() + intervalSec * 1000).toISOString();
  }
  const failing = state && state.probes
    ? Object.entries(state.probes).filter(([, p]) => p.status === "fail" || p.status === "error")
        .map(([k, p]) => ({ name: k, type: p.type, severity: p.severity, status: p.status, summary: p.summary })) : [];
  const counts = state && state.probes
    ? Object.values(state.probes).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {}) : {};

  json({
    command: "status", status: "ok",
    watching: job.loaded, launchdLoaded: job.loaded, label: getLabel(),
    configFound: config._configFound, halted: fs.existsSync(getHaltPath(config)),
    intervalMinutes: config.schedule.intervalMinutes,
    lastRun: hb?.startedAt || null, lastRunAgoSeconds: lastRunAgo, nextRunApprox: nextApprox,
    heartbeatStale: stale, lastReason: hb?.reason || null,
    probeCounts: counts, failingProbes: failing, stateDir: getStateDir(config),
  });
}

// ─── tick (the deterministic loop body launchd calls) ─────────────────────────

function acquireLock(config) {
  const lockPath = getLockPath(config);
  const existing = readJSON(lockPath, null);
  if (existing && existing.pid) {
    let alive = false;
    try { process.kill(existing.pid, 0); alive = true; } catch {}
    const age = Date.now() - new Date(existing.startedAt || 0).getTime();
    if (alive && age < (config.schedule.intervalMinutes * 60000 * 2)) return false; // live tick running
  }
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: ts() }));
  return true;
}

function releaseLock(config) {
  try { fs.rmSync(getLockPath(config)); } catch {}
}

async function cmdTick() {
  const config = loadConfig();
  const noNotify = !!flags["no-notify"];

  if (config._configError) {
    writeHeartbeat(config, { startedAt: ts(), finishedAt: ts(), reason: "config-error", error: config._configError });
    json({ command: "tick", status: "error", reason: "config-error", message: config._configError });
    process.exit(0); // never crash-loop launchd
  }
  ensureStateDir(config);
  if (fs.existsSync(getHaltPath(config))) {
    writeHeartbeat(config, { startedAt: ts(), finishedAt: ts(), reason: "halted" });
    json({ command: "tick", status: "ok", reason: "halted", ran: false });
    return;
  }
  if (!acquireLock(config)) {
    writeHeartbeat(config, { startedAt: ts(), finishedAt: ts(), reason: "overlap-skip" });
    json({ command: "tick", status: "ok", reason: "overlap-skip", ran: false });
    return;
  }

  // Keep the Mac awake for the run; -w $$ self-releases even if we crash.
  let caf = null;
  try { caf = spawn("caffeinate", ["-i", "-w", String(process.pid)], { detached: true, stdio: "ignore" }); caf.unref(); } catch {}

  const startedAt = ts();
  writeHeartbeat(config, { startedAt, pid: process.pid, reason: "running" });

  try {
    const cwd = getProjectDir();
    const prev = readJSON(getStatePath(config), { probes: {} });
    const onlyProbe = flags.probe || positional[0];
    const probes = config.probes.filter((p) => p.enabled && (!onlyProbe || p.name === onlyProbe));

    const results = {};
    for (const probe of probes) {
      results[probe.name] = await runProbe(probe, config, cwd);
    }

    const projectName = path.basename(getProjectDir());
    const isTaskProbe = (name) => config.probes.find((p) => p.name === name)?.type === "task";

    // Health-probe transitions: notify when a (non-task) probe's status flips.
    const transitions = [];
    for (const [name, res] of Object.entries(results)) {
      if (isTaskProbe(name)) continue; // task completion is handled separately below
      const before = prev.probes?.[name]?.status || "unknown";
      const after = res.status;
      if (before !== after && before !== "unknown" && after !== "skipped") {
        transitions.push({ name, before, after, severity: res.severity, summary: res.summary });
      }
    }

    // Task completion: fire once when all task probes first become "done" (incl. first tick).
    const taskProbes = probes.filter((p) => p.type === "task");
    const prevTaskDone = taskProbes.length > 0 && taskProbes.every((p) => prev.probes?.[p.name]?.status === "ok");
    const tasksDone = taskProbes.length > 0 && taskProbes.every((p) => results[p.name]?.status === "ok");
    const taskJustCompleted = tasksDone && !prevTaskDone;

    const notifications = [];
    const fire = (subtitle, message, sayText) => {
      const n = fireNotification({ title: `Vigil: ${projectName}`, subtitle, message, sound: config.notifications.sound, group: getLabel() });
      let spoke = false;
      if (config.notifications.speak && !inQuietHours(config.notifications.quietHours)) {
        ({ spoke } = speak({ text: sayText, voice: config.notifications.voice, rate: config.notifications.rate }));
      }
      notifications.push({ subtitle, backend: n.backend, delivered: n.delivered, spoke });
    };

    if (!noNotify && config.notifications.enabled) {
      const minRank = severityRank(config.notifications.minSeverity);
      for (const t of transitions) {
        if (severityRank(t.severity) < minRank) continue;
        const broke = t.after === "fail";
        fire(broke ? `${t.name} broke` : `${t.name} recovered`, t.summary,
          `Vigil. ${t.name} ${broke ? "broke" : "recovered"} on ${projectName}.`);
      }
      if (taskJustCompleted) {
        const reasoning = results[taskProbes[0].name]?.reasoning || "";
        fire("✅ Task done", reasoning || "The task is now complete.", `Vigil. Task done on ${projectName}.`);
      }
    }

    // Persist new snapshot + log.
    const snapshot = { updatedAt: ts(), probes: results, lastTransitions: transitions };
    ensureStateDir(config);
    fs.writeFileSync(getStatePath(config), JSON.stringify(snapshot, null, 2));
    const summary = Object.values(results).reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
    appendEvent(config, taskJustCompleted
      ? { type: "completed", tasks: taskProbes.map((p) => p.name), summary }
      : transitions.length ? { type: "transition", transitions, summary } : { type: "steady", summary });

    // One-shot: when the task(s) are done, notify (above) then uninstall ourselves.
    const oneShotDone = taskJustCompleted && config.schedule.oneShot;
    writeHeartbeat(config, { startedAt, finishedAt: ts(), reason: oneShotDone ? "completed" : "ok", changed: transitions.length });

    json({ command: "tick", status: "ok", ranAt: startedAt, ran: true,
      results: Object.values(results), summary,
      changed: transitions.map((t) => t.name), taskCompleted: taskJustCompleted,
      notified: notifications.length > 0, notifications, oneShotUninstalled: oneShotDone });

    if (oneShotDone) {
      // Everything is persisted and printed; safe to remove the agent (bootout may SIGTERM us).
      releaseLock(config);
      try { caf && caf.kill(); } catch {}
      launchd.uninstall();
      return;
    }
  } catch (e) {
    writeHeartbeat(config, { startedAt, finishedAt: ts(), reason: "error", error: e.message });
    json({ command: "tick", status: "error", message: e.message });
  } finally {
    releaseLock(config);
    try { caf && caf.kill(); } catch {}
  }
}

// ─── probe (ad hoc, no snapshot, no notify) ────────────────────────────────────

async function cmdProbe() {
  const config = loadConfig();
  const name = positional[0];
  if (!name) { json({ command: "probe", status: "error", message: "probe name required" }); process.exit(1); }
  const probe = config.probes.find((p) => p.name === name);
  if (!probe) { json({ command: "probe", status: "error", message: `no probe named "${name}"` }); process.exit(1); }
  const result = await runProbe(probe, config, getProjectDir(), { withTail: true });
  json({ command: "probe", status: "ok", name, result });
}

// ─── history ───────────────────────────────────────────────────────────────────

function cmdHistory() {
  const config = loadConfig();
  const limit = parseInt(flags.limit, 10) || 20;
  const eventsPath = getEventsPath(config);
  if (!fs.existsSync(eventsPath)) { json({ command: "history", status: "ok", count: 0, entries: [] }); return; }
  const lines = fs.readFileSync(eventsPath, "utf-8").trim().split("\n").filter(Boolean);
  const entries = lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  json({ command: "history", status: "ok", count: entries.length, entries });
}

// ─── notify (test) ──────────────────────────────────────────────────────────────

function cmdNotify() {
  const config = loadConfig();
  const message = flags.message || "Vigil is now watching this project.";
  const n = fireNotification({ title: `Vigil: ${path.basename(getProjectDir())}`,
    subtitle: "Test notification", message, sound: config.notifications.sound, group: getLabel() });
  let spoke = false;
  if (flags.speak) ({ spoke } = speak({ text: message, voice: config.notifications.voice, rate: config.notifications.rate }));
  json({ command: "notify", status: "ok", delivered: n.delivered, backend: n.backend, spoke, message,
    note: "If no banner appeared, grant notification permission for the terminal/Script Editor in System Settings > Notifications, or for terminal-notifier." });
}

// ─── halt / resume ────────────────────────────────────────────────────────────

function cmdHalt() {
  const config = loadConfig();
  ensureStateDir(config);
  fs.writeFileSync(getHaltPath(config), ts());
  json({ command: "halt", status: "ok", halted: true, message: "Ticks will no-op until `resume`. The launchd agent stays loaded." });
}

function cmdResume() {
  const config = loadConfig();
  const p = getHaltPath(config);
  const existed = fs.existsSync(p);
  if (existed) fs.rmSync(p);
  json({ command: "resume", status: "ok", halted: false, wasHalted: existed });
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  switch (command) {
    case "config": cmdConfig(); break;
    case "init": cmdInit(); break;
    case "task": cmdTask(); break;
    case "install": cmdInstall(); break;
    case "uninstall": cmdUninstall("uninstall"); break;
    case "stop": cmdUninstall("stop"); break;
    case "status": cmdStatus(); break;
    case "tick": case "run-once": await cmdTick(); break;
    case "probe": await cmdProbe(); break;
    case "history": cmdHistory(); break;
    case "notify": cmdNotify(); break;
    case "halt": cmdHalt(); break;
    case "resume": cmdResume(); break;
    default:
      json({ command: command || "none", status: "error",
        message: `Unknown command: ${command}. Available: config, init, task, install, status, tick, run-once, probe, history, notify, halt, resume, stop, uninstall` });
      process.exit(1);
  }
})();
