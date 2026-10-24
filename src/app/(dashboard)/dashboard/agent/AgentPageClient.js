"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import useThemeStore from "@/store/themeStore";

export default function AgentPageClient() {
  const [connection, setConnection] = useState({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [frameTimeout, setFrameTimeout] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const theme = useThemeStore((s) => s.theme);
  const iframeRef = useRef(null);

  const getEffectiveTheme = useCallback(() => {
    if (typeof window === "undefined") return "light";
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme === "dark" ? "dark" : "light";
  }, [theme]);

  // Synchronize theme to Harness iframe via postMessage
  const syncThemeToHarness = useCallback(() => {
    const effective = getEffectiveTheme();
    const isDark = effective === "dark";
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "APIRUTER_THEME_SYNC", isDark, theme: effective },
        "*"
      );
    } catch {}
  }, [getEffectiveTheme]);

  // Sync on theme store change
  useEffect(() => {
    syncThemeToHarness();
  }, [syncThemeToHarness]);

  // Sync on system color-scheme change if theme is 'system'
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => syncThemeToHarness();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, syncThemeToHarness]);

  // Pressing Escape exits Focus Mode
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  const refresh = useCallback(async (signal) => {
    try {
      const response = await fetch("/api/harness", { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (response.status === 403
        ? "Agent is available only from the local APIRouter dashboard."
        : "Sign in to APIRouter to connect to Agent."));
      setConnection(data);
    } catch (error) {
      if (signal?.aborted) return;
      setConnection({ status: "unavailable", error: error.message || "Cannot connect to the harness." });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = setInterval(() => refresh(controller.signal), 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);

  const launchUrl = connection.launchUrl;
  useEffect(() => {
    setLoaded(false);
    setFrameTimeout(false);
  }, [launchUrl, generation]);

  useEffect(() => {
    if (!launchUrl || loaded) return;
    const timer = setTimeout(() => setFrameTimeout(true), 20000);
    return () => clearTimeout(timer);
  }, [launchUrl, generation, loaded]);

  const handleIframeLoad = () => {
    setLoaded(true);
    syncThemeToHarness();
    setTimeout(syncThemeToHarness, 200);
    setTimeout(syncThemeToHarness, 600);
    setTimeout(syncThemeToHarness, 1500);
  };

  const ready = connection.status === "ready" && launchUrl;

  // Build iframe URL with theme param so initial render matches immediately
  let iframeSrc = launchUrl;
  if (launchUrl) {
    try {
      const u = new URL(launchUrl);
      u.searchParams.set("theme", getEffectiveTheme());
      iframeSrc = u.href;
    } catch {}
  }

  const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs sm:text-sm text-text-main hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary transition-colors cursor-pointer";

  return (
    <section
      className={`flex min-h-0 flex-1 flex-col bg-surface transition-all duration-200 ${
        focusMode ? "fixed inset-0 z-50 bg-bg" : "h-full w-full"
      }`}
      aria-label={translate("Agent workspace")}
    >
      {/* Workspace Header Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface/80 backdrop-blur-md px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
          <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-green-500 ring-2 ring-green-500/20" : "bg-amber-500"}`} aria-hidden="true" />
          <span className="font-medium text-text-main">
            {translate(ready ? "Harness reachable" : connection.status === "loading" ? "Checking harness…" : "Harness disconnected")}
          </span>
          {focusMode && (
            <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
              {translate("Focus Mode")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {ready && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => setFocusMode((v) => !v)}
              title={focusMode ? translate("Exit Focus Mode (Esc)") : translate("Focus Mode (Fullscreen Workspace)")}
              aria-label={focusMode ? "Exit Focus Mode" : "Focus Mode"}
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">
                {focusMode ? "fullscreen_exit" : "fullscreen"}
              </span>
              <span>{translate(focusMode ? "Exit Focus" : "Focus Mode")}</span>
            </button>
          )}
          <button className={buttonClass} onClick={() => { setGeneration((value) => value + 1); refresh(); }}>
            <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
            <span>{translate("Reconnect")}</span>
          </button>
          {ready && (
            <a className={buttonClass} href={launchUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
              <span>{translate("Open separately")}</span>
            </a>
          )}
        </div>
      </div>

      {ready ? (
        <div className="relative flex min-h-0 flex-1 flex-col bg-bg overflow-hidden">
          {!loaded && !frameTimeout && (
            <div role="status" className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-bg/80 backdrop-blur-sm gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-text-muted">{translate("Loading Agent workspace…")}</p>
            </div>
          )}
          {frameTimeout && (
            <p role="status" className="shrink-0 border-b border-border-subtle bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              {translate("If the workspace is blank, open it separately to check browser permissions, then reconnect.")}
            </p>
          )}
          <iframe
            ref={iframeRef}
            key={generation}
            src={iframeSrc}
            title={translate("DeepSeek Harness Agent")}
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
            className="min-h-0 w-full flex-1 border-0 bg-transparent"
            onLoad={handleIframeLoad}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-5 sm:p-10">
          <div className="w-full max-w-xl rounded-2xl border border-border-subtle bg-bg p-5 sm:p-8">
            <span className="material-symbols-outlined mb-4 text-4xl text-primary" aria-hidden="true">terminal</span>
            <h2 className="text-xl font-semibold">{translate("Your agent, powered by APIRouter")}</h2>
            <p className="mt-3 text-sm text-text-muted">{translate("Use harness sessions, files, terminal tools and approvals with your APIRouter models and combos.")}</p>
            {connection.error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{translate(connection.error)}</p>}
            <p className="mt-5 text-sm">{translate("Start the harness from your APIRouter checkout in a separate terminal:")}</p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border-subtle bg-surface-2 p-4 text-sm"><code>npm run harness:web</code></pre>
            <p className="mt-3 text-sm text-text-muted">{translate("Keep that terminal open. This page connects automatically when the runtime is ready. Your existing harness model and API key settings are preserved.")}</p>
            {connection.status === "starting" && <p role="status" className="mt-4 text-sm text-primary">{translate("Harness is starting…")}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
