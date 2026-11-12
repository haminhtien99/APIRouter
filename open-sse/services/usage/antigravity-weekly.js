/**
 * Antigravity weekly quota — best-effort retrieval from retrieveUserQuotaSummary.
 * Failure never breaks existing per-model quota display.
 */

import { U, parseResetTime, fetchWithTimeout } from "./shared.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared.js";

// — Weekly quota summary config ——————————————————————————————
const WEEKLY_CONFIG = {
  ...U("antigravity"),
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

// — Cache: TTL + in-flight dedup per project ———————————————
const WEEKLY_CACHE_TTL_MS = 180_000; // 3 minutes
const weeklyCache = new Map(); // cacheKey -> { result, expiresAt } | { promise }

function cacheKey(accessToken, projectId) {
  return `${accessToken}::${projectId || ""}`;
}

// Exported for tests only
export function _clearWeeklyCache() {
  weeklyCache.clear();
}

// — Group-name to stable key mapping ——————————————————————
const GROUP_MATCHERS = [
  { pattern: /gemini/i, key: "gemini_weekly", displayName: "Gemini (Weekly)" },
  { pattern: /claude|gpt/i, key: "claude_gpt_weekly", displayName: "Claude & GPT (Weekly)" },
];

/**
 * Parse a retrieveUserQuotaSummary response into normalized weekly quotas.
 * Pure function — safe to unit-test without network.
 *
 * @param {Object|null} data  Raw JSON response
 * @returns {Object}  e.g. { gemini_weekly: { used, total, ... }, claude_gpt_weekly: { ... } }
 */
export function parseWeeklyQuotaSummary(data) {
  if (!data || typeof data !== "object") return {};

  // Groups may live at data.groups or data.quotaSummary.groups
  const groups = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray(data.quotaSummary?.groups)
      ? data.quotaSummary.groups
      : null;

  if (!groups) return {};

  const result = {};

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const displayName = group.displayName || "";

    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object") continue;

      // Identify weekly buckets by checking bucketId + displayName for "weekly"
      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      const window = /\bweekly\b/.test(bucketText.replace(/[_-]/g, " ")) ? "weekly"
        : /\b(?:5h|5 hour(?:s)?)\b/.test(bucketText.replace(/[_-]/g, " ")) ? "5h" : null;
      if (!window) continue;

      // Skip disabled buckets
      if (bucket.disabled === true) continue;

      const remainingFraction = bucket.remainingFraction;
      const validFraction = typeof remainingFraction === "number" && Number.isFinite(remainingFraction)
        && remainingFraction >= 0 && remainingFraction <= 1;

      // Match group to a known family
      for (const matcher of GROUP_MATCHERS) {
        if (matcher.pattern.test(displayName)) {
          const total = 1000;
          const remaining = validFraction ? Math.round(total * remainingFraction) : null;
          const used = remaining === null ? null : Math.max(0, total - remaining);

          const baseKey = window === "weekly" ? matcher.key : matcher.key.replace("_weekly", "_5h");
          // Preserve distinct upstream buckets, even when their values match.
          let key = baseKey;
          let suffix = 2;
          while (result[key]) key = `${baseKey}_${suffix++}`;
          result[key] = {
            used,
            total,
            resetAt: parseResetTime(bucket.resetTime),
            remainingPercentage: validFraction ? remainingFraction * 100 : null,
            unlimited: false,
            source: "retrieveUserQuotaSummary",
            scope: "group",
            window,
            bucketId: bucket.bucketId || null,
            percentageOnly: true,
            observedAt: new Date().toISOString(),
            displayName: window === "weekly" ? matcher.displayName : matcher.displayName.replace("Weekly", "5h"),
          };
          break; // Group family matched; retain every independently identified bucket.
        }
      }
    }
  }

  return result;
}

/**
 * Fetch weekly quota summary — cached, deduped, never throws.
 */
export async function fetchAntigravityWeeklyQuota(accessToken, projectId, proxyOptions = null) {
  return (await fetchAntigravityWeeklyQuotaResult(accessToken, projectId, proxyOptions)).quotas;
}

export async function fetchAntigravityWeeklyQuotaResult(accessToken, projectId, proxyOptions = null) {
  const key = cacheKey(accessToken, projectId);

  // Serve in-flight or cached
  const hit = weeklyCache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const promise = (async () => {
    try {
      const url = WEEKLY_CONFIG.quotaSummaryApiUrl;
      if (!url) return { quotas: {}, status: "unavailable" };

      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": WEEKLY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {}),
        }),
      }, 10000, proxyOptions);

      if (!response.ok) return { quotas: {}, status: "error" };

      const data = await response.json();
      const quotas = parseWeeklyQuotaSummary(data);
      return { quotas, status: Object.keys(quotas).length ? "ok" : "unavailable" };
    } catch {
      return { quotas: {}, status: "error" };
    }
  })();

  weeklyCache.set(key, { promise });

  try {
    const result = await promise;
    if (result && Object.keys(result.quotas).length > 0) {
      weeklyCache.set(key, { result, expiresAt: Date.now() + WEEKLY_CACHE_TTL_MS });
    } else {
      weeklyCache.delete(key);
    }
    return result;
  } catch {
    weeklyCache.delete(key);
    return { quotas: {}, status: "error" };
  }
}
