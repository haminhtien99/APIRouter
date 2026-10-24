import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Resolve the private connection record shared by the launcher and dashboard. */
export function harnessStateFile(dataDir) {
  return process.env.APIROUTER_HARNESS_STATE_FILE || join(dataDir, "harness-web.json");
}

/** Accept only a local harness launch URL; this integration does not publish remote agents. */
export function validateLaunchUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.hash
    || url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")) {
    throw new Error("Invalid local harness launch URL");
  }
  return url;
}

/** EPERM means the process exists but belongs to another user. */
export function processExists(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Missing records are normal before startup; malformed or unreadable records are errors. */
export async function readRuntime(file) {
  try {
    const record = JSON.parse(await readFile(file, "utf8"));
    if (record.version !== 1 || typeof record.runId !== "string"
      || !Number.isSafeInteger(record.ownerPid) || record.ownerPid <= 0) {
      throw new Error("Invalid harness connection record");
    }
    if (record.launchUrl !== undefined) validateLaunchUrl(record.launchUrl);
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Exclusively reserve the runtime record so two launchers cannot replace a live agent. */
export async function claimRuntime(file, record) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readRuntime(file);
    if (existing && processExists(existing.ownerPid)) throw new Error("A harness launcher is already running");
    throw new Error(`A stale harness connection remains at ${file}. Remove it after checking that the launcher has stopped.`);
  }
  try {
    await handle.writeFile(JSON.stringify(record) + "\n");
  } finally {
    await handle.close();
  }
}

/** Atomically publish readiness without exposing a partially written credential. */
export async function publishRuntime(file, record) {
  const current = await readRuntime(file);
  if (current?.runId !== record.runId) throw new Error("Harness connection record changed");
  const temporary = `${file}.${record.runId}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record) + "\n");
    await handle.close();
    await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/** A retiring launcher removes only its own connection record. */
export async function releaseRuntime(file, runId) {
  const current = await readRuntime(file);
  if (current?.runId === runId) await unlink(file);
}

/** Probe without sending the launch token or following an authentication redirect. */
export async function runtimeStatus(file, { fetchImpl = fetch, alive = processExists } = {}) {
  const record = await readRuntime(file);
  if (!record || !alive(record.ownerPid)) return { status: "stopped" };
  if (!record.launchUrl) return { status: "starting" };
  const url = validateLaunchUrl(record.launchUrl);
  try {
    const response = await fetchImpl(url.origin + "/", {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    await response.body?.cancel();
    if (![200, 302, 303, 307, 401].includes(response.status)) return { status: "unavailable" };
    return { status: "ready", launchUrl: url.href };
  } catch {
    return { status: "unavailable" };
  }
}
