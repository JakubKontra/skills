import { spawnSync, spawn } from "child_process";

const SOUND_ALLOWLIST = ["Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"];

function have(bin) {
  return spawnSync("which", [bin], { encoding: "utf-8" }).status === 0;
}

// Strip control chars and cap length — these strings reach osascript/say/notifier.
function clean(s, max = 200) {
  return String(s == null ? "" : s).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, max);
}

function osaQuote(s) {
  // AppleScript string literal: escape backslash and double-quote.
  return clean(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Fire a native macOS notification. All strings are sanitized and passed via
 * argv arrays (terminal-notifier) or escaped AppleScript literals (osascript).
 * Never uses a shell. Returns { delivered, backend }.
 */
export function notify({ title, subtitle, message, sound, group }) {
  title = clean(title, 120);
  subtitle = clean(subtitle, 120);
  message = clean(message, 400);
  const soundName = SOUND_ALLOWLIST.includes(sound) ? sound : "Glass";

  if (have("terminal-notifier")) {
    const args = ["-title", title, "-message", message, "-sound", soundName];
    if (subtitle) args.push("-subtitle", subtitle);
    if (group) args.push("-group", group);
    const r = spawnSync("terminal-notifier", args, { encoding: "utf-8" });
    return { delivered: r.status === 0, backend: "terminal-notifier" };
  }

  // Fallback: osascript with escaped AppleScript literals (shell:false).
  let script = `display notification "${osaQuote(message)}" with title "${osaQuote(title)}"`;
  if (subtitle) script += ` subtitle "${osaQuote(subtitle)}"`;
  script += ` sound name "${osaQuote(soundName)}"`;
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf-8" });
  return { delivered: r.status === 0, backend: "osascript" };
}

/** Optional spoken summary via `say` (detached so it never blocks a tick). */
export function speak({ text, voice, rate }) {
  if (!have("say")) return { spoke: false };
  const args = [];
  if (voice) args.push("-v", clean(voice, 40));
  if (rate) args.push("-r", String(parseInt(rate, 10) || 180));
  args.push(clean(text, 300));
  const child = spawn("say", args, { detached: true, stdio: "ignore", shell: false });
  child.unref();
  return { spoke: true };
}

export function inQuietHours(quietHours, now = new Date()) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = toMin(quietHours.start);
  const end = toMin(quietHours.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end; // handles overnight windows
}
