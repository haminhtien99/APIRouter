"use client";

import { useEffect, useState } from "react";
import { Card, Toggle } from "@/shared/components";
import { CAVEMAN_LEVELS, PONYTAIL_LEVELS, WENYAN_LOCALES } from "../endpoint/endpointConstants";
import { getCurrentLocale, onLocaleChange } from "@/i18n/runtime";

export default function TokenSaverClient() {
  const [settings, setSettings] = useState({
    rtkEnabled: true,
    cavemanEnabled: false,
    cavemanLevel: "full",
    ponytailEnabled: false,
    ponytailLevel: "full",
    pxpipeEnabled: false,
  });
  const [locale, setLocale] = useState("en");

  useEffect(() => {
    setLocale(getCurrentLocale());
    const unsubscribe = onLocaleChange(() => setLocale(getCurrentLocale()));
    fetch("/api/settings")
      .then((response) => response.json())
      .then((data) => setSettings((current) => ({ ...current, ...data })))
      .catch(() => {});
    return unsubscribe;
  }, []);

  const patch = async (updates) => {
    setSettings((current) => ({ ...current, ...updates }));
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
  };

  const cavemanLevels = WENYAN_LOCALES.includes(locale)
    ? CAVEMAN_LEVELS
    : CAVEMAN_LEVELS.filter((level) => !level.wenyan);

  const saver = (title, description, enabledKey, levelKey, levels) => (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-text-muted mt-1">{description}</p>
        </div>
        <Toggle checked={settings[enabledKey] === true} onChange={() => patch({ [enabledKey]: settings[enabledKey] !== true })} />
      </div>
      {levels && settings[enabledKey] === true && (
        <div className="grid gap-2 mt-4 sm:grid-cols-3">
          {levels.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => patch({ [levelKey]: level.id })}
              className={`rounded-lg border p-3 text-left ${settings[levelKey] === level.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span className="block text-sm font-medium">{level.label}</span>
              <span className="block text-xs text-text-muted mt-1">{level.desc}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-5">
      {saver("RTK", "Compress large tool results locally before sending them to the provider.", "rtkEnabled")}
      {saver("Caveman", "Inject a concise response style locally.", "cavemanEnabled", "cavemanLevel", cavemanLevels)}
      {saver("Ponytail", "Prefer simpler implementations and reduce unnecessary output.", "ponytailEnabled", "ponytailLevel", PONYTAIL_LEVELS)}
      {saver("PXPIPE", "Transform large context locally when PXPIPE is installed.", "pxpipeEnabled")}
    </div>
  );
}
