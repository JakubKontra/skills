import fs from "fs";
import path from "path";

const CONFIG_FILENAME = "rankpulse.config.json";

const DEFAULTS = {
  domain: null,
  checks: {
    gsc: { enabled: true },
    ahrefs: { enabled: true },
    meta: { enabled: true, severity: "high" },
    robots: { enabled: true, severity: "critical" },
    sitemap: { enabled: true, severity: "high" },
    canonical: { enabled: true, severity: "high" },
    schema: { enabled: true, severity: "medium" },
    headings: { enabled: true, severity: "medium" },
    images: { enabled: true, severity: "medium" },
    links: { enabled: true, severity: "medium" },
    i18n: { enabled: false, severity: "medium" },
    performance: { enabled: true, severity: "medium" },
  },
  competitors: [],
  exclude: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    ".nuxt/**",
    "coverage/**",
    "*.min.js",
    "*.bundle.js",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ],
  include: [],
  severityThreshold: "low",
  maxFindings: 300,
  reportTitle: "SEO Health Check",
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
  return path.join(getProjectDir(), ".rankpulse");
}

export function getReportsDir() {
  return path.join(getProjectDir(), "reports");
}

export function getScanHistoryPath() {
  return path.join(getStorageDir(), "scan-history.json");
}

export function getBaselinesDir() {
  return path.join(getStorageDir(), "baselines");
}

function mergeWithDefaults(raw, projectDir) {
  const checks = {};
  for (const [key, defaultVal] of Object.entries(DEFAULTS.checks)) {
    checks[key] = { ...defaultVal, ...(raw.checks?.[key] || {}) };
  }

  return {
    domain: raw.domain || DEFAULTS.domain,
    checks,
    competitors: raw.competitors || DEFAULTS.competitors,
    exclude: raw.exclude || DEFAULTS.exclude,
    include: raw.include || DEFAULTS.include,
    severityThreshold: raw.severityThreshold || DEFAULTS.severityThreshold,
    maxFindings: raw.maxFindings ?? DEFAULTS.maxFindings,
    reportTitle: raw.reportTitle || DEFAULTS.reportTitle,
    _configFound: true,
    _projectDir: projectDir,
  };
}
