import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function setup(t, source) {
  const root = await mkdtemp(join(tmpdir(), "apirouter-harness-launcher-"));
  const harness = join(root, "harness");
  const pnpm = join(harness, ".cache/apirouter-toolchain/node_modules/.bin/pnpm");
  await mkdir(dirname(pnpm), { recursive: true });
  await mkdir(join(harness, "apps/cli/src"), { recursive: true });
  await writeFile(join(harness, "apps/cli/src/bin.ts"), "");
  await writeFile(pnpm, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  const state = join(root, "runtime.json");
  const child = spawn(process.execPath, [join(project, "scripts/harness-web.mjs")], {
    env: { ...process.env, APIROUTER_HARNESS_DIR: harness, DATA_DIR: root,
      APIROUTER_HARNESS_STATE_FILE: state, DSH_HOME: join(root, "home") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exit = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exit;
    await rm(root, { recursive: true, force: true });
  });
  return { child, exit, state, output: () => output };
}

// The launcher uses POSIX process groups; the Windows path uses taskkill instead.
test("launcher publishes readiness privately and cleans up its process on SIGTERM", { skip: process.platform === "win32", timeout: 15000 }, async (t) => {
  const run = await setup(t, `
const server = require("node:http").createServer((req, res) => { res.writeHead(401); res.end(); });
server.listen(0, "127.0.0.1", () => {
  console.log("dsh web: http://127.0.0.1:" + server.address().port + "/?token=never-print-this");
});`);
  let record;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { record = JSON.parse(await readFile(run.state, "utf8")); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (record?.launchUrl) break;
    if (run.child.exitCode !== null) assert.fail(run.output());
    await delay(50);
  }
  assert.ok(record?.launchUrl, run.output());
  assert.ok(!run.output().includes("never-print-this"), "launch token must not reach terminal output");
  assert.equal((await fetch(new URL(record.launchUrl).origin)).status, 401);
  run.child.kill("SIGTERM");
  const [code] = await run.exit;
  assert.equal(code, 0, run.output());
  await assert.rejects(readFile(run.state), { code: "ENOENT" });
  await assert.rejects(fetch(new URL(record.launchUrl).origin));
});

test("launcher propagates startup failure and removes the connection record", { skip: process.platform === "win32", timeout: 15000 }, async (t) => {
  const run = await setup(t, 'console.error("profile failed"); process.exit(7);');
  const [code] = await run.exit;
  assert.equal(code, 7, run.output());
  assert.match(run.output(), /profile failed/);
  await assert.rejects(readFile(run.state), { code: "ENOENT" });
});

test("launcher rejects a remote startup URL without printing its credential", { skip: process.platform === "win32", timeout: 15000 }, async (t) => {
  const run = await setup(t, 'console.log("dsh web: https://remote.example/?token=never-print-this"); setInterval(() => {}, 1000);');
  const [code] = await run.exit;
  assert.equal(code, 1, run.output());
  assert.ok(!run.output().includes("never-print-this"));
  await assert.rejects(readFile(run.state), { code: "ENOENT" });
});
