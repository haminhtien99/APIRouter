import { NextResponse } from "next/server";

function stopCurrentInstance() {
  const launcherPid = Number.parseInt(process.env.APIROUTER_LAUNCHER_PID || "", 10);
  if (Number.isSafeInteger(launcherPid) && launcherPid > 1 && launcherPid !== process.pid) {
    try {
      process.kill(launcherPid, "SIGTERM");
      return;
    } catch {
      // The launcher may already be gone; stop this server directly below.
    }
  }
  process.exit(0);
}

export async function POST() {
  const response = NextResponse.json({ success: true, message: "Shutting down APIRouter..." });

  setTimeout(stopCurrentInstance, 500);

  return response;
}
