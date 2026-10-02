#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDataDir, loadEnvFiles } from "./telegram-bot-lib.mjs";
import { getCodexBridgePaths, readCodexBridgeWatches } from "./codex-telegram-bridge-lib.mjs";
import { listApirouterSessions } from "./codex-telegram-sessions.mjs";

loadEnvFiles();
const dataDir = getDataDir();
const paths = getCodexBridgePaths(dataDir);
const hookScript = fileURLToPath(new URL("./codex-telegram-hook.mjs", import.meta.url));

try {
  if (Date.now() - fs.statSync(paths.heartbeat).mtimeMs >= 10_000) throw new Error("Bot heartbeat is stale");
} catch {
  console.error(`No recent Codex bridge heartbeat at ${paths.heartbeat}.`);
  console.error("Restart the APIRouter Telegram bot so it loads the current source. An older bundled bot may still answer Telegram but cannot run the Codex bridge.");
  console.error("If using a packaged APIRouter CLI, rebuild and reinstall it first.");
  process.exit(1);
}

const watched = Object.values(readCodexBridgeWatches(paths))
  .filter((watch) => watch?.sessionId)
  .sort((left, right) => Date.parse(right.watchedAt) - Date.parse(left.watchedAt))
  .map((watch) => watch.sessionId);
const sessions = new Map(listApirouterSessions().map((candidate) => [candidate.id, candidate]));
const session = watched.map((id) => sessions.get(id)).find(Boolean);
if (!session) {
  console.error("No APIRouter Codex session is selected in Telegram.");
  console.error("Open a Codex CLI session using APIRouter, send /codex to the bot, and choose that session before running this check.");
  process.exit(1);
}
const common = {
  session_id: session.id,
  transcript_path: session.transcriptPath,
  cwd: session.cwd,
  bridge_diagnostic: true,
};

function invokeHook(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookScript, "--data-dir", dataDir], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(stderr || `Hook exited with code ${code}`));
      else resolve(stdout.trim());
    });
    child.stdin.end(`${JSON.stringify({ ...common, ...input })}\n`);
  });
}

console.log(`Diagnostic for selected session: ${session.id}`);
await invokeHook({
  hook_event_name: "Stop",
  last_assistant_message: "Codex Telegram bridge check: final response received. No files were changed.",
});
console.log("Simulated Stop handled silently; it does not change /codex output.");

await invokeHook({
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  tool_response: "Process exited with code 7",
});
console.log("Queued a simulated PostToolUse failure. Telegram should receive a warning.");

console.log("Waiting for a simulated approval. Tap Allow or Deny in Telegram.");
console.log("This approval does not execute a command.");
const answer = await invokeHook({
  hook_event_name: "PermissionRequest",
  tool_name: "Bash",
  tool_input: {
    description: "Bridge diagnostic only; no command will run",
    command: "printf 'Codex Telegram bridge check'",
  },
});
console.log(`Codex hook output: ${answer}`);
console.log("Use /codex output in Telegram to view the session's actual latest assistant output.");
