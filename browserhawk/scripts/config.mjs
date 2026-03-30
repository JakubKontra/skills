import fs from "fs";
import path from "path";

const CONFIG_FILENAME = "browserhawk.config.json";

const DEFAULTS = {
  discovery: { maxDepth: 3, maxPages: 50, sameDomainOnly: true },
  bugReporting: { target: "conversation" },
};

export function loadConfig() {
  const configPath = findConfigFile();
  if (!configPath) {
    throw new Error(
      `Config file "${CONFIG_FILENAME}" not found in project root.\n` +
      `Create one based on the config.example.json in the BrowserHawk skill assets/ directory`
    );
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return mergeWithDefaults(raw);
}

function findConfigFile() {
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

export function getProjectDir() {
  const configPath = findConfigFile();
  if (!configPath) throw new Error(`Config file "${CONFIG_FILENAME}" not found`);
  return path.dirname(configPath);
}

export function getStorageDir() {
  return path.join(getProjectDir(), ".browserhawk");
}

export function getBaselinesDir() {
  return path.join(getStorageDir(), "baselines");
}

export function getReportsDir() {
  return path.join(getStorageDir(), "reports");
}

export function getDiscoveredRoutesPath() {
  return path.join(getStorageDir(), "discovered-routes.json");
}

export function getAuthStatePath() {
  return path.join(getStorageDir(), "auth-state.json");
}

export function getJourneysPath() {
  return path.join(getStorageDir(), "journeys.json");
}

function mergeWithDefaults(raw) {
  if (!raw.target || typeof raw.target !== "string") {
    throw new Error('Config must have a "target" field (e.g., "https://localhost:3000")');
  }
  if (!raw.entryPoint || typeof raw.entryPoint !== "string") {
    throw new Error('Config must have an "entryPoint" field (e.g., "/dashboard")');
  }

  const config = {
    target: raw.target,
    entryPoint: raw.entryPoint,
    auth: raw.auth || { type: "none", steps: [], successIndicator: { type: "url", value: raw.target } },
    discovery: { ...DEFAULTS.discovery, ...(raw.discovery || {}) },
    bugReporting: { ...DEFAULTS.bugReporting, ...(raw.bugReporting || {}) },
    knownRoutes: raw.knownRoutes || undefined,
    healthCheck: raw.healthCheck || undefined,
  };

  if (config.auth.type === "steps" && !config.auth.envFile) {
    config.auth.envFile = ".env.browserhawk";
  }

  return config;
}
