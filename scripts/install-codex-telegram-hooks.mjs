#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDataDir, loadEnvFiles } from "./telegram-bot-lib.mjs";

const action = process.argv[2] || "install";
if (!["install", "uninstall"].includes(action)) {
  console.error("Usage: node scripts/install-codex-telegram-hooks.mjs [install|uninstall]");
  process.exit(2);
}

const scriptPath = fileURLToPath(new URL("./codex-telegram-hook.mjs", import.meta.url));
loadEnvFiles();
const dataDir = path.resolve(getDataDir());
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const configPath = path.join(codexHome, "hooks.json");
const marker = "APIRouter Telegram bridge";
const quote = (value) => process.platform === "win32"
  ? `"${value.replaceAll('"', '\\"')}"`
  : `'${value.replaceAll("'", "'\\''")}'`;
const command = `${quote(process.execPath)} ${quote(scriptPath)} --data-dir ${quote(dataDir)}`;

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error(`Cannot read ${configPath}: ${error.message}`);
    process.exit(1);
  }
}
if (!config || typeof config !== "object" || Array.isArray(config)) {
  console.error(`${configPath} must contain a JSON object.`);
  process.exit(1);
}

const hooks = config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks)
  ? { ...config.hooks }
  : {};

for (const eventName of ["PermissionRequest", "Stop", "PostToolUse"]) {
  const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  hooks[eventName] = groups.flatMap((group) => {
    if (!group || !Array.isArray(group.hooks)) return [group];
    const handlers = group.hooks.filter((handler) => handler?.statusMessage !== marker);
    return handlers.length ? [{ ...group, hooks: handlers }] : [];
  });
}

if (action === "install") {
  const definitions = {
    PermissionRequest: 30 * 24 * 60 * 60,
    Stop: 10,
    PostToolUse: 10,
  };
  for (const [eventName, timeout] of Object.entries(definitions)) {
    hooks[eventName].push({
      hooks: [{ type: "command", command, timeout, statusMessage: marker }],
    });
  }
}

config.hooks = hooks;
fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
if (fs.existsSync(configPath)) {
  const backup = `${configPath}.backup-${new Date().toISOString().replaceAll(":", "-")}`;
  fs.copyFileSync(configPath, backup, fs.constants.COPYFILE_EXCL);
  try { fs.chmodSync(backup, 0o600); } catch {}
  console.log(`Backup: ${backup}`);
}
const temporary = `${configPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, configPath);
try { fs.chmodSync(configPath, 0o600); } catch {}
console.log(`${action === "install" ? "Installed" : "Removed"} APIRouter Telegram hooks in ${configPath}`);
console.log("Open /hooks in Codex CLI to inspect and trust the hooks. A running session may need to be resumed.");
