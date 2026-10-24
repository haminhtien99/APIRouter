#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessDir = resolve(process.env.APIROUTER_HARNESS_DIR || join(root, "../deepseek-harness"));

export function applyHarnessThemePatch(targetDir = harnessDir) {
  if (!existsSync(targetDir)) {
    console.warn(`[patch-harness] Harness directory not found at: ${targetDir}`);
    return false;
  }

  let patchedCount = 0;

  // 1. Patch packages/client/ui-theme/lib/client.js
  const libClientPath = join(targetDir, "packages/client/ui-theme/lib/client.js");
  if (existsSync(libClientPath)) {
    try {
      let code = readFileSync(libClientPath, "utf8");
      let changed = false;

      // Remove AppearanceRow registration from settings.general.item
      if (code.includes('id: "appearance"') || code.includes("id: 'appearance'")) {
        code = code.replace(
          /ctx\.slots\.inject\(["']settings\.general\.item["'],\s*\(\)\s*=>\s*ctx\.slots\.register\(\{[\s\S]*?id:\s*["']appearance["'][\s\S]*?AppearanceRow\)\);?/g,
          "/* [apirouter] appearance slot removed */"
        );
        changed = true;
      }

      // Add APIRUTER_THEME_SYNC message listener
      if (!code.includes("APIRUTER_THEME_SYNC")) {
        const needle = 'ctx.provide("theme", theme);';
        const listener = `ctx.provide("theme", theme);
      if (typeof window !== "undefined") {
        const applyTheme = (isDark) => {
          try { theme.setTheme(isDark ? "dark" : "light"); } catch (e) {}
          if (document.body) document.body.toggleAttribute("data-ds-dark-theme", isDark);
          document.documentElement.toggleAttribute("data-ds-dark-theme", isDark);
        };
        window.addEventListener("message", (event) => {
          if (event.data && event.data.type === "APIRUTER_THEME_SYNC") {
            applyTheme(Boolean(event.data.isDark));
          }
        });
        try {
          const qTheme = new URLSearchParams(window.location.search).get("theme");
          if (qTheme === "dark" || qTheme === "light") {
            applyTheme(qTheme === "dark");
          }
        } catch (e) {}
      }`;
        if (code.includes(needle)) {
          code = code.replace(needle, listener);
          changed = true;
        }
      }

      if (changed) {
        writeFileSync(libClientPath, code, "utf8");
        console.log(`[patch-harness] Patched ${libClientPath}`);
        patchedCount++;
      }
    } catch (err) {
      console.warn(`[patch-harness] Notice for lib/client.js: ${err.message}`);
    }
  }

  // 2. Patch packages/client/ui-theme/src/client/index.ts
  const srcIndexPath = join(targetDir, "packages/client/ui-theme/src/client/index.ts");
  if (existsSync(srcIndexPath)) {
    try {
      let code = readFileSync(srcIndexPath, "utf8");
      let changed = false;

      // Remove AppearanceRow registration
      if (code.includes("id: 'appearance'")) {
        code = code.replace(
          /ctx\.slots\.inject\('settings\.general\.item',\s*\(\)\s*=>\s*ctx\.slots\.register\(\{[\s\S]*?id:\s*'appearance'[\s\S]*?AppearanceRow\)\)/g,
          "/* [apirouter] appearance slot removed */"
        );
        changed = true;
      }

      // Add listener
      if (!code.includes("APIRUTER_THEME_SYNC")) {
        const needle = "ctx.provide('theme', theme)";
        const listener = `ctx.provide('theme', theme)
  if (typeof window !== 'undefined') {
    const applyTheme = (isDark: boolean) => {
      try { theme.setTheme(isDark ? 'dark' : 'light') } catch {}
      if (document.body) document.body.toggleAttribute('data-ds-dark-theme', isDark)
      document.documentElement.toggleAttribute('data-ds-dark-theme', isDark)
    }
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'APIRUTER_THEME_SYNC') {
        applyTheme(Boolean(event.data.isDark))
      }
    })
    try {
      const qTheme = new URLSearchParams(window.location.search).get('theme')
      if (qTheme === 'dark' || qTheme === 'light') {
        applyTheme(qTheme === 'dark')
      }
    } catch {}
  }`;
        if (code.includes(needle)) {
          code = code.replace(needle, listener);
          changed = true;
        }
      }

      if (changed) {
        writeFileSync(srcIndexPath, code, "utf8");
        console.log(`[patch-harness] Patched ${srcIndexPath}`);
        patchedCount++;
      }
    } catch (err) {
      console.warn(`[patch-harness] Notice for src/client/index.ts: ${err.message}`);
    }
  }

  // 3. Patch apps/web/dist/index.html (direct web frontend index)
  const distIndexPath = join(targetDir, "apps/web/dist/index.html");
  if (existsSync(distIndexPath)) {
    try {
      let html = readFileSync(distIndexPath, "utf8");
      if (!html.includes("apirouter-theme-bridge")) {
        const script = `
    <!-- APIRouter Theme Bridge & Sync -->
    <script id="apirouter-theme-bridge">
      (function() {
        function applyDark(isDark) {
          if (isDark) {
            document.documentElement.setAttribute('data-ds-dark-theme', '');
            document.documentElement.classList.add('dark');
            if (document.body) document.body.setAttribute('data-ds-dark-theme', '');
          } else {
            document.documentElement.removeAttribute('data-ds-dark-theme');
            document.documentElement.classList.remove('dark');
            if (document.body) document.body.removeAttribute('data-ds-dark-theme');
          }
        }
        window.addEventListener('message', function(e) {
          if (e.data && e.data.type === 'APIRUTER_THEME_SYNC') {
            applyDark(Boolean(e.data.isDark));
          }
        });
        try {
          var p = new URLSearchParams(window.location.search).get('theme');
          if (p === 'dark' || p === 'light') applyDark(p === 'dark');
        } catch(e) {}
        document.addEventListener('DOMContentLoaded', function() {
          try {
            var p2 = new URLSearchParams(window.location.search).get('theme');
            if (p2) applyDark(p2 === 'dark');
          } catch(e) {}
        });
      })();
    </script>
    <style id="apirouter-theme-override">
      /* Hide Appearance settings in Harness */
      [data-slot-item='appearance'],
      [data-slot-entry='appearance'] {
        display: none !important;
      }
    </style>
  </head>`;
        html = html.replace("</head>", script);
        writeFileSync(distIndexPath, html, "utf8");
        console.log(`[patch-harness] Injected theme sync script into ${distIndexPath}`);
        patchedCount++;
      }
    } catch (err) {
      console.warn(`[patch-harness] Notice for dist/index.html: ${err.message}`);
    }
  }

  return patchedCount > 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyHarnessThemePatch();
}
