#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { config as dotenvConfig } from "dotenv";
import {
  loadConfig,
  getStorageDir,
  getBaselinesDir,
  getReportsDir,
  getDiscoveredRoutesPath,
  getAuthStatePath,
  getJourneysPath,
} from "./config.mjs";

const SCREENSHOTS_DIR = "/tmp/browserhawk/screenshots";

function json(obj) {
  console.log(JSON.stringify(obj));
}

function ab(argsStr, timeoutMs = 30000) {
  // Parse args string into array, respecting quoted strings
  const args = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) { args.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);

  return execFileSync("npx", ["agent-browser", ...args], {
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...process.env, AGENT_BROWSER_HEADED: "1" },
  }).trim();
}

function stripGlob(pattern) {
  // Convert glob patterns like "**/login.microsoftonline.com/**" to "login.microsoftonline.com"
  return pattern.replace(/^\*+\/?/, "").replace(/\/?\*+$/, "").replace(/\*+/g, "");
}

// ─── Config ──────────────────────────────────────────────────────────────────

function showConfig() {
  try {
    json({ command: "config", status: "ok", config: loadConfig() });
  } catch (e) {
    json({ command: "config", status: "error", message: e.message });
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

function login() {
  const config = loadConfig();

  if (config.auth.type === "none") {
    json({ command: "login", status: "ok", message: "No auth configured" });
    return;
  }

  // Load env file for credentials
  if (config.auth.envFile) {
    dotenvConfig({ path: path.resolve(process.cwd(), config.auth.envFile) });
  }

  const authStatePath = getAuthStatePath();

  try {
    for (const step of config.auth.steps) {
      const timeout = step.timeout || 10000;

      switch (step.action) {
        case "navigate": {
          const url = (step.value || "").replace("${target}", config.target);
          ab(`open "${url}"`, timeout + 5000);
          ab(`wait --load networkidle`, timeout + 5000);
          break;
        }
        case "click": {
          ab(`click "${step.selector}"`, timeout + 5000);
          break;
        }
        case "fill": {
          const value = step.envVar
            ? process.env[step.envVar] || ""
            : (step.value || "").replace("${target}", config.target);
          if (!value) {
            throw new Error(
              step.envVar
                ? `Environment variable ${step.envVar} is not set`
                : "fill step requires a value or envVar"
            );
          }
          ab(`wait "${step.selector}" ${timeout}`);
          ab(`fill "${step.selector}" "${value}"`);
          break;
        }
        case "waitForUrl": {
          const urlPattern = stripGlob(step.pattern);
          ab(`wait --url "${urlPattern}" ${timeout}`, timeout + 5000);
          break;
        }
        case "waitForSelector": {
          ab(`wait "${step.selector}" ${timeout}`, timeout + 5000);
          break;
        }
        case "wait": {
          ab(`wait ${timeout}`, timeout + 5000);
          break;
        }
        case "pause": {
          const message = step.value || "Complete authentication manually in the browser";
          json({
            command: "login",
            status: "waiting",
            message,
            action: "Manual intervention required. Complete the login in the browser — the agent will continue automatically.",
          });
          // Wait for success indicator
          const si = config.auth.successIndicator;
          const waitTimeout = step.timeout || si.timeout || 120000;
          if (si.type === "url") {
            const urlVal = stripGlob(si.value);
            ab(`wait --url "${urlVal}" ${waitTimeout}`, waitTimeout + 5000);
          } else {
            ab(`wait "${si.value}" ${waitTimeout}`, waitTimeout + 5000);
          }
          break;
        }
        default:
          throw new Error(`Unknown auth step action: ${step.action}`);
      }
    }

    // Verify success indicator (if no pause step handled it)
    const si = config.auth.successIndicator;
    const hasPause = config.auth.steps.some((s) => s.action === "pause");
    if (!hasPause) {
      const siTimeout = si.timeout || 30000;
      if (si.type === "url") {
        const urlVal = stripGlob(si.value);
        ab(`wait --url "${urlVal}" ${siTimeout}`, siTimeout + 5000);
      } else {
        ab(`wait "${si.value}" ${siTimeout}`, siTimeout + 5000);
      }
    }

    // Save auth state
    fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
    ab(`state save "${authStatePath}"`);

    const currentUrl = ab(`get url`);
    json({
      command: "login",
      status: "ok",
      redirectedTo: currentUrl,
      authStateSaved: authStatePath,
    });
  } catch (e) {
    json({
      command: "login",
      status: "error",
      message: e.message,
    });
    process.exit(1);
  }
}

// ─── Discover ────────────────────────────────────────────────────────────────

function discover() {
  const config = loadConfig();

  const maxDepth = config.discovery.maxDepth ?? 3;
  const maxPages = config.discovery.maxPages ?? 50;
  const excludePatterns = config.discovery.excludePatterns ?? [];
  const sameDomainOnly = config.discovery.sameDomainOnly ?? true;
  const targetUrl = new URL(config.target);

  const visited = new Set();
  const routes = [];
  const queue = [];

  // Seed: entry point + known routes
  queue.push({ url: `${config.target}${config.entryPoint}`, depth: 0, from: "entryPoint" });
  if (config.knownRoutes) {
    for (const route of config.knownRoutes) {
      queue.push({ url: `${config.target}${route.path}`, depth: 0, from: "knownRoutes" });
    }
  }

  // Seed from previously discovered routes
  let previousRoutes = [];
  try {
    const routesFilePath = getDiscoveredRoutesPath();
    if (fs.existsSync(routesFilePath)) {
      const data = JSON.parse(fs.readFileSync(routesFilePath, "utf-8"));
      previousRoutes = data.routes || [];
      for (const route of previousRoutes) {
        queue.push({ url: `${config.target}${route.path}`, depth: 0, from: "previousDiscovery" });
      }
    }
  } catch {}

  while (queue.length > 0 && routes.length < maxPages) {
    const item = queue.shift();
    const normalizedUrl = normalizeUrl(item.url);

    if (visited.has(normalizedUrl)) continue;
    visited.add(normalizedUrl);

    if (isExcluded(normalizedUrl, excludePatterns)) continue;

    if (sameDomainOnly) {
      try {
        if (new URL(normalizedUrl).hostname !== targetUrl.hostname) continue;
      } catch { continue; }
    }

    try {
      ab(`open "${normalizedUrl}"`);
      ab(`wait --load networkidle`);

      const title = ab(`get title`);
      const currentUrl = ab(`get url`);
      const pagePath = new URL(currentUrl).pathname;

      // Count links and forms via eval
      const linkCount = parseInt(ab(`eval "document.querySelectorAll('a[href]').length"`) || "0", 10);
      const formCount = parseInt(ab(`eval "document.querySelectorAll('form').length"`) || "0", 10);

      routes.push({
        url: currentUrl,
        path: pagePath,
        title,
        linkCount,
        formCount,
        depth: item.depth,
        discoveredFrom: item.from,
      });

      // Discover more links if not at max depth
      if (item.depth < maxDepth) {
        try {
          const linksJson = ab(`eval "JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a=>a.href).filter(h=>h&&!h.startsWith('javascript:')&&!h.startsWith('mailto:')))"`);
          const links = JSON.parse(linksJson);
          for (const link of links) {
            const normalized = normalizeUrl(link);
            if (!visited.has(normalized)) {
              queue.push({ url: normalized, depth: item.depth + 1, from: pagePath });
            }
          }
        } catch {}
      }
    } catch {
      // Skip pages that fail to load
    }
  }

  // Merge with previously discovered
  const routesByPath = new Map();
  for (const r of previousRoutes) routesByPath.set(r.path, r);
  for (const r of routes) routesByPath.set(r.path, r);
  const mergedRoutes = Array.from(routesByPath.values());

  // Save
  let savedTo = null;
  try {
    const routesFilePath = getDiscoveredRoutesPath();
    fs.mkdirSync(path.dirname(routesFilePath), { recursive: true });
    fs.writeFileSync(
      routesFilePath,
      JSON.stringify({ lastUpdated: new Date().toISOString(), routes: mergedRoutes }, null, 2)
    );
    savedTo = routesFilePath;
  } catch {}

  json({
    command: "discover",
    status: "ok",
    totalPages: routes.length,
    previouslySaved: previousRoutes.length,
    mergedTotal: mergedRoutes.length,
    maxDepthReached: Math.max(0, ...routes.map((r) => r.depth)),
    savedTo,
    routes: mergedRoutes,
  });
}

// ─── Compare / Baseline ─────────────────────────────────────────────────────

function compare(routeName) {
  const baselinesDir = getBaselinesDir();
  fs.mkdirSync(baselinesDir, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const baselineFile = path.join(baselinesDir, `${routeName}.png`);
  const currentFile = path.join(SCREENSHOTS_DIR, `${routeName}-current.png`);

  ab(`screenshot "${currentFile}" --full`);

  const hasBaseline = fs.existsSync(baselineFile);

  if (!hasBaseline) {
    fs.copyFileSync(currentFile, baselineFile);
  }

  json({
    command: "compare",
    status: "ok",
    routeName,
    baselinePath: baselineFile,
    currentPath: currentFile,
    hasBaseline,
    match: hasBaseline ? "exists" : "new",
    message: hasBaseline
      ? `Baseline exists. Compare ${baselineFile} with ${currentFile} visually.`
      : `No baseline found. Created initial baseline at ${baselineFile}.`,
  });
}

function updateBaseline(routeName) {
  const baselinesDir = getBaselinesDir();
  fs.mkdirSync(baselinesDir, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  const baselineFile = path.join(baselinesDir, `${routeName}.png`);
  const currentFile = path.join(SCREENSHOTS_DIR, `${routeName}-current.png`);

  if (!fs.existsSync(currentFile)) {
    ab(`screenshot "${currentFile}" --full`);
  }

  fs.copyFileSync(currentFile, baselineFile);

  json({
    command: "update-baseline",
    status: "ok",
    routeName,
    baselinePath: baselineFile,
    message: `Baseline updated for ${routeName}`,
  });
}

// ─── Journey Commands ────────────────────────────────────────────────────────

function loadJourneysFile() {
  const journeysPath = getJourneysPath();
  if (fs.existsSync(journeysPath)) {
    return JSON.parse(fs.readFileSync(journeysPath, "utf-8"));
  }
  return { version: 1, lastUpdated: new Date().toISOString(), journeys: [] };
}

function saveJourneysFile(data) {
  const journeysPath = getJourneysPath();
  fs.mkdirSync(path.dirname(journeysPath), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(journeysPath, JSON.stringify(data, null, 2));
}

function saveJourney() {
  try {
    const input = fs.readFileSync(0, "utf-8").trim();
    const journey = JSON.parse(input);

    if (!journey.route || !journey.type) {
      json({ command: "save-journey", status: "error", message: "Journey must have 'route' and 'type' fields" });
      process.exit(1);
    }

    journey.lastRun = new Date().toISOString();
    const data = loadJourneysFile();

    const idx = data.journeys.findIndex((j) => j.route === journey.route && j.type === journey.type);
    if (idx >= 0) {
      data.journeys[idx] = journey;
    } else {
      data.journeys.push(journey);
    }

    saveJourneysFile(data);

    json({
      command: "save-journey",
      status: "ok",
      route: journey.route,
      type: journey.type,
      totalJourneys: data.journeys.length,
      updated: idx >= 0,
      path: getJourneysPath(),
    });
  } catch (e) {
    json({ command: "save-journey", status: "error", message: e.message });
    process.exit(1);
  }
}

function loadJourneys(routeFilter) {
  try {
    const data = loadJourneysFile();
    let journeys = data.journeys;
    if (routeFilter) {
      journeys = journeys.filter((j) => j.route === routeFilter);
    }
    json({
      command: "load-journeys",
      status: "ok",
      count: journeys.length,
      totalStored: data.journeys.length,
      lastUpdated: data.lastUpdated,
      journeys,
    });
  } catch {
    json({ command: "load-journeys", status: "ok", count: 0, totalStored: 0, journeys: [] });
  }
}

// ─── Save Report ─────────────────────────────────────────────────────────────

function saveReport(description) {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toISOString().split("T")[1].replace(/:/g, "").substring(0, 6);
  const filename = `${date}-${time}-${description}.md`;
  try {
    const reportsDir = getReportsDir();
    fs.mkdirSync(reportsDir, { recursive: true });
    const content = fs.readFileSync(0, "utf-8");
    const filePath = path.join(reportsDir, filename);
    fs.writeFileSync(filePath, content);
    json({ command: "save-report", status: "ok", path: filePath, filename, timestamp: now.toISOString() });
  } catch (e) {
    json({ command: "save-report", status: "error", message: e.message });
  }
}

function lastRun() {
  try {
    const reportsDir = getReportsDir();
    if (!fs.existsSync(reportsDir)) {
      json({ command: "last-run", status: "ok", lastRun: null, message: "No reports found" });
      return;
    }
    const files = fs.readdirSync(reportsDir).filter(f => f.endsWith(".md")).sort().reverse();
    if (files.length === 0) {
      json({ command: "last-run", status: "ok", lastRun: null, message: "No reports found" });
      return;
    }
    const latest = files[0];
    const match = latest.match(/^(\d{4}-\d{2}-\d{2})-(\d{6})-(.+)\.md$/);
    const matchOld = latest.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    json({
      command: "last-run",
      status: "ok",
      lastRun: latest,
      date: match ? match[1] : (matchOld ? matchOld[1] : null),
      time: match ? match[2] : null,
      description: match ? match[3] : (matchOld ? matchOld[2] : null),
      allReports: files,
    });
  } catch (e) {
    json({ command: "last-run", status: "ok", lastRun: null, message: e.message });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.endsWith("/") && u.pathname.length > 1) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function isExcluded(url, patterns) {
  for (const pattern of patterns) {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    try {
      const urlPath = new URL(url).pathname;
      if (regex.test(urlPath) || regex.test(url)) return true;
    } catch {
      if (regex.test(url)) return true;
    }
  }
  return false;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case "config":
    showConfig();
    break;
  case "login":
    login();
    break;
  case "discover":
    discover();
    break;
  case "compare":
    if (!args[0]) { json({ command: "compare", status: "error", message: "Route name required" }); process.exit(1); }
    compare(args[0]);
    break;
  case "update-baseline":
    if (!args[0]) { json({ command: "update-baseline", status: "error", message: "Route name required" }); process.exit(1); }
    updateBaseline(args[0]);
    break;
  case "save-journey":
    saveJourney();
    break;
  case "load-journeys":
    loadJourneys(args[0]);
    break;
  case "save-report":
    saveReport(args[0] || "test-report");
    break;
  case "last-run":
    lastRun();
    break;
  default:
    json({
      command: command || "none",
      status: "error",
      message: `Unknown command: ${command}. Available: config, login, discover, compare, update-baseline, save-journey, load-journeys, save-report, last-run`,
    });
    process.exit(1);
}
