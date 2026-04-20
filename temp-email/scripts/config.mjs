import fs from "fs";
import path from "path";

const CONFIG_FILENAME = "temp-email.config.json";

const DEFAULTS = {
  pollInterval: 5,
  pollTimeout: 60,
  autoCleanup: true,
};

export function loadConfig() {
  const configPath = findConfigFile();
  if (!configPath) {
    return { ...DEFAULTS, _configFound: false, _projectDir: process.cwd() };
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return mergeWithDefaults(raw, path.dirname(configPath));
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
  return configPath ? path.dirname(configPath) : process.cwd();
}

export function getStorageDir() {
  return path.join(getProjectDir(), ".temp-email");
}

export function getInboxesPath() {
  return path.join(getStorageDir(), "inboxes.json");
}

function mergeWithDefaults(raw, projectDir) {
  return {
    pollInterval: raw.pollInterval ?? DEFAULTS.pollInterval,
    pollTimeout: raw.pollTimeout ?? DEFAULTS.pollTimeout,
    autoCleanup: raw.autoCleanup ?? DEFAULTS.autoCleanup,
    _configFound: true,
    _projectDir: projectDir,
  };
}
