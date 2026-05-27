import fs from "fs";
import path from "path";

const CONFIG_FILENAME = "domain-check.config.json";

const DEFAULTS = {
  // RDAP front-end that redirects to the authoritative registry server.
  rdapBase: "https://rdap.org",
  timeoutMs: 10000,
  concurrency: 8,
  // TLDs swept by `scan` (without leading dot).
  tlds: ["com", "io", "app", "dev", "sh", "co", "net", "org", "ai", "xyz", "me", "so"],
  // `suggest` builds <prefix>name and name<suffix> across suggestTlds.
  suggestPrefixes: ["get", "use", "try", "my"],
  suggestSuffixes: ["hq", "app", "hub", "go"],
  suggestTlds: ["com", "app", "io", "dev", "sh"],
  // Best-effort `whois` fallback for results RDAP can't resolve (some ccTLDs).
  whoisFallback: true,
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

function mergeWithDefaults(raw, projectDir) {
  return {
    rdapBase: raw.rdapBase ?? DEFAULTS.rdapBase,
    timeoutMs: raw.timeoutMs ?? DEFAULTS.timeoutMs,
    concurrency: raw.concurrency ?? DEFAULTS.concurrency,
    tlds: raw.tlds ?? DEFAULTS.tlds,
    suggestPrefixes: raw.suggestPrefixes ?? DEFAULTS.suggestPrefixes,
    suggestSuffixes: raw.suggestSuffixes ?? DEFAULTS.suggestSuffixes,
    suggestTlds: raw.suggestTlds ?? DEFAULTS.suggestTlds,
    whoisFallback: raw.whoisFallback ?? DEFAULTS.whoisFallback,
    _configFound: true,
    _projectDir: projectDir,
  };
}
