import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import pkg from "../../../../package.json" with { type: "json" };

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const CACHE_MS = 5 * 60 * 1000;
let cached = null;
let pending = null;

function checkoutRoot() {
  let directory = path.resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(path.join(directory, ".git")) && existsSync(path.join(directory, "scripts", "update-checkout.mjs"))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function readVersionStatus() {
  const root = checkoutRoot();
  if (!root) {
    return { currentVersion: pkg.version, latestVersion: null, hasUpdate: false, updateMode: "local" };
  }

  try {
    const script = path.join(root, "scripts", "update-checkout.mjs");
    const { stdout } = await execFileAsync(process.execPath, [script, "status"], {
      cwd: root,
      timeout: 16000,
      maxBuffer: 128 * 1024,
    });
    const result = JSON.parse(stdout);
    return {
      ...result,
      currentVersion: pkg.version,
      updateMode: "git",
    };
  } catch {
    return { currentVersion: pkg.version, latestVersion: null, hasUpdate: false, updateMode: "git", status: "unavailable" };
  }
}

export async function GET(request) {
  const refresh = new URL(request.url).searchParams.has("refresh");
  if (refresh || !cached || Date.now() - cached.checkedAt >= CACHE_MS) {
    if (!pending) {
      pending = readVersionStatus()
        .then((value) => {
          cached = { value, checkedAt: Date.now() };
          return value;
        })
        .finally(() => { pending = null; });
    }
    return Response.json(await pending, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(cached.value, { headers: { "Cache-Control": "no-store" } });
}
