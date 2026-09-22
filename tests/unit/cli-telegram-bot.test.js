import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createTelegramBotController } = require("../../cli/src/cli/telegramBot.js");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-telegram-cli-"));
  const appDir = path.join(root, "app");
  const launchDir = path.join(root, "launch");
  fs.mkdirSync(path.join(appDir, "scripts"), { recursive: true });
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "scripts", "telegram-bot.mjs"), "// fixture\n");
  return { root, appDir, launchDir };
}

test("Telegram CLI controller requires a configured token", () => {
  const fixture = createFixture();
  try {
    const controller = createTelegramBotController({
      appDir: fixture.appDir,
      projectDir: fixture.root,
      launchDir: fixture.launchDir,
      port: 20228,
      baseEnv: {},
      spawnProcess() {
        throw new Error("spawn should not be called");
      },
    });

    const result = controller.start();
    assert.equal(result.success, false);
    assert.match(result.error, /TELEGRAM_BOT_TOKEN/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Telegram CLI controller starts and stops the bundled bot", () => {
  const fixture = createFixture();
  const calls = [];
  try {
    fs.writeFileSync(path.join(fixture.launchDir, ".env.local"), "TELEGRAM_BOT_TOKEN=test-token\n");
    const fakeChild = new EventEmitter();
    fakeChild.exitCode = null;
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = (signal) => {
      calls.push({ signal });
      return true;
    };

    const controller = createTelegramBotController({
      appDir: fixture.appDir,
      projectDir: fixture.root,
      launchDir: fixture.launchDir,
      port: 23456,
      baseEnv: {},
      spawnProcess(runtime, args, options) {
        calls.push({ runtime, args, options });
        return fakeChild;
      },
    });

    const started = controller.start();
    assert.equal(started.success, true);
    assert.equal(started.status.running, true);
    assert.equal(calls[0].options.env.APIRouter_BASE_URL, "http://127.0.0.1:23456");
    assert.equal(calls[0].options.env.TELEGRAM_BOT_TOKEN, "test-token");

    const stopped = controller.stop();
    assert.equal(stopped.status.running, false);
    assert.deepEqual(calls[1], { signal: "SIGKILL" });
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
