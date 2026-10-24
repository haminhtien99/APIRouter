"use client";

import { useCallback, useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";

export default function AgentPageClient() {
  const [connection, setConnection] = useState({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [frameTimeout, setFrameTimeout] = useState(false);

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

  const ready = connection.status === "ready" && launchUrl;
  const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-sm text-text-main hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface" aria-label={translate("Agent workspace")}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-green-500" : "bg-amber-500"}`} aria-hidden="true" />
          <span>{translate(ready ? "Harness reachable" : connection.status === "loading" ? "Checking harness…" : "Harness disconnected")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={() => { setGeneration((value) => value + 1); refresh(); }}>
            <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
            {translate("Reconnect")}
          </button>
          {ready && (
            <a className={buttonClass} href={launchUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <span className="material-symbols-outlined text-base" aria-hidden="true">open_in_new</span>
              {translate("Open separately")}
            </a>
          )}
        </div>
      </div>
      {ready ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!loaded && !frameTimeout && <p role="status" className="absolute inset-x-0 top-4 text-center text-sm text-text-muted">{translate("Loading Agent workspace…")}</p>}
          {frameTimeout && (
            <p role="status" className="shrink-0 border-b border-border-subtle px-3 py-2 text-sm text-text-muted">
              {translate("If the workspace is blank, open it separately to check browser permissions, then reconnect.")}
            </p>
          )}
          <iframe
            key={generation}
            src={launchUrl}
            title={translate("DeepSeek Harness Agent")}
            referrerPolicy="no-referrer"
            allow="clipboard-read; clipboard-write"
            className="min-h-0 w-full flex-1 border-0"
            onLoad={() => setLoaded(true)}
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
