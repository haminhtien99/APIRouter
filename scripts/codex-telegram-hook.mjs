#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  codexBridgeFile,
  codexLastStopFile,
  ensureCodexBridgePaths,
  getCodexBridgePaths,
  isCodexSessionWatched,
  readCodexBridgeJson,
  removeCodexBridgeFile,
  writeCodexBridgeJson,
} from "./codex-telegram-bridge-lib.mjs";
import { readCodexSessionMeta } from "./codex-telegram-sessions.mjs";

const dataDirArgument = process.argv.indexOf("--data-dir");
const paths = getCodexBridgePaths(dataDirArgument >= 0 ? process.argv[dataDirArgument + 1] : undefined);
const HEARTBEAT_MS = 10_000;
const DECISION_POLL_MS = 500;
let outputWritten = false;

function writeOutput(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  outputWritten = true;
}

function short(value, limit) {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function toolDetail(input) {
  const toolInput = input.tool_input;
  const description = typeof toolInput?.description === "string" ? toolInput.description.trim() : "";
  const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
  const raw = command || (toolInput == null ? "" : JSON.stringify(toolInput, null, 2));
  return short([description, raw].filter(Boolean).join("\n\n"), 2800);
}

function toolFailure(input) {
  const result = input.tool_response;
  const object = result && typeof result === "object" ? result : null;
  if (object?.isError === true || object?.is_error === true || object?.success === false || ["error", "failed"].includes(object?.status)) {
    return "Tool returned an error";
  }
  for (const code of [object?.exitCode, object?.exit_code, object?.code, object?.metadata?.exit_code]) {
    const number = typeof code === "number" || (typeof code === "string" && /^\d+$/.test(code))
      ? Number(code)
      : NaN;
    if (Number.isInteger(number) && number !== 0) return `Tool exited with code ${number}`;
  }
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
  const processExit = text.match(/\bProcess exited with code\s*(\d+)\b/i);
  if (processExit) return Number(processExit[1]) ? `Tool exited with code ${processExit[1]}` : null;
  const exit = text.match(/(?:^|\n)Exit code:\s*(\d+)\b/i);
  if (exit && Number(exit[1])) return `Tool exited with code ${exit[1]}`;
  return null;
}

function buildEvent(input) {
  const common = {
    id: crypto.randomUUID(),
    sessionId: short(input.session_id || "unknown", 100),
    turnId: short(input.turn_id || "", 100),
    cwd: short(input.cwd || "", 400),
    createdAt: new Date().toISOString(),
  };
  if (input.hook_event_name === "PermissionRequest") {
    return {
      ...common,
      type: "permission",
      toolName: short(input.tool_name || "tool", 100),
      detail: toolDetail(input),
    };
  }
  if (input.hook_event_name === "Stop") {
    return {
      ...common,
      type: "stop",
      detail: short(input.last_assistant_message || "Codex stopped without a final message.", 2800),
    };
  }
  if (input.hook_event_name === "PostToolUse") {
    const failure = toolFailure(input);
    if (!failure) return null;
    return {
      ...common,
      type: "tool-error",
      toolName: short(input.tool_name || "tool", 100),
      detail: failure,
    };
  }
  return null;
}

function botIsRunning() {
  try {
    return Date.now() - fs.statSync(paths.heartbeat).mtimeMs < 10_000;
  } catch {
    return false;
  }
}

async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk.toString("utf8");
    if (raw.length > 2_000_000) throw new Error("Codex hook input is too large");
  }
  return JSON.parse(raw);
}

async function waitForDecision(eventFile, decisionFile) {
  let lastHeartbeat = 0;
  while (true) {
    const reply = readCodexBridgeJson(decisionFile);
    if (reply?.decision === "allow" || reply?.decision === "deny") return reply.decision;
    const event = readCodexBridgeJson(eventFile);
    if (!event || !isCodexSessionWatched(paths, event.sessionId)) return null;
    if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
      const now = new Date();
      fs.utimesSync(eventFile, now, now);
      lastHeartbeat = Date.now();
    }
    await sleep(DECISION_POLL_MS);
  }
}

async function main() {
  const input = await readInput();
  const event = buildEvent(input);
  if (!event) {
    if (input.hook_event_name === "Stop") writeOutput({});
    return;
  }
  const session = readCodexSessionMeta(input.transcript_path);
  if (session?.modelProvider !== "apirouter" || session.id !== event.sessionId) {
    if (event.type === "permission" || event.type === "stop") writeOutput({});
    return;
  }
  if (event.type === "permission" && (!botIsRunning() || !isCodexSessionWatched(paths, event.sessionId))) {
    writeOutput({});
    return;
  }
  ensureCodexBridgePaths(paths);
  const eventFile = codexBridgeFile(paths.events, event.id);
  const decisionFile = codexBridgeFile(paths.decisions, event.id);
  if (event.type === "stop" && input.bridge_diagnostic !== true) {
    writeCodexBridgeJson(codexLastStopFile(paths, event.sessionId), event);
  }
  if (event.type === "stop") {
    writeOutput({});
    return;
  }
  writeCodexBridgeJson(eventFile, event);
  if (event.type !== "permission") {
    return;
  }

  try {
    const decision = await waitForDecision(eventFile, decisionFile);
    writeOutput(decision ? {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: decision === "allow"
          ? { behavior: "allow" }
          : { behavior: "deny", message: "Denied from APIRouter Telegram." },
      },
    } : {});
  } finally {
    removeCodexBridgeFile(eventFile);
    removeCodexBridgeFile(decisionFile);
  }
}

main().catch((error) => {
  console.error(`[Codex Telegram hook] ${error.message}`);
  if (!outputWritten) writeOutput({});
  // An undecided PermissionRequest returns to Codex's native approval prompt.
});
