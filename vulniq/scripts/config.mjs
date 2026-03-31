import fs from "fs";
import path from "path";

const CONFIG_FILENAME = "vulniq.config.json";

const DEFAULTS = {
  checks: {
    secrets: { enabled: true, severity: "critical" },
    xss: { enabled: true, severity: "high" },
    securityHeaders: { enabled: true, severity: "medium" },
    piiExposure: { enabled: true, severity: "high" },
    auth: { enabled: true, severity: "high" },
    dependencies: { enabled: true, severity: "high" },
    owasp: { enabled: true, severity: "high" },
    cors: { enabled: true, severity: "medium" },
    errorHandling: { enabled: true, severity: "medium" },
    dependencyChain: { enabled: true, severity: "medium" },
  },
  exclude: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    "*.min.js",
    "*.bundle.js",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ],
  include: [],
  severityThreshold: "low",
  maxFindings: 500,
  reportTitle: "Security Audit",
  customPatterns: [],
  suppressions: {
    rules: [],
    files: [],
    findings: [],
  },
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
  return path.join(getProjectDir(), ".vulniq");
}

export function getReportsDir() {
  return path.join(getProjectDir(), "reports");
}

export function getScanHistoryPath() {
  return path.join(getStorageDir(), "scan-history.json");
}

export function getSuppressionsPath() {
  return path.join(getStorageDir(), "suppressions.json");
}

function mergeWithDefaults(raw, projectDir) {
  const checks = {};
  for (const [key, defaultVal] of Object.entries(DEFAULTS.checks)) {
    checks[key] = { ...defaultVal, ...(raw.checks?.[key] || {}) };
  }

  return {
    checks,
    exclude: raw.exclude || DEFAULTS.exclude,
    include: raw.include || DEFAULTS.include,
    severityThreshold: raw.severityThreshold || DEFAULTS.severityThreshold,
    maxFindings: raw.maxFindings ?? DEFAULTS.maxFindings,
    reportTitle: raw.reportTitle || DEFAULTS.reportTitle,
    customPatterns: raw.customPatterns || DEFAULTS.customPatterns,
    suppressions: {
      rules: raw.suppressions?.rules || [],
      files: raw.suppressions?.files || [],
      findings: raw.suppressions?.findings || [],
    },
    _configFound: true,
    _projectDir: projectDir,
  };
}
