"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const LOCAL_BASE_URL = "http://127.0.0.1:20228";

export default function EndpointPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [visibleKeys, setVisibleKeys] = useState(new Set());
  const { copied, copy } = useCopyToClipboard();

  const loadKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load API keys");
      setKeys(data.keys || []);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const createKey = async (event) => {
    event.preventDefault();
    const keyName = name.trim();
    if (!keyName) return;
    setSaving(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create API key");
      setName("");
      await loadKeys();
      setVisibleKeys((current) => new Set(current).add(data.id));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateKey = async (key) => {
    await fetch(`/api/keys/${key.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: key.isActive === false }),
    });
    await loadKeys();
  };

  const deleteKey = async (key) => {
    if (!window.confirm(`Delete API key “${key.name}”?`)) return;
    await fetch(`/api/keys/${key.id}`, { method: "DELETE" });
    await loadKeys();
  };

  const toggleVisible = (id) => {
    setVisibleKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="text-lg font-semibold mb-2">Local API endpoint</h2>
        <p className="text-sm text-text-muted mb-4">
          APIRouter listens only on this computer. Requests are routed directly to the selected provider.
        </p>
        <div className="flex gap-2">
          <Input value={`${LOCAL_BASE_URL}/v1`} readOnly className="font-mono" />
          <Button onClick={() => copy(`${LOCAL_BASE_URL}/v1`)}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-text-muted mt-3">Machine ID: <code>{machineId}</code></p>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold mb-4">API keys</h2>
        <form onSubmit={createKey} className="flex gap-2 mb-5">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Key name" />
          <Button type="submit" loading={saving} disabled={!name.trim()}>Create</Button>
        </form>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
        {loading ? <p className="text-sm text-text-muted">Loading…</p> : (
          <div className="flex flex-col gap-3">
            {keys.length === 0 && <p className="text-sm text-text-muted">No API keys yet.</p>}
            {keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{key.name}</p>
                  <code className="block truncate text-xs text-text-muted">
                    {visibleKeys.has(key.id) ? key.key : `${String(key.key || "").slice(0, 8)}••••••••••••`}
                  </code>
                </div>
                <Toggle checked={key.isActive !== false} onChange={() => updateKey(key)} />
                <Button variant="secondary" onClick={() => toggleVisible(key.id)}>
                  {visibleKeys.has(key.id) ? "Hide" : "Show"}
                </Button>
                <Button variant="secondary" onClick={() => copy(key.key)}>Copy</Button>
                <Button variant="ghost" onClick={() => deleteKey(key)}>Delete</Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
