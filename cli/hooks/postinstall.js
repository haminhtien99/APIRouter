#!/usr/bin/env node

// The standalone build bundles sql.js, so native SQLite and tray helpers are
// optional. Install them only when explicitly requested.
const { ensureSqliteRuntime } = require("./sqliteRuntime");
const { ensureTrayRuntime } = require("./trayRuntime");

if (process.env.APIROUTER_INSTALL_OPTIONAL_RUNTIME !== "1") {
  console.log("[apirouter] using bundled local runtime; optional native helpers skipped");
  process.exit(0);
}

try {
  ensureSqliteRuntime({ silent: false });
  console.log("[apirouter] runtime SQLite deps ready");
} catch (e) {
  console.warn(`[apirouter] runtime warm-up skipped: ${e.message}`);
}

try {
  ensureTrayRuntime({ silent: false });
} catch (e) {
  console.warn(`[apirouter] tray runtime skipped: ${e.message}`);
}

process.exit(0);
