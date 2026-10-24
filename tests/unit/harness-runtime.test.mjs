import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimRuntime, publishRuntime, readRuntime, releaseRuntime, runtimeStatus, validateLaunchUrl,
} from "../../src/lib/harness/runtime.mjs";

const launchUrl = "http://127.0.0.1:3081/?token=private-test-credential";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "apirouter-harness-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "harness-web.json");
}

test("launch URLs accept loopback and reject remote URLs, userinfo, paths and duplicate tokens", () => {
  assert.equal(validateLaunchUrl(launchUrl).port, "3081");
  assert.equal(validateLaunchUrl("http://localhost:3081/?token=test").hostname, "localhost");
  for (const value of [
    "https://127.0.0.1/?token=x", "http://example.com/?token=x",
    "http://127.0.0.1.evil.test/?token=x", "http://user@127.0.0.1/?token=x",
    "http://127.0.0.1/path?token=x", "http://127.0.0.1/?token=x&token=y",
    "http://127.0.0.1/", "http://127.0.0.1/?token=",
  ]) assert.throws(() => validateLaunchUrl(value), undefined, value);
});

test("a live launcher keeps exclusive ownership and publishes an owner-only credential", async (t) => {
  const file = await fixture(t);
  const record = { version: 1, runId: "run-one", ownerPid: process.pid };
  await claimRuntime(file, record);
  await assert.rejects(claimRuntime(file, { ...record, runId: "run-two" }), /already running/);
  assert.deepEqual(await runtimeStatus(file), { status: "starting" });
  await publishRuntime(file, { ...record, launchUrl });
  assert.equal((await readRuntime(file)).launchUrl, launchUrl);
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  await releaseRuntime(file, "run-two");
  assert.ok(await readRuntime(file), "another launcher cannot remove this connection");
  await releaseRuntime(file, record.runId);
  assert.equal(await readRuntime(file), null);
});

test("probes do not send credentials and do not follow redirects", async (t) => {
  const file = await fixture(t);
  await claimRuntime(file, { version: 1, runId: "probe", ownerPid: process.pid, launchUrl });
  let cancelled = false;
  const result = await runtimeStatus(file, { fetchImpl: async (url, options) => {
    assert.equal(url, "http://127.0.0.1:3081/");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return { status: 401, body: { cancel: async () => { cancelled = true; } } };
  } });
  assert.deepEqual(result, { status: "ready", launchUrl });
  assert.equal(cancelled, true);
});

test("stopped, failed and unexpected upstream responses never return the launch token", async (t) => {
  const file = await fixture(t);
  assert.deepEqual(await runtimeStatus(file), { status: "stopped" });
  await claimRuntime(file, { version: 1, runId: "offline", ownerPid: process.pid, launchUrl });
  assert.deepEqual(await runtimeStatus(file, { alive: () => false }), { status: "stopped" });
  assert.deepEqual(await runtimeStatus(file, { fetchImpl: async () => { throw new Error("offline"); } }), { status: "unavailable" });
  assert.deepEqual(await runtimeStatus(file, { fetchImpl: async () => ({ status: 500 }) }), { status: "unavailable" });
});

test("damaged records fail explicitly without being overwritten", async (t) => {
  const file = await fixture(t);
  await writeFile(file, "{invalid");
  await assert.rejects(readRuntime(file));
  await assert.rejects(claimRuntime(file, { version: 1, runId: "new", ownerPid: process.pid }));
  assert.equal(await readFile(file, "utf8"), "{invalid");
});

test("a stale record requires explicit cleanup so concurrent launchers cannot delete each other's reservation", async (t) => {
  const file = await fixture(t);
  const stale = { version: 1, runId: "stale", ownerPid: 2147483647 };
  await writeFile(file, JSON.stringify(stale));
  await assert.rejects(claimRuntime(file, { ...stale, ownerPid: process.pid, runId: "new" }), /stale harness connection/);
  assert.deepEqual(await readRuntime(file), stale);
});

test("publishing after ownership changes cannot overwrite the new runtime", async (t) => {
  const file = await fixture(t);
  const record = { version: 1, runId: "new", ownerPid: process.pid };
  await claimRuntime(file, record);
  await assert.rejects(publishRuntime(file, { ...record, runId: "old", launchUrl }), /changed/);
  assert.deepEqual(await readRuntime(file), record);
});
