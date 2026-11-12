import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getAntigravityUsage } from "../../open-sse/services/usage/google.js";
import { parseWeeklyQuotaSummary, _clearWeeklyCache } from "../../open-sse/services/usage/antigravity-weekly.js";
import { parseQuotaData, getRemainingPercentage, getAntigravityQuotaState } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const resetTime = "2099-01-01T00:00:00Z";
const summary = (short, weekly) => ({ groups: [{ displayName: "Gemini Models", buckets: [
  { bucketId: "gemini-5h", remainingFraction: short, resetTime },
  { bucketId: "gemini-weekly", remainingFraction: weekly, resetTime },
] }] });
const rows = (quotas) => parseQuotaData("antigravity", { quotas });

describe("Antigravity quota semantics", () => {
  beforeEach(() => { vi.clearAllMocks(); _clearWeeklyCache(); });
  it.each([[0.2, 0.8], [0.5, 0.5]])("retains two explicit windows even when equal (%s, %s)", (short, weekly) => {
    const result = rows(parseWeeklyQuotaSummary(summary(short, weekly)));
    expect(result.map(q => q.name)).toEqual(["5h", "Weekly"]);
    expect(result.map(q => q.remainingPercentage)).toEqual([short * 100, weekly * 100]);
    expect(result[0].resetAt).toBe(result[1].resetAt);
  });
  it("weekly only does not manufacture a short window", () => {
    const data = summary(0.4, 0.7); data.groups[0].buckets.shift();
    expect(rows(parseWeeklyQuotaSummary(data)).map(q => q.name)).toEqual(["Weekly"]);
  });
  it("retains distinct weekly buckets instead of overwriting them", () => {
    const data = summary(0.4, 0.7);
    data.groups[0].buckets[0].bucketId = "another-weekly";
    expect(rows(parseWeeklyQuotaSummary(data))).toHaveLength(1);
    expect(rows(parseWeeklyQuotaSummary(data))[0].remainingRange).toEqual([40, 70]);
  });
  it.each([{}, { paidTier: { id: "free-tier" } }, { paidTier: { id: "g1-pro-tier" } }])("does not infer a window from tier %j", async (tier) => {
    proxyAwareFetch.mockImplementation(async url => ({ ok: true, status: 200, json: async () =>
      url.includes("loadCodeAssist") ? tier : url.includes("fetchAvailableModels") ? { models: {
        "gemini-3.8-flash-high": { quotaInfo: { remainingFraction: 0, resetTime } },
        "gemini-3.8-flash-low": { quotaInfo: { remainingFraction: 0.8, resetTime } },
        "claude-sonnet-4-6": { quotaInfo: { resetTime } },
      } } : { groups: [] } }));
    const result = rows((await getAntigravityUsage("test-placeholder", {})).quotas);
    expect(result).toHaveLength(2);
    expect(result.map(q => q.remainingPercentage)).toEqual([0, null]);
    expect(result[0].remainingRange).toEqual([0, 80]);
    expect(result.every(q => q.window === "unknown")).toBe(true);
    expect(result.map(q => q.name)).toEqual(["5h", "5h"]);
    expect(result.every(q => q.windowUnconfirmed)).toBe(true);
    expect(result[0].quotaDescription).toContain("not a shared pool");
    expect(getRemainingPercentage(result[0])).toBe(0);
    expect(getRemainingPercentage(result[1])).toBeNull();
  });
  it("keeps the main display to four rows and does not invent a common reset", () => {
    const model = (remainingPercentage, resetAt = resetTime) => ({ remainingPercentage, resetAt, observedAt: new Date().toISOString() });
    const result = rows({
      "gemini-3.8-flash-high": model(25),
      "gemini-3.8-flash-low": model(75, "2099-02-01T00:00:00Z"),
      "gemini-3.1-flash-image": model(10),
      "claude-sonnet-4-6": model(60),
      "gpt-oss-120b-medium": model(60),
      ...parseWeeklyQuotaSummary({ groups: [
        { displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: 0.5 }] },
        { displayName: "Claude and GPT", buckets: [{ bucketId: "weekly", remainingFraction: 0.8 }] },
      ] }),
    });
    expect(result.map(q => [q.group, q.name])).toEqual([
      ["Gemini", "5h"], ["Gemini", "Weekly"], ["Claude and GPT", "5h"], ["Claude and GPT", "Weekly"],
    ]);
    expect(result[0].remainingRange).toEqual([25, 75]);
    expect(result[0].resetAt).toBeNull();
    expect(result[0].resetVaries).toBe(true);
    expect(result[2].remainingPercentage).toBe(60);
    expect(result[2].remainingRange).toBeNull();
  });
  it.each([null, undefined, "", false, -1, 2, "bad"])("invalid fraction %s stays unknown", fraction => {
    const data = summary(0.5, fraction); data.groups[0].buckets.shift();
    expect(rows(parseWeeklyQuotaSummary(data))[0].remainingPercentage).toBeNull();
  });
  it("distinguishes a valid zero, unknown and stale observations", () => {
    const now = Date.now();
    const q = { percentageOnly: true, remainingPercentage: 0, observedAt: new Date(now).toISOString(), resetAt: resetTime };
    expect(getAntigravityQuotaState(q, now)).toBe("Current");
    expect(getAntigravityQuotaState({ ...q, remainingPercentage: null }, now)).toBe("Unknown");
    expect(getAntigravityQuotaState(q, now + 180001)).toBe("Stale");
    expect(getAntigravityQuotaState({ ...q, resetAt: new Date(now - 1).toISOString() }, now)).toBe("Stale");
  });
  it("preserves weekly data when the model endpoint fails", async () => {
    proxyAwareFetch.mockImplementation(async url => {
      if (url.includes("fetchAvailableModels")) throw new Error("offline");
      return { ok: true, status: 200, json: async () => url.includes("loadCodeAssist")
        ? {} : { groups: [{ displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: 0, resetTime }] }] } };
    });
    const result = await getAntigravityUsage("test-placeholder", {});
    expect(result.quotaSources.models).toBe("error");
    expect(rows(result.quotas)[0].name).toBe("Weekly");
    expect(getRemainingPercentage(rows(result.quotas)[0])).toBe(0);
  });
  it.each([null, [], "invalid"])("keeps summary data when the model payload is malformed: %j", async payload => {
    proxyAwareFetch.mockImplementation(async url => ({ ok: true, status: 200, json: async () =>
      url.includes("loadCodeAssist") ? {} : url.includes("fetchAvailableModels") ? payload
        : { groups: [{ displayName: "Gemini", buckets: [{ bucketId: "weekly", remainingFraction: 0.5 }] }] }
    }));
    const result = await getAntigravityUsage("test-placeholder", {});
    expect(result.quotaSources.models).toBe("error");
    expect(rows(result.quotas)[0].remainingPercentage).toBe(50);
  });
  it("does not renew observation timestamps when serving the weekly cache", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: true, status: 200, json: async () => summary(0.5, 0.5) });
    const { fetchAntigravityWeeklyQuota } = await import("../../open-sse/services/usage/antigravity-weekly.js");
    const first = await fetchAntigravityWeeklyQuota("test-placeholder", null);
    const second = await fetchAntigravityWeeklyQuota("test-placeholder", null);
    expect(second.gemini_weekly.observedAt).toBe(first.gemini_weekly.observedAt);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });
  it("reports upstream error without turning model data into zero or a weekly copy", async () => {
    proxyAwareFetch.mockImplementation(async url => url.includes("retrieveUserQuotaSummary")
      ? { ok: false, status: 503 }
      : { ok: true, status: 200, json: async () => url.includes("loadCodeAssist") ? {} : { models: {
        "gemini-3.8-flash-high": { quotaInfo: { remainingFraction: 0.6 } },
      } } });
    const result = await getAntigravityUsage("test-placeholder", {});
    expect(result.quotaSources.weekly).toBe("error");
    expect(result.quotaNotice).toContain("fetch failed");
    expect(rows(result.quotas)).toHaveLength(1);
    expect(rows(result.quotas)[0].remainingPercentage).toBe(60);
  });
});
