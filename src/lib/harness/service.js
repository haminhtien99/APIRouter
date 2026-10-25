import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "@/lib/dataDir.js";
import {
  harnessStateFile,
  runtimeStatus,
  readRuntime,
  processExists,
} from "./runtime.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
let managedChild = null;
let lastHarnessError = null;

export async function getHarnessStatus() {
  const stateFile = harnessStateFile(DATA_DIR);
  const status = await runtimeStatus(stateFile);
  if (status.status === "stopped" || status.status === "unavailable") {
    if (lastHarnessError) {
      status.error = lastHarnessError;
    }
  }
  return status;
}

export async function startHarnessService() {
  lastHarnessError = null;
  const stateFile = harnessStateFile(DATA_DIR);
  const currentStatus = await runtimeStatus(stateFile);

  if (currentStatus.status === "ready" || currentStatus.status === "starting") {
    return currentStatus;
  }

  // If a stale file exists, clean it up
  const existing = await readRuntime(stateFile).catch(() => null);
  if (existing && !processExists(existing.ownerPid)) {
    await unlink(stateFile).catch(() => {});
  }

  const scriptPath = join(projectRoot, "scripts", "harness-web.mjs");
  if (!existsSync(scriptPath)) {
    throw new Error(`Launcher script not found at ${scriptPath}`);
  }

  // Spawn the launcher in the background
  const child = spawn(process.execPath, [scriptPath], {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.log("[harness]:", text);
  });

  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      // Don't treat harmless socks warnings as fatal errors
      if (!text.includes("all_proxy names a SOCKS proxy")) {
        lastHarnessError = text;
      }
      console.error("[harness stderr]:", text);
    }
  });

  child.on("error", (err) => {
    lastHarnessError = err.message;
    console.error("[harness-service] Failed to start:", err);
  });

  child.on("exit", (code) => {
    if (managedChild === child) {
      managedChild = null;
    }
    if (code !== 0 && code !== null) {
      if (!lastHarnessError) {
        lastHarnessError = `Harness process exited with code ${code}`;
      }
    } else {
      lastHarnessError = null;
    }
  });

  child.unref();
  managedChild = child;

  return { status: "starting" };
}

export async function stopHarnessService() {
  lastHarnessError = null;
  const stateFile = harnessStateFile(DATA_DIR);
  const record = await readRuntime(stateFile).catch(() => null);

  if (record && Number.isSafeInteger(record.ownerPid) && record.ownerPid > 0) {
    const pid = record.ownerPid;
    if (processExists(pid)) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
        } else {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            process.kill(pid, "SIGTERM");
          }
        }
      } catch (e) {
        console.error("[harness-service] Failed to signal process:", e);
      }
    }
  }

  await unlink(stateFile).catch(() => {});
  if (managedChild) {
    try {
      managedChild.kill("SIGTERM");
    } catch {}
    managedChild = null;
  }

  return { status: "stopped" };
}
