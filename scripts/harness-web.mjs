import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { DATA_DIR } from "../src/lib/dataDir.js";
import { claimRuntime, harnessStateFile, publishRuntime, releaseRuntime, validateLaunchUrl } from "../src/lib/harness/runtime.mjs";
import { applyHarnessThemePatch } from "./patch-harness.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harness = resolve(process.env.APIROUTER_HARNESS_DIR || join(project, "../deepseek-harness"));
const toolchain = join(harness, ".cache/apirouter-toolchain/node_modules");
const nodeBin = join(toolchain, "node-linux-x64/bin");
const pnpmBin = join(toolchain, ".bin");
const stateFile = harnessStateFile(DATA_DIR);
const runId = randomUUID();
const record = { version: 1, ownerPid: process.pid, runId };
const port = process.env.APIROUTER_HARNESS_PORT || "3081";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("APIROUTER_HARNESS_PORT must be between 1 and 65535");
}
if (!existsSync(join(harness, "apps/cli/src/bin.ts"))) {
  throw new Error("Set APIROUTER_HARNESS_DIR to a built deepseek-harness checkout");
}
const env = {
  ...process.env,
  PATH: [nodeBin, pnpmBin, process.env.PATH].join(delimiter),
  DSH_HOME: process.env.DSH_HOME || (existsSync(join(harness, ".cache/dsh-apirouter"))
    ? join(harness, ".cache/dsh-apirouter") : join(DATA_DIR, "harness")),
};
const args = ["dsh", "web", ...process.argv.slice(2), "--host", "127.0.0.1", "--port", port, "--no-open"];
// Ensure theme sync and appearance toggle removal in harness
try { applyHarnessThemePatch(harness); } catch (e) {}

await claimRuntime(stateFile, record);
let child;
let killTimer;
let stopping = false;
let published = false;
let failure = false;
let publishTask = Promise.resolve();
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (!child?.pid) return;
  const kill = (signal) => {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
      } else {
        process.kill(-child.pid, signal);
      }
    } catch (error) {
      if (error.code !== "ESRCH") console.error("[harness] Cannot stop runtime:", error.message);
    }
  };
  kill("SIGTERM");
  killTimer = setTimeout(() => kill("SIGKILL"), 5000);
  killTimer.unref();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const startupTimer = setTimeout(() => {
  failure = true;
  console.error("[harness] Startup timed out. Check the harness build and profile.");
  stop();
}, 120000);
try {
  child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: harness, env, detached: process.platform !== "win32", stdio: ["inherit", "pipe", "pipe"],
  });
  const consume = (stream, output) => {
    const lines = createInterface({ input: stream });
    lines.on("line", (line) => {
      const ready = line.match(/^dsh web: (https?:\/\/\S+)$/);
      if (ready) {
        // The startup URL is a credential. Publish it privately and print only its origin.
        if (published || stopping) return;
        published = true;
        publishTask = (async () => {
          const url = validateLaunchUrl(ready[1]);
          await publishRuntime(stateFile, { ...record, launchUrl: url.href });
          clearTimeout(startupTimer);
          console.log(`[harness] Ready at ${url.origin}. Open APIRouter > Agent.`);
        })().catch(() => {
          failure = true;
          console.error("[harness] Cannot publish the local connection. Check the state file permissions.");
          stop();
        });
      } else {
        output.write(line.replace(/([?&]token=)[^\s&]+/g, "$1[redacted]") + "\n");
      }
    });
  };
  consume(child.stdout, process.stdout);
  consume(child.stderr, process.stderr);
  const code = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode) => resolveExit(exitCode));
  });
  await publishTask;
  process.exitCode = failure ? 1 : stopping ? 0 : (code ?? 1);
} catch (error) {
  console.error("[harness] Launch failed:", error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(startupTimer);
  clearTimeout(killTimer);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await releaseRuntime(stateFile, runId);
}
