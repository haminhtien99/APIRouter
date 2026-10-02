import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_FILE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const SESSION_INDEX_TAIL_BYTES = 8 * 1024 * 1024;

export function getCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function activeCodexSessionIds(codexHome) {
  const lockDir = path.join(codexHome, "thread-writer-locks");
  let entries;
  try { entries = fs.readdirSync(lockDir, { withFileTypes: true }); } catch { return new Set(); }
  const ids = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".lock")) continue;
    const id = entry.name.slice(0, -5);
    if (!SESSION_ID.test(id)) continue;
    if (process.platform === "linux") {
      // Codex keeps this file locked while the thread writer is alive.
      // A leftover file without a lock is a closed session.
      const probe = spawnSync("flock", [
        "--nonblock", "--conflict-exit-code", "75",
        path.join(lockDir, entry.name), "true",
      ], { stdio: "ignore", timeout: 1000 });
      if (probe.status !== 75) continue;
    }
    ids.add(id);
  }
  return ids;
}

function readCodexSessionNames(codexHome, activeIds) {
  const names = new Map();
  let handle;
  try {
    handle = fs.openSync(path.join(codexHome, "session_index.jsonl"), "r");
    const size = fs.fstatSync(handle).size;
    const offset = Math.max(0, size - SESSION_INDEX_TAIL_BYTES);
    const buffer = Buffer.alloc(size - offset);
    const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, offset);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    if (offset > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0 && names.size < activeIds.size; index -= 1) {
      let entry;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (!activeIds.has(entry?.id) || names.has(entry.id)) continue;
      const name = String(entry.thread_name || "").replace(/\s+/g, " ").trim();
      if (name) names.set(entry.id, [...name].slice(0, 120).join(""));
    }
  } catch {}
  finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return names;
}

export function readCodexSessionMeta(transcriptPath) {
  if (!transcriptPath || path.extname(transcriptPath) !== ".jsonl") return null;
  let handle;
  try {
    handle = fs.openSync(transcriptPath, "r");
    const buffer = Buffer.alloc(256 * 1024);
    const size = fs.readSync(handle, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, size).indexOf(10);
    if (end < 0) return null;
    const line = JSON.parse(buffer.subarray(0, end).toString("utf8"));
    if (line.type !== "session_meta") return null;
    const payload = line.payload || {};
    const id = payload.session_id || payload.id;
    if (!SESSION_ID.test(String(id))) return null;
    return {
      id,
      cwd: String(payload.cwd || ""),
      modelProvider: String(payload.model_provider || ""),
      transcriptPath,
      startedAt: String(payload.timestamp || line.timestamp || ""),
    };
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

export function listApirouterSessions({
  codexHome = getCodexHome(),
} = {}) {
  const activeIds = activeCodexSessionIds(codexHome);
  if (!activeIds.size) return [];
  const names = readCodexSessionNames(codexHome, activeIds);
  const root = path.join(codexHome, "sessions");
  const candidates = [];
  const directories = [root];
  while (directories.length) {
    const directory = directories.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(file);
      } else if (entry.isFile()) {
        const match = entry.name.match(SESSION_FILE);
        if (!match || !activeIds.has(match[1])) continue;
        try {
          const modifiedAt = fs.statSync(file).mtimeMs;
          candidates.push({ file, modifiedAt });
        } catch {}
      }
    }
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const sessions = [];
  for (const candidate of candidates) {
    const meta = readCodexSessionMeta(candidate.file);
    if (meta?.modelProvider !== "apirouter" || !activeIds.has(meta.id)) continue;
    sessions.push({
      ...meta,
      name: names.get(meta.id) || path.basename(meta.cwd) || `Session ${meta.id.slice(0, 8)}`,
      lastActivityAt: new Date(candidate.modifiedAt).toISOString(),
    });
  }
  return sessions;
}

export function readLatestCodexOutput(transcriptPath, maxBytes = 1024 * 1024) {
  let handle;
  try {
    handle = fs.openSync(transcriptPath, "r");
    const size = fs.fstatSync(handle).size;
    const offset = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(handle, buffer, 0, buffer.length, offset);
    const lines = buffer.toString("utf8").split("\n");
    if (offset > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      let item;
      try { item = JSON.parse(lines[index]); } catch { continue; }
      if (item.type !== "response_item" || item.payload?.role !== "assistant") continue;
      const text = (item.payload.content || [])
        .map((part) => typeof part?.text === "string" ? part.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return { text, phase: item.payload.phase || "" };
    }
  } catch {}
  finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return null;
}
