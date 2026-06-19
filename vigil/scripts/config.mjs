import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const CONFIG_FILENAME = "vigil.config.json";

const DEFAULTS = {
  schedule: { intervalMinutes: 30, wakeForRun: false, oneShot: false },
  notifications: {
    enabled: true,
    sound: "Glass",
    speak: false,
    voice: "Samantha",
    minSeverity: "medium",
  },
  stateDir: ".vigil",
  safety: {
    allowReadOnly: true,
    blockDestructive: true,
    allowRemoteHttp: false,
    commandAllowlist: [],
  },
  // Used only by `task` probes (the AI completion judge). Read-only by design.
  aiTask: {
    claudeBin: "claude",
    model: "haiku",
    confidenceThreshold: 0.8,
    allowedTools: ["Read", "Grep", "Glob"],
  },
  probes: [],
};

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const VALID_TYPES = new Set(["shell", "http", "git", "disk", "task"]);

// ─── Discovery ─────────────────────────────────────────────────────────────

// When run from launchd we cannot rely on cwd, so callers pass --project <abs>.
// Resolve it once and stash so the rest of the module can find config + state.
let PROJECT_OVERRIDE = null;

export function setProjectDir(dir) {
  if (dir) PROJECT_OVERRIDE = path.resolve(dir);
}

function findConfigFile() {
  let dir = PROJECT_OVERRIDE || process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  const candidate = path.join(root, CONFIG_FILENAME);
  return fs.existsSync(candidate) ? candidate : null;
}

export function getProjectDir() {
  const configPath = findConfigFile();
  if (configPath) return path.dirname(configPath);
  // No config yet — fall back to the override or cwd so `init` has a home.
  return PROJECT_OVERRIDE || process.cwd();
}

export function getConfigPath() {
  return path.join(getProjectDir(), CONFIG_FILENAME);
}

// ─── Load + merge (soft-default: never throws on missing file) ───────────────

export function loadConfig() {
  const configPath = findConfigFile();
  if (!configPath) return mergeWithDefaults({}, false);
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return mergeWithDefaults(raw, true);
  } catch (e) {
    // Malformed config must not crash a launchd tick — surface it, don't throw.
    const cfg = mergeWithDefaults({}, true);
    cfg._configError = e.message;
    return cfg;
  }
}

function mergeWithDefaults(raw, found) {
  const config = {
    schedule: { ...DEFAULTS.schedule, ...(raw.schedule || {}) },
    notifications: { ...DEFAULTS.notifications, ...(raw.notifications || {}) },
    stateDir: raw.stateDir || DEFAULTS.stateDir,
    safety: { ...DEFAULTS.safety, ...(raw.safety || {}) },
    aiTask: { ...DEFAULTS.aiTask, ...(raw.aiTask || {}) },
    probes: normalizeProbes(raw.probes || []),
    _configFound: found,
  };
  return config;
}

function normalizeProbes(probes) {
  return probes.map((p, i) => ({
    name: p.name || `probe-${i}`,
    type: p.type,
    enabled: p.enabled !== false,
    severity: SEVERITY_RANK[p.severity] ? p.severity : "medium",
    timeout: typeof p.timeout === "number" ? p.timeout : 60000,
    // shell
    command: p.command,
    expectExitCode: typeof p.expectExitCode === "number" ? p.expectExitCode : 0,
    // http
    url: p.url,
    expectStatus: typeof p.expectStatus === "number" ? p.expectStatus : 200,
    // git
    warnBehind: typeof p.warnBehind === "number" ? p.warnBehind : 10,
    warnDirty: p.warnDirty !== false,
    // disk
    threshold: p.threshold,
    diskPath: p.path,
    // task (AI judge)
    task: p.task,
  }));
}

// ─── Validation (used by init + install) ─────────────────────────────────────

export function validateConfig(config) {
  const errors = [];
  const interval = config.schedule?.intervalMinutes;
  if (typeof interval !== "number" || interval < 1) {
    errors.push("schedule.intervalMinutes must be a number >= 1");
  }
  for (const p of config.probes) {
    if (!p.name) errors.push(`probe missing name`);
    if (!VALID_TYPES.has(p.type)) {
      errors.push(`probe "${p.name}": unknown type "${p.type}" (use shell|http|git|disk)`);
      continue;
    }
    if (p.type === "shell" && !p.command) errors.push(`probe "${p.name}": shell needs "command"`);
    if (p.type === "http" && !p.url) errors.push(`probe "${p.name}": http needs "url"`);
    if (p.type === "disk" && !p.threshold) errors.push(`probe "${p.name}": disk needs "threshold"`);
    if (p.type === "task" && (!p.task || !String(p.task).trim())) errors.push(`probe "${p.name}": task needs a "task" description`);
    if (p.timeout > interval * 60000) {
      errors.push(`probe "${p.name}": timeout (${p.timeout}ms) exceeds the interval`);
    }
  }
  return errors;
}

export function severityRank(s) {
  return SEVERITY_RANK[s] || 0;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

export function getStateDir(config) {
  let dirName = (config && config.stateDir) || DEFAULTS.stateDir;
  // Keep all state inside the project: ignore absolute paths or `..` escapes.
  if (path.isAbsolute(dirName) || dirName.split(/[/\\]/).includes("..")) {
    dirName = DEFAULTS.stateDir;
  }
  return path.join(getProjectDir(), dirName);
}

export function getStatePath(config) {
  return path.join(getStateDir(config), "state.json");
}

export function getEventsPath(config) {
  return path.join(getStateDir(config), "events.ndjson");
}

export function getHeartbeatPath(config) {
  return path.join(getStateDir(config), "heartbeat.json");
}

export function getLockPath(config) {
  return path.join(getStateDir(config), "tick.lock");
}

export function getHaltPath(config) {
  return path.join(getStateDir(config), "HALT");
}

export function getTickLogPath(config) {
  return path.join(getStateDir(config), "tick.log");
}

// ─── launchd identity ─────────────────────────────────────────────────────────

// Stable, collision-resistant, filesystem-safe label keyed to the project path,
// so multiple projects can be watched concurrently without clashing.
export function getLabel() {
  const slug = crypto.createHash("sha1").update(getProjectDir()).digest("hex").slice(0, 10);
  return `com.vigil.${slug}`;
}

export function getPlistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${getLabel()}.plist`);
}

export { CONFIG_FILENAME, DEFAULTS };
