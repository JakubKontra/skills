import fs from "fs";
import path from "path";
import { getRoEPath, getProjectDir } from "./config.mjs";

export function loadRoE() {
  const p = getRoEPath();
  if (!fs.existsSync(p)) {
    return { _found: false, path: p };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return { _found: true, path: p, ...raw };
  } catch (e) {
    return { _found: false, path: p, error: `Invalid JSON: ${e.message}` };
  }
}

export function validateRoE() {
  const roe = loadRoE();
  const errors = [];
  const warnings = [];

  if (!roe._found) {
    if (roe.error) errors.push(roe.error);
    else warnings.push(`No vulniq.roe.json found at ${roe.path}. Running with implicit scope = project root.`);
    return { status: warnings.length && !errors.length ? "warn" : (errors.length ? "error" : "ok"), roe, errors, warnings };
  }

  if (!roe.projectRoot) {
    errors.push("RoE must declare 'projectRoot'");
  } else {
    const expected = path.resolve(getProjectDir());
    const declared = path.resolve(path.dirname(roe.path), roe.projectRoot);
    if (declared !== expected) {
      errors.push(`RoE projectRoot '${roe.projectRoot}' resolves to ${declared}, but CWD resolves to ${expected}`);
    }
  }

  if (!roe.operator || !roe.operator.name) {
    warnings.push("RoE should declare operator.name for audit attribution");
  }

  if (!Array.isArray(roe.allowedPaths) || roe.allowedPaths.length === 0) {
    warnings.push("RoE should declare allowedPaths (glob list) for explicit scope");
  }

  if (roe.scanWindow) {
    const winResult = validateScanWindow(roe.scanWindow);
    if (!winResult.valid) errors.push(winResult.reason);
  }

  return {
    status: errors.length ? "error" : (warnings.length ? "warn" : "ok"),
    roe,
    errors,
    warnings,
  };
}

export function validateScanWindow(window) {
  const now = Date.now();
  if (window.start) {
    const start = Date.parse(window.start);
    if (isNaN(start)) return { valid: false, reason: `scanWindow.start is not a valid ISO timestamp: ${window.start}` };
    if (now < start) return { valid: false, reason: `Current time is before scanWindow.start (${window.start})` };
  }
  if (window.end) {
    const end = Date.parse(window.end);
    if (isNaN(end)) return { valid: false, reason: `scanWindow.end is not a valid ISO timestamp: ${window.end}` };
    if (now > end) return { valid: false, reason: `Current time is after scanWindow.end (${window.end})` };
  }
  return { valid: true };
}

export function isInScope(filePath, roe) {
  if (!roe || !roe._found) return true;

  const relative = path.isAbsolute(filePath)
    ? path.relative(getProjectDir(), filePath)
    : filePath;

  const forbidden = Array.isArray(roe.forbiddenPaths) ? roe.forbiddenPaths : [];
  for (const glob of forbidden) {
    if (globMatch(relative, glob)) return false;
  }

  const allowed = Array.isArray(roe.allowedPaths) ? roe.allowedPaths : [];
  if (allowed.length === 0) return true;
  for (const glob of allowed) {
    if (globMatch(relative, glob)) return true;
  }
  return false;
}

function globMatch(pathStr, glob) {
  const re = globToRegex(glob);
  return re.test(pathStr);
}

function globToRegex(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^$|()[]{}\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function getAssetCriticality(filePath, roe) {
  if (!roe || !roe._found || !roe.assetCriticality) return null;
  const relative = path.isAbsolute(filePath)
    ? path.relative(getProjectDir(), filePath)
    : filePath;
  for (const [glob, tier] of Object.entries(roe.assetCriticality)) {
    if (globMatch(relative, glob)) return tier;
  }
  return null;
}
