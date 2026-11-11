import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import nextConfig from "../../next.config.mjs";

const require = createRequire(import.meta.url);
const projectFile = (name) => new URL(`../../${name}`, import.meta.url);

test("the router no longer exposes embedded agent entry points", () => {
  for (const name of [
    "src/app/(dashboard)/dashboard/agent/page.js",
    "src/app/api/harness/route.js",
    "src/app/api/agent/sessions/route.js",
    "src/app/remote/agent/page.js",
    "src/app/remote/agent/api/exchange/route.js",
    "src/lib/harness/service.js",
    "scripts/harness-web.mjs",
    "scripts/prepare-harness.mjs",
    "engine/harness/package.json",
    "engine/harness-minimal/package.json",
  ]) {
    assert.equal(existsSync(projectFile(name)), false, name);
  }
});

test("the API rewrites remain available without the engine-specific alias", async () => {
  const rewrites = await nextConfig.rewrites();
  for (const [source, destination] of [
    ["/v1/:path*", "/api/v1/:path*"],
    ["/v1beta/:path*", "/api/v1beta/:path*"],
    ["/codex/:path*", "/api/v1/responses"],
    ["/responses", "/api/v1/responses"],
  ]) {
    assert.ok(rewrites.some((rule) => rule.source === source && rule.destination === destination), source);
  }
  assert.equal(rewrites.some((rule) => rule.source === "/models"), false);
  for (const name of ["chat/completions", "messages", "responses", "models", "embeddings"]) {
    assert.ok(existsSync(projectFile(`src/app/api/v1/${name}/route.js`)), name);
  }
});

test("CLI build utilities load without preparing or importing an agent engine", () => {
  const utilities = require("../../cli/scripts/build-cli.js");
  assert.equal(typeof utilities.copyStandaloneBuild, "function");
  assert.equal(typeof utilities.assertRequiredApiArtifacts, "function");
  assert.equal("copyHarnessEngineRuntime" in utilities, false);
  const source = readFileSync(projectFile("cli/scripts/build-cli.js"), "utf8");
  assert.doesNotMatch(source, /harness/i);
});

test("the package no longer installs or launches the embedded agent", () => {
  const pkg = JSON.parse(readFileSync(projectFile("package.json"), "utf8"));
  assert.ok(Object.keys(pkg.scripts).every((name) => !name.includes("harness")));
  assert.equal("qrcode" in pkg.dependencies, false);
  const lock = JSON.parse(readFileSync(projectFile("package-lock.json"), "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
});
