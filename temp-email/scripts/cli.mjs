#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { loadConfig, getStorageDir, getInboxesPath } from "./config.mjs";

function json(obj) {
  console.log(JSON.stringify(obj));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function readStdin() {
  return fs.readFileSync(0, "utf-8");
}

function loadInboxes() {
  const inboxesPath = getInboxesPath();
  if (!fs.existsSync(inboxesPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(inboxesPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveInboxes(inboxes) {
  const inboxesPath = getInboxesPath();
  ensureDir(path.dirname(inboxesPath));
  fs.writeFileSync(inboxesPath, JSON.stringify(inboxes, null, 2), "utf-8");
}

// ─── Config ──────────────────────────────────────────────────────────────────

function showConfig() {
  try {
    json({ command: "config", status: "ok", config: loadConfig() });
  } catch (e) {
    json({ command: "config", status: "error", message: e.message });
  }
}

// ─── Create Inbox ───────────────────────────────────────────────────────────

function createInbox(label) {
  if (!label) {
    json({ command: "create-inbox", status: "error", message: "Label required" });
    return;
  }

  const content = readStdin();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    json({ command: "create-inbox", status: "error", message: "Invalid JSON on stdin. Expected {address, token}" });
    return;
  }

  if (!parsed.address || !parsed.token) {
    json({ command: "create-inbox", status: "error", message: "JSON must have 'address' and 'token' fields" });
    return;
  }

  const inboxes = loadInboxes();
  const entry = {
    address: parsed.address,
    token: parsed.token,
    label,
    createdAt: timestamp(),
    messages: [],
  };

  inboxes.push(entry);
  saveInboxes(inboxes);

  json({ command: "create-inbox", status: "ok", inbox: entry });
}

// ─── List Inboxes ───────────────────────────────────────────────────────────

function listInboxes() {
  const inboxes = loadInboxes();
  if (inboxes.length === 0) {
    json({ command: "list-inboxes", status: "ok", inboxes: [], message: "No inboxes created" });
    return;
  }

  const now = Date.now();
  const summary = inboxes.map((inbox) => {
    const created = new Date(inbox.createdAt.replace("T", "T").replace(/(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3"));
    const ageMinutes = Math.round((now - created.getTime()) / 60000);
    return {
      address: inbox.address,
      label: inbox.label,
      createdAt: inbox.createdAt,
      ageMinutes,
      messageCount: inbox.messages?.length || 0,
      likelyExpired: ageMinutes > 10,
    };
  });

  json({ command: "list-inboxes", status: "ok", inboxes: summary });
}

// ─── Check Inbox ────────────────────────────────────────────────────────────

function checkInbox(addressOrLabel) {
  if (!addressOrLabel) {
    json({ command: "check-inbox", status: "error", message: "Address or label required" });
    return;
  }

  const inboxes = loadInboxes();
  const inbox = inboxes.find(
    (i) => i.address === addressOrLabel || i.label === addressOrLabel
  );

  if (!inbox) {
    json({ command: "check-inbox", status: "error", message: `Inbox not found: ${addressOrLabel}` });
    return;
  }

  try {
    const result = execSync(
      `curl -s "https://api.tempmail.lol/v2/inbox?token=${inbox.token}"`,
      { encoding: "utf-8", timeout: 15000 }
    );

    let data;
    try {
      data = JSON.parse(result);
    } catch {
      json({ command: "check-inbox", status: "error", message: "Failed to parse API response", raw: result });
      return;
    }

    // Update stored messages
    if (data.emails && data.emails.length > 0) {
      inbox.messages = data.emails;
      saveInboxes(inboxes);
    }

    json({
      command: "check-inbox",
      status: "ok",
      address: inbox.address,
      label: inbox.label,
      expired: data.expired || false,
      emailCount: data.emails?.length || 0,
      emails: data.emails || [],
    });
  } catch (e) {
    json({ command: "check-inbox", status: "error", message: e.message });
  }
}

// ─── Delete Inbox ───────────────────────────────────────────────────────────

function deleteInbox(addressOrLabel) {
  if (!addressOrLabel) {
    json({ command: "delete-inbox", status: "error", message: "Address or label required" });
    return;
  }

  const inboxes = loadInboxes();
  const index = inboxes.findIndex(
    (i) => i.address === addressOrLabel || i.label === addressOrLabel
  );

  if (index === -1) {
    json({ command: "delete-inbox", status: "error", message: `Inbox not found: ${addressOrLabel}` });
    return;
  }

  const removed = inboxes.splice(index, 1)[0];
  saveInboxes(inboxes);

  json({ command: "delete-inbox", status: "ok", removed: { address: removed.address, label: removed.label } });
}

// ─── History ────────────────────────────────────────────────────────────────

function showHistory() {
  const inboxes = loadInboxes();
  if (inboxes.length === 0) {
    json({ command: "history", status: "ok", inboxes: [], message: "No inboxes created" });
    return;
  }

  const history = inboxes.map((inbox) => ({
    address: inbox.address,
    label: inbox.label,
    createdAt: inbox.createdAt,
    messageCount: inbox.messages?.length || 0,
  }));

  json({ command: "history", status: "ok", inboxes: [...history].reverse(), total: history.length });
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "config":
    showConfig();
    break;
  case "create-inbox":
    createInbox(args.join(" "));
    break;
  case "list-inboxes":
    listInboxes();
    break;
  case "check-inbox":
    checkInbox(args.join(" "));
    break;
  case "delete-inbox":
    deleteInbox(args.join(" "));
    break;
  case "history":
    showHistory();
    break;
  default:
    json({
      command: cmd || null,
      status: "error",
      message: `Unknown command: ${cmd || "(none)"}. Available: config, create-inbox, list-inboxes, check-inbox, delete-inbox, history`,
    });
}
