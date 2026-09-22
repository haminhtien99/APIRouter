import pkg from "../../../../package.json" with { type: "json" };

export function GET() {
  return Response.json({ currentVersion: pkg.version, latestVersion: null, hasUpdate: false, updateMode: "local" });
}
