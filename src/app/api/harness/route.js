import { NextResponse } from "next/server";
import { DATA_DIR } from "@/lib/dataDir";
import { harnessStateFile, runtimeStatus } from "@/lib/harness/runtime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// dashboardGuard restricts this credential-bearing route to authenticated local clients.
export async function GET(request) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    const state = await runtimeStatus(harnessStateFile(DATA_DIR));
    if (state.launchUrl) {
      const url = new URL(state.launchUrl);
      const hostname = new URL(`http://${request.headers.get("host")}`).hostname;
      // Use the dashboard's loopback hostname so iframe requests remain same-site.
      if (!["127.0.0.1", "localhost"].includes(hostname)) {
        return NextResponse.json({ status: "unavailable", error: "Open APIRouter at http://127.0.0.1 to use Agent." }, { status: 409, headers });
      }
      url.hostname = hostname;
      state.launchUrl = url.href;
    }
    return NextResponse.json(state, { headers });
  } catch {
    return NextResponse.json({
      status: "unavailable",
      error: "Cannot read the harness connection. Check the launcher terminal and state file permissions.",
    }, { status: 503, headers });
  }
}
