import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { connect as netConnect } from "node:net";
import { existsSync, mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { DATA_DIR } from "../src/lib/dataDir.mjs";
import { claimRuntime, harnessStateFile, publishRuntime, releaseRuntime, validateLaunchUrl, readRuntime, processExists } from "../src/lib/harness/runtime.mjs";
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
const internalPort = process.env.APIROUTER_HARNESS_INTERNAL_PORT || String(Number(port) + 1);
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error("APIROUTER_HARNESS_PORT must be between 1 and 65535");
}
if (!existsSync(join(harness, "apps/cli/src/bin.ts"))) {
  throw new Error("Set APIROUTER_HARNESS_DIR to a built deepseek-harness checkout");
}

const dshHome = process.env.DSH_HOME || (existsSync(join(harness, ".cache/dsh-apirouter"))
  ? join(harness, ".cache/dsh-apirouter") : join(DATA_DIR, "harness"));

// Pre-create DSH_HOME profile directory so mkdirSync in profile.ts never throws ENOENT
try {
  mkdirSync(join(dshHome, "profiles", "web"), { recursive: true });
} catch {}

const env = {
  ...process.env,
  PATH: [nodeBin, pnpmBin, process.env.PATH].join(delimiter),
  DSH_HOME: dshHome,
};

const pnpmExe = existsSync(join(pnpmBin, process.platform === "win32" ? "pnpm.cmd" : "pnpm"))
  ? join(pnpmBin, process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  : (process.platform === "win32" ? "pnpm.cmd" : "pnpm");

const args = ["dsh", "web", ...process.argv.slice(2), "--host", "127.0.0.1", "--port", internalPort, "--no-open"];

// Ensure theme sync and appearance toggle removal in harness
try { applyHarnessThemePatch(harness); } catch (e) {}

try {
  await claimRuntime(stateFile, record);
} catch (error) {
  if (error.message.includes("stale harness connection")) {
    const existing = await readRuntime(stateFile).catch(() => null);
    if (!existing || !processExists(existing.ownerPid)) {
      console.warn(`[harness] Found stale connection record (process ${existing?.ownerPid ?? "unknown"} is stopped). Cleaning up and resuming...`);
      try {
        await unlink(stateFile);
        await claimRuntime(stateFile, record);
      } catch {
        throw new Error(`A stale harness connection remains at ${stateFile} (process ${existing?.ownerPid ?? "unknown"} is stopped). Please remove it by running: rm ${stateFile}`);
      }
    } else {
      throw error;
    }
  } else {
    throw error;
  }
}

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
  try { proxyServer?.close(); } catch {} 
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


function isPrivatePeerIp(ip) {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip.endsWith("127.0.0.1")) return true;
  const cleanIp = ip.replace(/^.*:/, "");
  return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/.test(cleanIp);
}

let proxyServer = null;
try {
  proxyServer = createServer((req, res) => {
    const peerIp = req.socket?.remoteAddress || "";
    if (!isPrivatePeerIp(peerIp)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: Harness Agent is accessible only from local network (LAN).");
      return;
    }
    const targetUrl = new URL(req.url, `http://127.0.0.1:${internalPort}`);
    const clientReq = httpRequest(
      {
        hostname: "127.0.0.1",
        port: Number(internalPort),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${internalPort}`,
        },
      },
      (targetRes) => {
        res.writeHead(targetRes.statusCode, targetRes.headers);
        targetRes.pipe(res);
      }
    );
    clientReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway: " + (err.message || "Harness service unreachable"));
      }
    });
    req.pipe(clientReq);
  });

  proxyServer.on("upgrade", (req, socket, head) => {
    const peerIp = socket.remoteAddress || "";
    if (!isPrivatePeerIp(peerIp)) {
      socket.destroy();
      return;
    }
    const targetSocket = netConnect(Number(internalPort), "127.0.0.1", () => {
      let headers = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const key = req.rawHeaders[i];
        let val = req.rawHeaders[i + 1];
        if (key.toLowerCase() === "host") {
          val = `127.0.0.1:${internalPort}`;
        }
        headers += `${key}: ${val}\r\n`;
      }
      headers += "\r\n";
      targetSocket.write(headers);
      if (head && head.length) targetSocket.write(head);
      targetSocket.pipe(socket);
      socket.pipe(targetSocket);
    });
    targetSocket.on("error", () => socket.destroy());
    socket.on("error", () => targetSocket.destroy());
  });

  proxyServer.listen(Number(port), "0.0.0.0", () => {
    console.log(`[harness-proxy] Listening on 0.0.0.0:${port} -> 127.0.0.1:${internalPort}`);
  });
  proxyServer.on("error", (err) => {
    console.warn(`[harness-proxy] Warning: Failed to bind proxy on 0.0.0.0:${port}:`, err.message);
  });
} catch (e) {
  console.warn(`[harness-proxy] Notice: Proxy initialization skipped:`, e.message);
}

try {
  child = spawn(pnpmExe, args, {
    cwd: harness, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });

  const consume = (stream, output) => {
    const lines = createInterface({ input: stream });
    lines.on("line", (rawLine) => {
      // Clean ANSI escape sequences and trim carriage return / whitespace
      const cleanLine = rawLine.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").trim();
      const ready = cleanLine.match(/dsh web:\s+(https?:\/\/\S+)/);
      if (ready) {
        // The startup URL is a credential. Publish it privately and print only its origin.
        if (published || stopping) return;
        published = true;
        publishTask = (async () => {
          const url = validateLaunchUrl(ready[1]);
          url.port = port;
          await publishRuntime(stateFile, { ...record, launchUrl: url.href });
          clearTimeout(startupTimer);
          console.log(`[harness] Ready at ${url.origin}. Open APIRouter > Agent.`);
        })().catch((err) => {
          failure = true;
          console.error("[harness] Cannot publish the local connection:", err?.message || err);
          stop();
        });
      } else {
        output.write(cleanLine.replace(/([?&]token=)[^\s&]+/g, "$1[redacted]") + "\n");
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
