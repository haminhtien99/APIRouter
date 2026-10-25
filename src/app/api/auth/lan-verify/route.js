import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getSettings } from "@/lib/localDb";
import { getEffectiveLanAccessKey } from "@/lib/db/repos/settingsRepo";
import { setLanAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`,
          retryAfter: lock.retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } }
      );
    }

    const settings = await getSettings();
    if (!settings.lanSharingEnabled) {
      return NextResponse.json(
        { error: "LAN network sharing is currently disabled on this server." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const effectiveKey = getEffectiveLanAccessKey(settings);
    if (!effectiveKey) {
      return NextResponse.json(
        { error: "No LAN access key is configured on this server." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {}

    const key = body?.key;
    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { error: "LAN Access Key is required." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (safeCompare(key.trim(), effectiveKey.trim())) {
      recordSuccess(ip);
      const cookieStore = await cookies();
      await setLanAuthCookie(cookieStore, request);
      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
      return NextResponse.json(
        {
          error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`,
          retryAfter: postLock.retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter), ...NO_STORE_HEADERS } }
      );
    }

    return NextResponse.json(
      {
        error: `Invalid LAN Hash Key. ${remainingBeforeLock} attempt(s) left.`,
        remainingBeforeLock,
      },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "An unexpected error occurred." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
