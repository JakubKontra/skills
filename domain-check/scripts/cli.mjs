#!/usr/bin/env node
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import { loadConfig } from "./config.mjs";

const pexecFile = promisify(execFile);

function json(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeDomain(d) {
  return String(d)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

function baseLabel(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .split(".")[0]
    .replace(/[^a-z0-9-]/g, "");
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    next,
  );
  await Promise.all(workers);
  return results;
}

// ─── RDAP ───────────────────────────────────────────────────────────────────

function parseRdap(domain, data) {
  const events = Array.isArray(data?.events) ? data.events : [];
  const find = (action) =>
    events.find((e) => e.eventAction === action)?.eventDate ?? null;
  const registered = find("registration");
  const expires = find("expiration");

  let registrar = null;
  const entities = Array.isArray(data?.entities) ? data.entities : [];
  const reg = entities.find((e) => (e.roles || []).includes("registrar"));
  if (reg) {
    const vcard = reg.vcardArray?.[1];
    if (Array.isArray(vcard)) {
      const fn = vcard.find((f) => f[0] === "fn");
      registrar = fn?.[3] ?? null;
    }
    registrar = registrar ?? reg.handle ?? null;
  }

  return {
    domain,
    status: "taken",
    source: "rdap",
    registered: registered ? registered.slice(0, 10) : null,
    expires: expires ? expires.slice(0, 10) : null,
    registrar,
  };
}

async function rdapLookup(domain, cfg) {
  const url = `${cfg.rdapBase.replace(/\/$/, "")}/domain/${encodeURIComponent(domain)}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "application/rdap+json" },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (res.status === 200) {
      let data = {};
      try {
        data = await res.json();
      } catch {
        /* keep minimal */
      }
      return parseRdap(domain, data);
    }
    if (res.status === 404) {
      // A 404 only means "available" if we were actually redirected to a
      // registry's RDAP server. If the front-end answered 404 itself (no
      // redirect), it has no RDAP server for this TLD (common for ccTLDs like
      // .io/.co/.me) — that's `unknown`, to be resolved via the whois fallback.
      if (res.redirected) return { domain, status: "available", source: "rdap" };
      return { domain, status: "unknown", source: "rdap", reason: "tld-not-in-rdap" };
    }
    return {
      domain,
      status: "unknown",
      source: "rdap",
      httpStatus: res.status,
    };
  } catch (e) {
    return {
      domain,
      status: "unknown",
      source: "rdap",
      error: e.name === "TimeoutError" ? "timeout" : e.message,
    };
  }
}

// ─── whois fallback (best-effort) ─────────────────────────────────────────────

let _whoisChecked = false;
let _hasWhois = false;
function hasWhois() {
  if (_whoisChecked) return _hasWhois;
  _whoisChecked = true;
  try {
    execSync("command -v whois", { stdio: "ignore" });
    _hasWhois = true;
  } catch {
    _hasWhois = false;
  }
  return _hasWhois;
}

const AVAILABLE_RE =
  /(No match|NOT FOUND|No Data Found|Domain not found|No entries found|not been registered|is available|Status:\s*free|domain is available)/i;
const TAKEN_RE =
  /(Creation Date|Registry Expiry|Registrar:|Domain Name:\s*\S|Updated Date|Name Server:|Registry Domain ID)/i;

async function whoisLookup(domain) {
  if (!hasWhois()) return null;
  let out;
  try {
    const r = await pexecFile("whois", [domain], {
      timeout: 15000,
      maxBuffer: 1 << 20,
    });
    out = r.stdout || "";
  } catch (e) {
    // whois often exits non-zero but still prints a useful response.
    out = e.stdout || "";
    if (!out) return null;
  }
  if (AVAILABLE_RE.test(out)) return { domain, status: "available", source: "whois" };
  if (TAKEN_RE.test(out)) {
    const created = out.match(/Creation Date:\s*(\S+)/i)?.[1] ?? null;
    const expires =
      out.match(/Regist(?:ry|rar) Expiry Date:\s*(\S+)/i)?.[1] ?? null;
    const registrar = out.match(/Registrar:\s*(.+)/i)?.[1]?.trim() ?? null;
    return {
      domain,
      status: "taken",
      source: "whois",
      registered: created ? created.slice(0, 10) : null,
      expires: expires ? expires.slice(0, 10) : null,
      registrar,
    };
  }
  return { domain, status: "unknown", source: "whois" };
}

async function resolveDomain(domain, cfg) {
  const result = await rdapLookup(domain, cfg);
  if (cfg.whoisFallback && result.status === "unknown") {
    const who = await whoisLookup(domain);
    if (who && who.status !== "unknown") return who;
  }
  return result;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = { available: 0, unknown: 1, taken: 2 };
const TLD_PRIORITY = ["com", "app", "io", "dev", "sh", "co", "ai", "net", "org"];

function tldOf(domain) {
  const parts = domain.split(".");
  return parts[parts.length - 1];
}

function tldRank(domain) {
  const i = TLD_PRIORITY.indexOf(tldOf(domain));
  return i === -1 ? TLD_PRIORITY.length : i;
}

function byAvailability(a, b) {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (s !== 0) return s;
  const t = tldRank(a.domain) - tldRank(b.domain);
  if (t !== 0) return t;
  return a.domain.length - b.domain.length;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function showConfig() {
  try {
    json({ command: "config", status: "ok", config: loadConfig() });
  } catch (e) {
    json({ command: "config", status: "error", message: e.message });
  }
}

async function check(args, cfg) {
  const domains = args.map(normalizeDomain).filter(Boolean);
  if (domains.length === 0) {
    json({ command: "check", status: "error", message: "Provide at least one domain" });
    return;
  }
  const results = await runPool(
    domains,
    (d) => resolveDomain(d, cfg),
    cfg.concurrency,
  );
  results.sort(byAvailability);
  json({
    command: "check",
    status: "ok",
    count: results.length,
    available: results.filter((r) => r.status === "available").map((r) => r.domain),
    results,
  });
}

async function scan(args, cfg) {
  const flagTlds = args.find((a) => a.startsWith("--tlds="));
  const tlds = flagTlds
    ? flagTlds
        .slice("--tlds=".length)
        .split(",")
        .map((t) => t.trim().replace(/^\./, ""))
        .filter(Boolean)
    : cfg.tlds;
  const base = baseLabel(args.find((a) => !a.startsWith("--")) ?? "");
  if (!base) {
    json({ command: "scan", status: "error", message: "Provide a base name, e.g. `scan slotly`" });
    return;
  }
  const domains = tlds.map((t) => `${base}.${t}`);
  const results = await runPool(
    domains,
    (d) => resolveDomain(d, cfg),
    cfg.concurrency,
  );
  results.sort(byAvailability);
  json({
    command: "scan",
    status: "ok",
    base,
    count: results.length,
    available: results.filter((r) => r.status === "available").map((r) => r.domain),
    results,
  });
}

async function suggest(args, cfg) {
  const base = baseLabel(args.find((a) => !a.startsWith("--")) ?? "");
  if (!base) {
    json({ command: "suggest", status: "error", message: "Provide a base name, e.g. `suggest slotly`" });
    return;
  }

  const candidates = new Set();
  // Exact base across the suggest TLDs.
  for (const t of cfg.suggestTlds) candidates.add(`${base}.${t}`);
  // Affix variations, kept to the most common TLDs to bound request volume.
  const affixTlds = ["com", "app", "io"];
  for (const p of cfg.suggestPrefixes)
    for (const t of affixTlds) candidates.add(`${p}${base}.${t}`);
  for (const s of cfg.suggestSuffixes)
    for (const t of affixTlds) candidates.add(`${base}${s}.${t}`);

  const domains = [...candidates];
  const results = await runPool(
    domains,
    (d) => resolveDomain(d, cfg),
    cfg.concurrency,
  );
  const available = results
    .filter((r) => r.status === "available")
    .map((r) => r.domain)
    .sort((a, b) => {
      const ea = a === `${base}.com` ? 0 : 1;
      const eb = b === `${base}.com` ? 0 : 1;
      if (ea !== eb) return ea - eb;
      const t = tldRank(a) - tldRank(b);
      if (t !== 0) return t;
      return a.length - b.length;
    });
  json({
    command: "suggest",
    status: "ok",
    base,
    checked: domains.length,
    availableCount: available.length,
    available,
    results: results.sort(byAvailability),
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();

switch (cmd) {
  case "config":
    showConfig();
    break;
  case "check":
    await check(args, cfg);
    break;
  case "scan":
    await scan(args, cfg);
    break;
  case "suggest":
    await suggest(args, cfg);
    break;
  default:
    json({
      command: cmd || null,
      status: "error",
      message: `Unknown command: ${cmd || "(none)"}. Available: config, check, scan, suggest`,
    });
}
