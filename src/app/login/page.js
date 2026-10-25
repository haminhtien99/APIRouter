"use client";

import { useState, useEffect } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetHint, setResetHint] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState(null);
  const [authMode, setAuthMode] = useState("password");
  const [ssoType, setSsoType] = useState("oidc");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcLoginLabel, setOidcLoginLabel] = useState("Sign in with OIDC");
  const [samlConfigured, setSamlConfigured] = useState(false);
  const [samlLoginLabel, setSamlLoginLabel] = useState("Sign in with SAML SSO");
  const [mustChange, setMustChange] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // LAN Sharing & 2-Step Gate State
  const [isLocal, setIsLocal] = useState(true);
  const [lanSharingEnabled, setLanSharingEnabled] = useState(false);
  const [lanVerified, setLanVerified] = useState(true);
  const [lanKey, setLanKey] = useState("");
  const [lanLoading, setLanLoading] = useState(false);
  const [lanError, setLanError] = useState("");
  const [lanRetryAfter, setLanRetryAfter] = useState(0);

  // Countdown for rate-limit
  useEffect(() => {
    if (retryAfter <= 0) return;
    const id = setInterval(() => setRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [retryAfter]);

  // Countdown for LAN rate-limit
  useEffect(() => {
    if (lanRetryAfter <= 0) return;
    const id = setInterval(() => setLanRetryAfter((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [lanRetryAfter]);

  useEffect(() => {
    async function checkAuth() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

      try {
        const res = await fetch(`${baseUrl}/api/auth/status`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated === true || data.requireLogin === false) {
            window.location.assign("/dashboard");
            return;
          }
          setIsLocal(data.isLocal !== false);
          setLanSharingEnabled(Boolean(data.lanSharingEnabled));
          setLanVerified(data.isLocal !== false || Boolean(data.lanVerified));
          setHasPassword(!!data.hasPassword);
          setAuthMode(data.authMode || "password");
          setSsoType(data.ssoType || "oidc");
          setOidcConfigured(data.oidcConfigured === true);
          setOidcLoginLabel(data.oidcLoginLabel || "Sign in with OIDC");
          setSamlConfigured(data.samlConfigured === true);
          setSamlLoginLabel(data.samlLoginLabel || "Sign in with SAML SSO");
        } else {
          setHasPassword(true);
        }
      } catch (err) {
        clearTimeout(timeoutId);
        setHasPassword(true);
      }
    }
    checkAuth();
  }, []);

  const handleLanVerify = async (e) => {
    e.preventDefault();
    if (!lanKey.trim()) return;
    setLanLoading(true);
    setLanError("");

    try {
      const res = await fetch("/api/auth/lan-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: lanKey.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLanVerified(true);
        setLanError("");
      } else {
        setLanError(data.error || "Invalid LAN Hash Key");
        if (data.retryAfter) setLanRetryAfter(Number(data.retryAfter));
      }
    } catch {
      setLanError("An error occurred while verifying LAN key. Please try again.");
    } finally {
      setLanLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResetHint("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.mustChangePassword) {
          setMustChange(true);
          return;
        }
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
        if (data.resetHint) setResetHint(data.resetHint);
        if (data.retryAfter) setRetryAfter(Number(data.retryAfter));
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Force a new password before entering the dashboard (default + remote).
  const handleSetNewPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      if (res.ok) {
        window.location.assign("/dashboard");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to set password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/start";
  };

  const handleSamlLogin = () => {
    window.location.href = "/api/auth/saml/start";
  };

  const isSsoEnabled = ["sso", "oidc", "saml", "both"].includes(authMode);
  const activeSsoType = ssoType || (authMode === "saml" ? "saml" : "oidc");

  const samlAvailable = isSsoEnabled && activeSsoType === "saml" && samlConfigured;
  const oidcAvailable = isSsoEnabled && activeSsoType === "oidc" && oidcConfigured;
  const ssoAvailable = samlAvailable || oidcAvailable;

  const passwordAvailable = authMode === "password" || authMode === "both" || !ssoAvailable;

  // Show loading state while checking status
  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  // Remote Access Blocked: LAN Sharing is disabled on the host
  const isRemoteLanDisabled = !isLocal && !lanSharingEnabled;

  // Remote Access Step 1: Remote client must verify LAN Hash Key first
  const showLanGate = !isLocal && lanSharingEnabled && !lanVerified;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
      {/* Faint grid background */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-primary mb-2">APIRouter</h1>
          <p className="text-text-muted text-sm">
            {isRemoteLanDisabled
              ? "LAN Network Access is Disabled"
              : showLanGate
              ? "LAN Security Verification (Xác minh mạng nội bộ)"
              : samlAvailable
              ? "Sign in with SAML 2.0 Single Sign-On"
              : oidcAvailable
              ? "Sign in with your OIDC provider to access the dashboard"
              : "Enter your password to access the dashboard"}
          </p>
        </div>

        <Card>
          {isRemoteLanDisabled ? (
            /* LAN sharing disabled state */
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <div className="size-12 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-1">
                <span className="material-symbols-outlined text-2xl">wifi_off</span>
              </div>
              <h3 className="text-base font-semibold text-text-main">
                LAN Sharing Disabled (Chia sẻ mạng LAN đang tắt)
              </h3>
              <p className="text-xs text-text-muted leading-relaxed max-w-xs">
                Máy chủ APIRouter hiện chưa bật tính năng chia sẻ kết nối mạng nội bộ. Vui lòng mở trang <b>Profile</b> trên máy chủ APIRouter để kích hoạt tính năng này.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => window.location.reload()}
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                Thử lại (Reload)
              </Button>
            </div>
          ) : showLanGate ? (
            /* STEP 1: LAN Hash Key Gate */
            <form onSubmit={handleLanVerify} className="flex flex-col gap-4">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-primary font-medium">
                <span className="material-symbols-outlined text-base shrink-0">shield</span>
                <span>Bước 1/2: Xác minh quyền truy cập mạng nội bộ (LAN Gate)</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-text-main">
                  LAN Hash Key (Khóa xác minh)
                </label>
                <Input
                  type="password"
                  placeholder="Nhập mã Hash Key (ví dụ: ar_lan_...)"
                  value={lanKey}
                  onChange={(e) => setLanKey(e.target.value)}
                  required
                  autoFocus
                  icon="key"
                />
                <p className="text-[11px] text-text-muted mt-0.5">
                  Mã này được quản trị viên máy chủ tạo và hiển thị trong mục <b>Profile → LAN Sharing</b> trên máy chủ chính.
                </p>
                {lanError && <p className="text-xs text-red-500 mt-1">{lanError}</p>}
                {lanRetryAfter > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Khóa tạm thời. Thử lại sau <span className="font-mono">{lanRetryAfter}s</span>.
                  </p>
                )}
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={lanLoading}
                disabled={!lanKey.trim() || lanRetryAfter > 0}
              >
                <span className="material-symbols-outlined text-base">verified_user</span>
                {lanRetryAfter > 0 ? `Chờ ${lanRetryAfter}s` : "Xác minh Hash Key (Next)"}
              </Button>
            </form>
          ) : mustChange ? (
            /* Password change required */
            <form onSubmit={handleSetNewPassword} className="flex flex-col gap-4">
              <p className="text-sm text-amber-600 dark:text-amber-400 text-center">
                Set a new password before accessing the dashboard remotely.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">New password</label>
                <Input
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>
              <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!newPassword}>
                Set password
              </Button>
            </form>
          ) : (
            /* STEP 2: Password Login / SSO */
            <div className="flex flex-col gap-4">
              {!isLocal && lanVerified && (
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-600 dark:text-green-400 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span>Bước 2/2: Xác minh mạng LAN hoàn tất</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setLanVerified(false)}
                    className="text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
                  >
                    Đổi khóa
                  </button>
                </div>
              )}

              {samlAvailable && (
                <Button type="button" variant="primary" className="w-full" onClick={handleSamlLogin}>
                  {samlLoginLabel}
                </Button>
              )}

              {oidcAvailable && (
                <Button type="button" variant="primary" className="w-full" onClick={handleOidcLogin}>
                  {oidcLoginLabel}
                </Button>
              )}

              {ssoAvailable && passwordAvailable && <div className="h-px bg-border/60" />}

              {passwordAvailable ? (
                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  {isSsoEnabled && !ssoAvailable && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                      {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login is enabled, but configuration is incomplete. Password login is still available for recovery.
                    </p>
                  )}

                  {authMode === "both" && ssoAvailable && (
                    <p className="text-xs text-text-muted text-center">
                      Password and {activeSsoType === "saml" ? "SAML SSO" : "OIDC"} login are both enabled.
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Password</label>
                    <Input
                      type="password"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus={!oidcAvailable}
                      icon="lock"
                    />
                    {error && <p className="text-xs text-red-500">{error}</p>}
                    {retryAfter > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Locked. Retry in <span className="font-mono">{retryAfter}s</span>.
                      </p>
                    )}
                    {resetHint && (
                      <p className="text-xs text-text-muted">
                        Forgot password? Open <code className="bg-sidebar px-1 rounded">apirouter</code> CLI on the host → <b>Settings</b> → <b>Reset Password to Default</b>.
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    loading={loading}
                    disabled={retryAfter > 0}
                  >
                    {retryAfter > 0 ? `Wait ${retryAfter}s` : "Login"}
                  </Button>

                  <p className="text-xs text-center text-text-muted mt-2">
                    Default password is <code className="bg-sidebar px-1 rounded">123456</code>
                  </p>
                  {hasPassword === false && isLocal && (
                    <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                      Security risk: no password set. Please set a password in your Profile.
                    </p>
                  )}
                </form>
              ) : (
                error && <p className="text-xs text-red-500">{error}</p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
