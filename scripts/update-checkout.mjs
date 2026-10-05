#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2] || "check";
const jsonOutput = action === "status";

if (!new Set(["check", "apply", "status"]).has(action)) {
  console.error("Usage: apirouter update [--check]");
  process.exit(2);
}

function output(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function report(message) {
  if (!jsonOutput) console.log(message);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: jsonOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    timeout: jsonOutput ? 12000 : undefined,
    env: jsonOutput ? { ...process.env, GIT_TERMINAL_PROMPT: "0" } : process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = jsonOutput ? result.stderr?.toString().trim() : "";
    throw new Error(detail || `${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

function isAncestor(older, newer) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", older, newer], { cwd: root, stdio: "ignore" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error("Could not compare Git histories");
  return result.status === 0;
}

try {
  if (output("git", ["rev-parse", "--show-toplevel"]) !== root) {
    throw new Error("Update must run from the APIRouter Git checkout");
  }

  const branch = output("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const remote = output("git", ["config", "--get", `branch.${branch}.remote`]);
  const upstream = output("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const currentVersion = JSON.parse(readFileSync(path.join(root, "cli", "package.json"), "utf8")).version;
  const currentCommit = output("git", ["rev-parse", "--short", "HEAD"]);

  report(`Current: v${currentVersion} (${currentCommit}, ${branch})`);
  report(`Fetching ${remote}...`);
  run("git", jsonOutput ? ["fetch", "--quiet", "--no-tags", remote] : ["fetch", "--tags", remote]);

  const upstreamVersion = JSON.parse(output("git", ["show", `${upstream}:cli/package.json`])).version;
  const upstreamCommit = output("git", ["rev-parse", "--short", upstream]);
  report(`Available: v${upstreamVersion} (${upstreamCommit}, ${upstream})`);

  const isCurrent = upstreamCommit === currentCommit;
  const isAhead = !isCurrent && isAncestor(upstream, "HEAD");
  const isBehind = !isCurrent && isAncestor("HEAD", upstream);
  const hasLocalChanges = Boolean(output("git", ["status", "--porcelain", "--untracked-files=normal"]));

  if (jsonOutput) {
    const status = isCurrent ? "upToDate" : isAhead ? "ahead" : isBehind ? "updateAvailable" : "diverged";
    console.log(JSON.stringify({
      status,
      currentVersion,
      latestVersion: upstreamVersion,
      currentCommit,
      latestCommit: upstreamCommit,
      branch,
      upstream,
      hasUpdate: isBehind,
      canUpdate: isBehind && !hasLocalChanges,
      hasLocalChanges,
    }));
    process.exit(0);
  }

  if (isCurrent || isAhead) {
    console.log(upstreamCommit === currentCommit ? "Already up to date." : "Local branch is ahead of its upstream; nothing to download.");
    process.exit(0);
  }
  if (!isBehind) {
    throw new Error("Local and remote branches diverged. Resolve the Git history before updating.");
  }

  const commits = output("git", ["rev-list", "--count", `HEAD..${upstream}`]);
  console.log(`${commits} new commit(s) available.`);
  if (action === "check") {
    console.log("Stop APIRouter, then run: apirouter update");
    process.exit(0);
  }

  if (hasLocalChanges) {
    throw new Error("Checkout has local changes. Commit or stash them before updating.");
  }

  console.log("Updating source with a fast forward...");
  run("git", ["merge", "--ff-only", upstream]);
  console.log("Installing locked dependencies...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci"]);
  run(npm, ["--prefix", "cli", "ci"]);
  console.log("Building the local CLI...");
  run(npm, ["run", "local:build"]);
  console.log(`Updated to v${upstreamVersion}. Start APIRouter again with: apirouter`);
} catch (error) {
  if (jsonOutput) console.log(JSON.stringify({ status: "unavailable", error: error.message }));
  else console.error(`Update failed: ${error.message}`);
  process.exit(1);
}
