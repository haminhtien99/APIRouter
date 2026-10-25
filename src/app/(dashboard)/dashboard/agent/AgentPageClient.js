"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { translate } from "@/i18n/runtime";
import useThemeStore from "@/store/themeStore";

export default function AgentPageClient() {
  const [connection, setConnection] = useState({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [frameTimeout, setFrameTimeout] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [pendingOpenTab, setPendingOpenTab] = useState(false);

  const theme = useThemeStore((s) => s.theme);
  const iframeRef = useRef(null);
  const containerRef = useRef(null);

  // Load auto-start preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem("apirouter_agent_autostart");
      if (saved === "true") setAutoStart(true);
    } catch {}
  }, []);

  const handleToggleAutoStart = (checked) => {
    setAutoStart(checked);
    try {
      localStorage.setItem("apirouter_agent_autostart", checked ? "true" : "false");
    } catch {}
  };

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

  // Toggle Focus Mode / Fullscreen
  const toggleFocusMode = useCallback(async () => {
    const target = containerRef.current;
    if (!focusMode) {
      // Try native HTML5 Fullscreen first
      if (target && target.requestFullscreen) {
        try {
          await target.requestFullscreen();
          setFocusMode(true);
          return;
        } catch {}
      }
      setFocusMode(true);
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch {}
      }
      setFocusMode(false);
    }
  }, [focusMode]);

  // Listen to native fullscreen change events (e.g. user presses Esc)
  useEffect(() => {
    const onFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setFocusMode(isFs);
      // Trigger resize for Harness layout recomputation
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 50);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Pressing Escape exits CSS Focus Mode fallback
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
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
      if (data.status === "ready") {
        setStarting(false);
      }
    } catch (error) {
      if (signal?.aborted) return;
      setConnection({ status: "unavailable", error: error.message || "Cannot connect to the harness." });
      setStarting(false);
    }
  }, []);

  const handleStartHarness = async (openInNewTab = false) => {
    setStarting(true);
    let popupWindow = null;
    if (openInNewTab) {
      setPendingOpenTab(true);
      popupWindow = window.open("", "_blank");
      if (popupWindow && popupWindow.document) {
        popupWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>DeepSeek Harness Agent</title>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                  display: flex;
                  flex-direction: column;
                  align-items: center;
                  justify-content: center;
                  height: 100vh;
                  margin: 0;
                  background: #0f1115;
                  color: #e5e5e5;
                }
                .spinner {
                  width: 32px;
                  height: 32px;
                  border: 3px solid rgba(255,255,255,0.15);
                  border-top-color: #3b82f6;
                  border-radius: 50%;
                  animation: spin 0.8s linear infinite;
                  margin-bottom: 16px;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
                .desc { font-size: 13px; color: #888; }
              </style>
            </head>
            <body>
              <div class="spinner"></div>
              <div class="title">Starting DeepSeek Harness...</div>
              <div class="desc">Please wait a moment while the agent workspace initializes.</div>
            </body>
          </html>
        `);
      }
    }

    try {
      const res = await fetch("/api/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start harness.");
      setConnection(data);

      let readyReached = false;
      // Fast polling: check every 800ms up to 35 times (28 seconds)
      for (let i = 0; i < 35; i++) {
        await new Promise((r) => setTimeout(r, 800));
        const check = await fetch("/api/harness", { cache: "no-store" });
        if (check.ok) {
          const d = await check.json();
          if (d.status === "ready") {
            readyReached = true;
            setConnection(d);
            setStarting(false);
            if (openInNewTab && d.launchUrl && popupWindow) {
              const u = new URL(d.launchUrl);
              u.searchParams.set("theme", getEffectiveTheme());
              popupWindow.location.href = u.href;
              setPendingOpenTab(false);
            }
            break;
          } else if (d.error && (d.status === "unavailable" || d.status === "stopped")) {
            throw new Error(d.error);
          }
        }
      }
      if (!readyReached) {
        throw new Error("Harness is taking longer than usual to start. Please check the terminal or click Reconnect.");
      }
    } catch (err) {
      if (popupWindow) popupWindow.close();
      setConnection({ status: "unavailable", error: err.message });
    } finally {
      setStarting(false);
      setPendingOpenTab(false);
    }
  };

  const handleStopHarness = async () => {
    setStopping(true);
    try {
      await fetch("/api/harness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      setConnection({ status: "stopped" });
    } catch (err) {
      console.error("Failed to stop harness:", err);
    } finally {
      setStopping(false);
    }
  };

  // Auto-start on load if enabled and stopped
  useEffect(() => {
    if (!autoStart) return;
    if (connection.status === "stopped" || connection.status === "unavailable") {
      handleStartHarness(false);
    }
  }, [autoStart, connection.status]);

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

  // Build iframe URL & standalone URL with theme param so initial render matches immediately
  let iframeSrc = launchUrl;
  let standaloneUrl = launchUrl;
  if (launchUrl) {
    try {
      const u = new URL(launchUrl);
      u.searchParams.set("theme", getEffectiveTheme());
      iframeSrc = u.href;
      standaloneUrl = u.href;
    } catch {}
  }

  const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs sm:text-sm text-text-main hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary transition-colors cursor-pointer";

  const renderContent = () => (
    <section
      ref={containerRef}
      className={`flex min-h-0 flex-1 flex-col bg-surface ${
        focusMode
          ? "fixed inset-0 z-[9999] w-screen h-screen bg-bg"
          : "h-full w-full"
      }`}
      aria-label={translate("Agent workspace")}
    >
      {/* Workspace Header Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface/80 backdrop-blur-md px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              ready
                ? "bg-green-500 ring-2 ring-green-500/20"
                : starting || connection.status === "starting" || connection.status === "loading"
                ? "bg-amber-500 animate-pulse"
                : "bg-neutral-400"
            }`}
            aria-hidden="true"
          />
          <span className="font-medium text-text-main">
            {translate(
              ready
                ? "Harness reachable"
                : starting || connection.status === "starting"
                ? "Starting harness…"
                : connection.status === "loading"
                ? "Checking harness…"
                : "Harness stopped"
            )}
          </span>
          {focusMode && (
            <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary uppercase tracking-wide">
              {translate("Focus Mode")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {ready && (
            <>
              {/* Standalone open */}
              <a
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors cursor-pointer shadow-xs"
                href={standaloneUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                title={translate("Open standalone harness in a separate browser tab")}
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
                <span>{translate("Open separately")}</span>
              </a>

              {/* Fullscreen / Focus Mode toggle */}
              <button
                type="button"
                className={buttonClass}
                onClick={toggleFocusMode}
                title={focusMode ? translate("Exit Focus Mode (Esc)") : translate("Focus Mode (Fullscreen Workspace)")}
                aria-label={focusMode ? "Exit Focus Mode" : "Focus Mode"}
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">
                  {focusMode ? "fullscreen_exit" : "fullscreen"}
                </span>
                <span>{translate(focusMode ? "Exit Focus" : "Focus Mode")}</span>
              </button>

              <button
                type="button"
                className={`${buttonClass} text-red-600 dark:text-red-400 hover:bg-red-500/10`}
                onClick={handleStopHarness}
                disabled={stopping}
                title={translate("Stop background harness runtime")}
              >
                <span className="material-symbols-outlined text-base" aria-hidden="true">stop</span>
                <span>{translate(stopping ? "Stopping…" : "Stop Agent")}</span>
              </button>
            </>
          )}

          {!ready && (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white px-3 py-1.5 text-xs sm:text-sm font-medium transition-all shadow-sm cursor-pointer disabled:opacity-50"
              onClick={() => handleStartHarness(false)}
              disabled={starting}
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">play_arrow</span>
              <span>{translate(starting ? "Starting…" : "Start Agent")}</span>
            </button>
          )}

          <button className={buttonClass} onClick={() => { setGeneration((value) => value + 1); refresh(); }}>
            <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
            <span>{translate("Reconnect")}</span>
          </button>
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
            allow="clipboard-read; clipboard-write; fullscreen"
            className="min-h-0 w-full flex-1 border-0 bg-transparent"
            onLoad={handleIframeLoad}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-5 sm:p-10">
          <div className="w-full max-w-xl rounded-2xl border border-border-subtle bg-bg p-5 sm:p-8 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center justify-center size-12 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)] text-white">
                <span className="material-symbols-outlined text-2xl">smart_toy</span>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-2 border border-border-subtle text-text-muted">
                {connection.status === "starting" || starting ? translate("Starting…") : translate("Stopped")}
              </span>
            </div>

            <h2 className="text-xl font-bold tracking-tight text-text-main">
              {translate("DeepSeek Harness Agent")}
            </h2>
            <p className="mt-2 text-sm text-text-muted leading-relaxed">
              {translate("Use harness sessions, files, terminal tools and approvals with your APIRouter models and combos.")}
            </p>

            {connection.error && (
              <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                <span className="material-symbols-outlined text-base shrink-0">error</span>
                <span>{translate(connection.error)}</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-6 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-white py-2.5 px-4 font-semibold text-sm transition-all shadow-[var(--shadow-warm)] cursor-pointer disabled:opacity-50"
                  onClick={() => handleStartHarness(false)}
                  disabled={starting}
                >
                  {starting && !pendingOpenTab ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>{translate("Starting Harness…")}</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">play_arrow</span>
                      <span>{translate("Start Agent Workspace")}</span>
                    </>
                  )}
                </button>

                {/* Option 1: Start & Open in separate tab immediately */}
                <button
                  type="button"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-subtle bg-surface-2 hover:bg-surface-3 text-text-main py-2.5 px-4 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                  onClick={() => handleStartHarness(true)}
                  disabled={starting}
                  title={translate("Start harness and open directly in a new browser tab")}
                >
                  {starting && pendingOpenTab ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <span>{translate("Opening in new tab…")}</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg text-primary">open_in_new</span>
                      <span>{translate("Start & Open Separately")}</span>
                    </>
                  )}
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => handleToggleAutoStart(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span>{translate("Auto-start when visiting page")}</span>
              </label>
            </div>

            {/* Separator / Manual instructions */}
            <div className="mt-6 pt-5 border-t border-border-subtle">
              <p className="text-xs text-text-muted">
                {translate("Or start manually from your terminal if you prefer independent logs:")}
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-border-subtle bg-surface-2 p-3 text-xs font-mono text-text-main select-all">
                <code>npm run harness:web</code>
              </pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  // If focusMode is active and not native fullscreen, portal directly to body to escape all container clipping & isolation
  if (focusMode && typeof document !== "undefined" && !document.fullscreenElement) {
    return (
      <>
        <div className="h-full w-full opacity-0" aria-hidden="true" />
        {createPortal(renderContent(), document.body)}
      </>
    );
  }

  return renderContent();
}
