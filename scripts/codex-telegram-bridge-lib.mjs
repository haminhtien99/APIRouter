import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getBridgeDataDir(env = process.env) {
  if (env.DATA_DIR) return env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "apirouter");
  }
  return path.join(os.homedir(), ".apirouter");
}

export function getCodexBridgePaths(dataDir = getBridgeDataDir()) {
  const root = path.join(dataDir, "telegram-bot", "codex-bridge");
  return {
    root,
    heartbeat: path.join(root, "bot-heartbeat"),
    events: path.join(root, "events"),
    decisions: path.join(root, "decisions"),
    state: path.join(root, "state"),
    lastStops: path.join(root, "last-stops"),
    watches: path.join(root, "watches.json"),
  };
}

export function ensureCodexBridgePaths(paths) {
  for (const directory of [paths.root, paths.events, paths.decisions, paths.state, paths.lastStops]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(directory, 0o700); } catch {}
  }
}

export function codexLastStopFile(paths, sessionId) {
  const name = crypto.createHash("sha256").update(String(sessionId)).digest("hex");
  return path.join(paths.lastStops, `${name}.json`);
}

export function codexBridgeFile(directory, id) {
  if (!EVENT_ID.test(String(id))) throw new Error("Invalid Codex bridge event ID");
  return path.join(directory, `${id}.json`);
}

export function writeCodexBridgeJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function readCodexBridgeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function readCodexBridgeWatches(paths) {
  const value = readCodexBridgeJson(paths.watches);
  return value?.chats && typeof value.chats === "object" ? value.chats : {};
}

export function isCodexSessionWatched(paths, sessionId) {
  return Object.values(readCodexBridgeWatches(paths))
    .some((watch) => watch?.sessionId === sessionId);
}

export function createCodexBridgeDecision(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  try {
    fs.linkSync(temporary, filePath);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

export function removeCodexBridgeFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
