import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createTelegramSessionStore,
  extractQuotaRows,
  formatCombos,
  formatProviders,
  formatQuota,
  formatUsage,
  LoginAttemptLimiter,
  parseAllowedChatIds,
  splitMessage,
} from "../../scripts/telegram-bot-lib.mjs";

test("parseAllowedChatIds normalizes comma-separated IDs", () => {
  assert.deepEqual([...parseAllowedChatIds("123, -456,123")], ["123", "-456"]);
});

test("provider and combo output escapes Telegram HTML", () => {
  assert.match(formatProviders([{ provider: "openai", name: "A < B", isActive: true }]), /A &lt; B/);
  assert.match(formatCombos([{ name: "fast & cheap", models: ["a<b"] }]), /fast &amp; cheap/);
});

test("usage output includes totals and top providers", () => {
  const output = formatUsage({
    totalRequests: 12,
    totalPromptTokens: 1000,
    totalCompletionTokens: 200,
    totalCachedTokens: 50,
    totalCost: 0.1234,
    byProvider: { codex: { requests: 12, promptTokens: 1000, completionTokens: 200 } },
  }, "7d");
  assert.match(output, /Requests: <b>12<\/b>/);
  assert.match(output, /codex: 12 req/);
});

test("extractQuotaRows handles nested quota formats", () => {
  const rows = extractQuotaRows({
    quotas: {
      weekly: { used: 25, total: 100, resetAt: "2026-09-28T00:00:00Z" },
      session: { used_percent: 80, reset_at: "2026-09-21T20:00:00Z" },
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Weekly");
  assert.equal(rows[1].usedPercent, 80);
});

test("formatQuota derives remaining percentage", () => {
  const output = formatQuota(
    { provider: "codex", name: "Main" },
    { plan: "pro", quotas: { weekly: { used: 25, total: 100 } } },
  );
  assert.match(output, /<b>75%<\/b> remaining/);
  assert.match(output, /████████░░/);
});

test("splitMessage keeps chunks under Telegram limit", () => {
  const chunks = splitMessage("a\n".repeat(100), 20);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
});

test("Telegram sessions persist authenticated chats without passwords", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apirouter-telegram-test-"));
  const filePath = path.join(directory, "sessions.json");
  try {
    const store = createTelegramSessionStore({ filePath, now: () => new Date("2026-09-21T10:00:00Z") });
    store.grant({ chatId: 123, userId: 456, username: "tester", firstName: "Test", chatType: "private", authVersion: "version-1" });
    assert.equal(store.has(123), true);
    assert.deepEqual(store.validate(123, { authVersion: "version-1", maxIdleMs: 1000 }), { valid: true, reason: null });
    assert.deepEqual(store.validate(123, { authVersion: "version-2", maxIdleMs: 1000 }), { valid: false, reason: "auth-changed" });
    assert.equal(JSON.parse(fs.readFileSync(filePath, "utf8")).chats["123"].username, "tester");
    assert.equal(fs.readFileSync(filePath, "utf8").includes("password"), false);

    const reloaded = createTelegramSessionStore({ filePath });
    assert.equal(reloaded.has(123), true);
    assert.equal(reloaded.revoke(123), true);
    assert.equal(reloaded.has(123), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("login limiter locks repeated failures per chat", () => {
  let currentTime = 0;
  const limiter = new LoginAttemptLimiter({ maxAttempts: 2, lockMs: 1000, now: () => currentTime });
  assert.equal(limiter.fail(123).allowed, true);
  const locked = limiter.fail(123);
  assert.equal(locked.allowed, false);
  assert.equal(locked.retryAfter, 1);
  currentTime = 1001;
  assert.equal(limiter.check(123).allowed, true);
});
