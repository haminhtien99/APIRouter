import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCodexTelegramBridge } from "../../scripts/codex-telegram-bot.mjs";
import { codexLastStopFile, ensureCodexBridgePaths, getCodexBridgePaths, readCodexBridgeJson } from "../../scripts/codex-telegram-bridge-lib.mjs";
import { listApirouterSessions } from "../../scripts/codex-telegram-sessions.mjs";
import { escapeHtml } from "../../scripts/telegram-bot-lib.mjs";

const hookScript = fileURLToPath(new URL("../../scripts/codex-telegram-hook.mjs", import.meta.url));

function startHook(dataDir, input) {
  const child = spawn(process.execPath, [hookScript, "--data-dir", dataDir], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `Hook exited with code ${code}`));
      else resolve(stdout.trim());
    });
  });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  return { child, done };
}

async function waitFor(condition, timeoutMs = 5_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for Codex hook event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function activeSession(context, dataDir, { latestOutput = "" } = {}) {
  const id = crypto.randomUUID();
  const codexHome = path.join(dataDir, "codex-home");
  const sessionsDir = path.join(codexHome, "sessions", "fixture");
  const locksDir = path.join(codexHome, "thread-writer-locks");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(locksDir, { recursive: true });
  const transcriptPath = path.join(sessionsDir, `rollout-${id}.jsonl`);
  const lines = [
    { type: "session_meta", payload: { id, cwd: "/workspace", model_provider: "apirouter" } },
  ];
  if (latestOutput) lines.push({
    type: "response_item",
    payload: { role: "assistant", content: [{ type: "output_text", text: latestOutput }] },
  });
  fs.writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const lock = spawn("flock", [
    "-F", path.join(locksDir, `${id}.lock`),
    "sh", "-c", "printf ready; exec sleep 60",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => { if (lock.exitCode === null) lock.kill(); });
  let ready = false;
  lock.stdout.on("data", () => { ready = true; });
  await waitFor(() => ready || lock.exitCode !== null);
  assert.equal(ready, true, "Codex writer lock fixture did not start");
  return { id, codexHome, transcriptPath };
}

test("Stop result remains viewable without an automatic Telegram message", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-codex-stop-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const session = await activeSession(context, dataDir, { latestOutput: "Actual latest output." });
  const messages = [];
  const bridge = createCodexTelegramBridge({
    dataDir,
    codexHome: session.codexHome,
    telegram: async () => ({}),
    send: async (_chatId, text) => { messages.push(text); },
    isAuthenticated: async () => true,
    sessionStore: { list: () => [{ chatId: "123", chatType: "private" }] },
    escapeHtml,
  });
  assert.equal(bridge.watch("123", session.id), true);
  const output = await startHook(dataDir, {
    hook_event_name: "Stop",
    session_id: session.id,
    transcript_path: session.transcriptPath,
    cwd: "/workspace",
    last_assistant_message: "Updated the config file.",
  }).done;
  assert.equal(output, "{}");

  const paths = getCodexBridgePaths(dataDir);
  const saved = readCodexBridgeJson(codexLastStopFile(paths, session.id));
  assert.equal(saved.detail, "Updated the config file.");

  await bridge.poll();
  assert.equal(messages.length, 0);
  assert.equal(bridge.lastStop(session.id)?.detail, "Updated the config file.");
  assert.equal(bridge.latestOutput(session.id)?.text, "Actual latest output.");
  assert.equal(fs.readdirSync(paths.events).length, 0);
});

test("PostToolUse reports a nonzero exit code and ignores a successful tool", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-codex-tool-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const session = await activeSession(context, dataDir);
  const paths = getCodexBridgePaths(dataDir);
  await startHook(dataDir, {
    hook_event_name: "PostToolUse",
    session_id: session.id,
    transcript_path: session.transcriptPath,
    tool_name: "Bash",
    tool_response: "Process exited with code 0",
  }).done;
  assert.equal(fs.existsSync(paths.events), false);

  await startHook(dataDir, {
    hook_event_name: "PostToolUse",
    session_id: session.id,
    transcript_path: session.transcriptPath,
    tool_name: "Bash",
    tool_response: "Process exited with code 7",
  }).done;
  const names = fs.readdirSync(paths.events);
  assert.equal(names.length, 1);
  assert.equal(readCodexBridgeJson(path.join(paths.events, names[0])).detail, "Tool exited with code 7");
});

test("PermissionRequest returns the Telegram decision to the waiting hook", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-codex-permission-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const session = await activeSession(context, dataDir);
  const paths = getCodexBridgePaths(dataDir);
  ensureCodexBridgePaths(paths);
  fs.writeFileSync(paths.heartbeat, "bot\n", { mode: 0o600 });

  const sent = [];
  const bridge = createCodexTelegramBridge({
    dataDir,
    codexHome: session.codexHome,
    telegram: async () => ({}),
    send: async (chatId, text, markup) => { sent.push({ chatId, text, markup }); },
    isAuthenticated: async () => true,
    sessionStore: { list: () => [{ chatId: "123", chatType: "private" }] },
    escapeHtml,
  });
  assert.equal(bridge.watch("123", session.id), true);
  const { child, done } = startHook(dataDir, {
    hook_event_name: "PermissionRequest",
    session_id: session.id,
    transcript_path: session.transcriptPath,
    cwd: "/workspace",
    tool_name: "Bash",
    tool_input: { command: "printf 'check'" },
  });
  context.after(() => { if (child.exitCode === null) child.kill(); });
  await waitFor(() => fs.readdirSync(paths.events).length === 1);

  await bridge.poll();
  assert.equal(sent.length, 1);
  const denyButton = sent[0].markup.inline_keyboard[0][1];
  assert.match(denyButton.callback_data, /^codex:deny:/);

  await bridge.handleCallback({
    data: denyButton.callback_data,
    message: { chat: { id: "123", type: "private" }, message_id: 10 },
  });
  const output = JSON.parse(await done);
  assert.deepEqual(output.hookSpecificOutput.decision, {
    behavior: "deny",
    message: "Denied from APIRouter Telegram.",
  });
  assert.equal(fs.readdirSync(paths.events).length, 0);
});

test("Session list excludes a closed writer and includes an active session in another folder", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-codex-active-"));
  context.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const session = await activeSession(context, dataDir);
  assert.deepEqual(listApirouterSessions({ codexHome: session.codexHome }).map((item) => item.id), [session.id]);
});
