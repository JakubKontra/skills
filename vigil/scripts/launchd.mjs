import fs from "fs";
import path from "path";
import os from "os";
import { spawnSync } from "child_process";
import { getLabel, getPlistPath, getProjectDir, getTickLogPath, loadConfig } from "./config.mjs";

const CLI_PATH = path.resolve(new URL(".", import.meta.url).pathname, "cli.mjs");

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function buildPlist(intervalSeconds) {
  const label = getLabel();
  const project = getProjectDir();
  const node = process.execPath; // absolute node — launchd has a bare environment
  const tickLog = getTickLogPath(loadConfig());
  const home = os.homedir();
  // Include Homebrew bin (npm/git) and ~/.local/bin (where `claude` lives, for task-mode judging)
  // so probe commands resolve under launchd's bare environment.
  const PATH = `${home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(node)}</string>
    <string>${xmlEscape(CLI_PATH)}</string>
    <string>tick</string>
    <string>--project</string>
    <string>${xmlEscape(project)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(project)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH}</string>
    <key>HOME</key>
    <string>${xmlEscape(home)}</string>
    <key>VIGIL_MANAGED</key>
    <string>1</string>
  </dict>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(tickLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(tickLog)}</string>
  <key>ExitTimeOut</key>
  <integer>30</integer>
</dict>
</plist>
`;
}

function launchctl(args) {
  const r = spawnSync("launchctl", args, { encoding: "utf-8" });
  return { code: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

function domainTarget() {
  return `gui/${os.userInfo().uid}`;
}

/** Write the plist atomically and (re)load it. Idempotent: bootout then bootstrap. */
export function install(intervalSeconds) {
  const plistPath = getPlistPath();
  const label = getLabel();
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const tmp = plistPath + ".tmp";
  fs.writeFileSync(tmp, buildPlist(intervalSeconds));
  fs.renameSync(tmp, plistPath);

  launchctl(["bootout", `${domainTarget()}/${label}`]); // ignore failure if not loaded
  const boot = launchctl(["bootstrap", domainTarget(), plistPath]);
  launchctl(["enable", `${domainTarget()}/${label}`]);
  const kick = launchctl(["kickstart", "-k", `${domainTarget()}/${label}`]);

  return {
    label,
    plistPath,
    loaded: boot.code === 0,
    bootstrapError: boot.code === 0 ? null : boot.stderr,
    kicked: kick.code === 0,
  };
}

export function uninstall({ keepPlist = false } = {}) {
  const plistPath = getPlistPath();
  const label = getLabel();
  // Remove the plist file BEFORE bootout: a one-shot uninstall is called from inside the
  // launchd-spawned tick, and `bootout` SIGTERMs our own process — so anything after it may
  // not run. Removing the file first guarantees no orphaned plist reloads on next login.
  let plistRemoved = false;
  if (!keepPlist && fs.existsSync(plistPath)) {
    fs.rmSync(plistPath);
    plistRemoved = true;
  }
  const out = launchctl(["bootout", `${domainTarget()}/${label}`]);
  return { label, unloaded: out.code === 0 || /No such process|Could not find/.test(out.stderr), plistRemoved };
}

/** Returns { loaded, pid, lastExitStatus } by parsing `launchctl print`. */
export function jobStatus() {
  const label = getLabel();
  const out = launchctl(["print", `${domainTarget()}/${label}`]);
  if (out.code !== 0) return { loaded: false };
  const pid = (out.stdout.match(/\bpid = (\d+)/) || [])[1];
  const last = (out.stdout.match(/last exit code = (\d+)/) || [])[1];
  return {
    loaded: true,
    pid: pid ? parseInt(pid, 10) : null,
    lastExitStatus: last != null ? parseInt(last, 10) : null,
  };
}

export { CLI_PATH, domainTarget };
