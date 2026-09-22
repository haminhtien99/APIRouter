import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { AUTH_COOKIE_NAMES } from "@/lib/auth/cookieNames";

export async function POST() {
  const cookieStore = await cookies();
  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete(AUTH_COOKIE_NAMES.oidcState);
  cookieStore.delete(AUTH_COOKIE_NAMES.oidcNonce);
  cookieStore.delete(AUTH_COOKIE_NAMES.oidcVerifier);
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
