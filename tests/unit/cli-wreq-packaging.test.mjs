import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { copyStandaloneBuild, mergeServerArtifacts } = require("../../cli/scripts/build-cli.js");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function writeFixture(root, relativePath, contents) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

test("CLI declares the destination-installed wreq-js dependency and locks all target bindings", () => {
  const pkg = readJson(path.join(repoRoot, "cli/package.json"));
  const lock = readJson(path.join(repoRoot, "cli/package-lock.json"));
  assert.ok(pkg.dependencies["wreq-js"]);
  assert.equal(lock.packages[""].dependencies["wreq-js"], pkg.dependencies["wreq-js"]);
  const wreq = lock.packages["node_modules/wreq-js"];
  assert.ok(wreq);
  for (const [binding, version] of Object.entries(wreq.optionalDependencies)) {
    assert.match(binding, /^@wreq-js\/binding-/);
    const entry = lock.packages[`node_modules/${binding}`];
    assert.equal(entry.version, version);
    assert.equal(entry.optional, true);
    assert.ok(entry.os.length);
    assert.ok(entry.cpu.length);
  }
  assert.ok(Object.keys(wreq.optionalDependencies).some((name) => name.includes("win32")));
  assert.ok(Object.keys(wreq.optionalDependencies).some((name) => name.includes("darwin")));
  assert.ok(Object.keys(wreq.optionalDependencies).some((name) => name.includes("linux")));
});

for (const layout of ["flat", "workspace", "legacy"]) {
  test(`CLI ${layout} packaging excludes traced host wreq-js and resolves the destination installation`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-wreq-packaging-"));
    t.after(() => {
      assert.equal(path.dirname(root), os.tmpdir());
      fs.rmSync(root, { recursive: true, force: true });
    });
    const appDir = path.join(root, "source");
    const dist = path.join(appDir, ".next-cli-build");
    const standaloneRoot = path.join(dist, "standalone");
    const standalone = layout === "legacy" ? path.join(standaloneRoot, "app")
      : layout === "workspace" ? path.join(standaloneRoot, "source") : standaloneRoot;
    const cli = path.join(root, "installed", "node_modules", "apirouter");
    const cliApp = path.join(cli, "app");
    writeFixture(standalone, "server.js", "// server");
    const hostModules = layout === "legacy" ? standaloneRoot : standalone;
    writeFixture(hostModules, "node_modules/wreq-js/index.js", 'throw new Error("build-host wreq-js loaded");');
    writeFixture(hostModules, "node_modules/@wreq-js/binding-linux-x64-gnu/index.js", 'throw new Error("build-host binding loaded");');
    writeFixture(hostModules, "node_modules/keep-me/index.js", 'module.exports = "preserved";');
    // Also cover nested node_modules and the later complete-server copy pass.
    writeFixture(standalone, "node_modules/other/node_modules/wreq-js/index.js", "// host copy");
    writeFixture(dist, "server/node_modules/wreq-js/index.js", "// host copy");
    writeFixture(dist, "server/node_modules/@wreq-js/binding-win32-x64-msvc/index.js", "// host copy");
    writeFixture(dist, "server/chunks/provider.cjs", 'module.exports = require("wreq-js");');
    writeFixture(cli, "node_modules/wreq-js/index.js", 'module.exports = require("@wreq-js/binding-test-target");');
    const destinationBinding = writeFixture(cli, "node_modules/@wreq-js/binding-test-target/index.js", 'module.exports = "destination native binding";');

    copyStandaloneBuild(appDir, dist, cliApp);
    mergeServerArtifacts(dist, cliApp);

    for (const relative of [
      "node_modules/wreq-js", "node_modules/@wreq-js",
      "node_modules/other/node_modules/wreq-js",
      ".next-cli-build/server/node_modules/wreq-js",
      ".next-cli-build/server/node_modules/@wreq-js",
    ]) {
      assert.equal(fs.existsSync(path.join(cliApp, relative)), false, relative);
    }
    const runtime = createRequire(path.join(cliApp, ".next-cli-build/server/chunks/provider.cjs"));
    assert.equal(runtime("keep-me"), "preserved");
    assert.equal(runtime.resolve("@wreq-js/binding-test-target"), destinationBinding);
    assert.equal(runtime("./provider.cjs"), "destination native binding");
  });
}
