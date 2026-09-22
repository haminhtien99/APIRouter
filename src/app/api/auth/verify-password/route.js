import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import { getDashboardAuthVersion, verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request) {
  try {
    const settings = await getSettings();
    if (settings.authMode === "sso" || settings.authMode === "saml" || settings.authMode === "oidc") {
      const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
      if (ssoType === "saml" && isSamlConfigured(settings)) {
        return NextResponse.json(
          { success: false, error: "Password login is disabled. Use SAML SSO sign in." },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
      if (ssoType === "oidc" && isOidcConfigured(settings)) {
        return NextResponse.json(
          { success: false, error: "Password login is disabled. Use OIDC sign in." },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }
    }

    const { password } = await request.json();
    const success = await verifyDashboardPassword(password);
    const authVersion = success ? await getDashboardAuthVersion() : null;
    return NextResponse.json(
      success ? { success: true, authVersion } : { success: false, error: "Invalid password" },
      { status: success ? 200 : 401, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json(
      { authVersion: await getDashboardAuthVersion() },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
