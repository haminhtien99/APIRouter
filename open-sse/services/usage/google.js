/**
 * Google usage handlers (Gemini CLI + Antigravity)
 */

import { CLIENT_METADATA } from "../../config/appConstants.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared.js";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared.js";
import { fetchAntigravityWeeklyQuotaResult } from "./antigravity-weekly.js";

// Antigravity API config (from Quotio) — urls from registry, oauth client + dynamic UA kept here
const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
export async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      U("gemini-cli").quotaUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(
      U("gemini-cli").loadCodeAssistUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
export async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, proxyOptions);
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {})
      }),
    }, 10000, proxyOptions).catch(() => ({ ok: false, status: "network error" }));

    let data = {};
    let modelStatus = response.ok ? "ok" : "error";
    if (response.ok) {
      try {
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          modelStatus = "error";
        } else {
          data = payload;
        }
      } catch { modelStatus = "error"; }
    }
    const quotas = {};

    // quotaInfo is per model. Neither tier nor resetTime establishes a window.
    if (data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'gemini-3.8-flash-high',
        'gemini-3.8-flash-medium',
        'gemini-3.8-flash-low',
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        // Image generation models
        'gemini-3.1-flash-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info || typeof info !== "object" || !info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const rawFraction = info.quotaInfo.remainingFraction;
        const remainingFraction = typeof rawFraction === "number" && Number.isFinite(rawFraction)
          && rawFraction >= 0 && rawFraction <= 1 ? rawFraction : null;
        const remainingPercentage = remainingFraction === null ? undefined : remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = remainingFraction === null ? null : Math.round(total * remainingFraction);
        const used = remaining === null ? null : total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: info.displayName || modelKey,
          source: "fetchAvailableModels",
          scope: "model",
          window: "unknown",
          percentageOnly: true,
          observedAt: new Date().toISOString(),
        };
      }
    }

    // Keep sources independent: model exhaustion cannot rewrite a weekly bucket.
    const weekly = await fetchAntigravityWeeklyQuotaResult(accessToken, projectId, proxyOptions);
    Object.assign(quotas, weekly.quotas);

    return {
      plan: subscriptionInfo?.currentTier?.name || "Unknown",
      quotas,
      subscriptionInfo,
      ...(response.status === 401 && Object.keys(quotas).length === 0
        ? { message: "Antigravity quota API authentication expired. Chat may still work." } : {}),
      quotaSchemaVersion: 2,
      quotaSources: { models: modelStatus, weekly: weekly.status },
      quotaNotice: [
        modelStatus === "error" ? `Model quota fetch failed (HTTP ${response.status}).` : null,
        weekly.status === "error" ? "Weekly quota fetch failed; no weekly value is available." : null,
      ].filter(Boolean).join(" ") || null,
    };
  } catch (error) {
    console.error("[Antigravity Usage] Error:", error.message, error.cause);
    return { message: `Antigravity error: ${error.message}` };
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions);

    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error("[Antigravity Subscription] Error:", error.message);
    return null;
  }
}
