"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import useSidebarStore from "@/store/sidebarStore";
import PanelLeftIcon from "./icons/PanelLeftIcon";
import Tooltip from "./Tooltip";
import { translate } from "@/i18n/runtime";

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const navItems = [
  { href: "/dashboard/agent", label: "Agent", icon: "smart_toy" },
  { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/dashboard/providers", label: "Providers", icon: "dns" },
  // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
  { href: "/dashboard/combos", label: "Combo & Vision Adapter", icon: "layers" },
  { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
  { href: "/dashboard/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
];

const debugItems = [
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate" },
];

export default function Sidebar({ onClose, isMobile = false, initialCollapsed = false }) {
  const pathname = usePathname();
  const isCollapsedStore = useSidebarStore((s) => s.isCollapsed);
  const isHydrated = useSidebarStore((s) => s.isHydrated);
  const isAnimating = useSidebarStore((s) => s.isAnimating);
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);

  // Before hydration, use initialCollapsed from cookie so SSR matches client 100%.
  // After hydration, follow the client store.
  const isCollapsed = isMobile
    ? false
    : (isHydrated ? isCollapsedStore : (initialCollapsed || isCollapsedStore));

  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaFlyoutOpen, setMediaFlyoutOpen] = useState(false);
  const [mediaFlyoutPos, setMediaFlyoutPos] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const mediaFlyoutRef = useRef(null);
  const mediaBtnRef = useRef(null);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Check for updates
  useEffect(() => {
    let checkMounted = true;
    const check = (refresh = false) => {
      fetch(refresh ? "/api/version?refresh=1" : "/api/version")
        .then((res) => res.ok ? res.json() : null)
        .then((data) => { if (checkMounted) setUpdateInfo(data?.hasUpdate ? data : null); })
        .catch(() => {});
    };
    check();
    const timer = setInterval(() => check(true), 5 * 60 * 1000);
    return () => { checkMounted = false; clearInterval(timer); };
  }, []);

  const toggleMediaFlyout = () => {
    if (!mediaFlyoutOpen && mediaBtnRef.current) {
      const rect = mediaBtnRef.current.getBoundingClientRect();
      setMediaFlyoutPos({ top: rect.top, left: rect.right + 8 });
      setMediaFlyoutOpen(true);
    } else {
      setMediaFlyoutOpen(false);
    }
  };

  // Close media flyout on outside click
  useEffect(() => {
    if (!mediaFlyoutOpen) return;
    const handleClickOutside = (e) => {
      if (
        mediaFlyoutRef.current &&
        !mediaFlyoutRef.current.contains(e.target) &&
        mediaBtnRef.current &&
        !mediaBtnRef.current.contains(e.target)
      ) {
        setMediaFlyoutOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mediaFlyoutOpen]);

  // Close media flyout on scroll or window resize
  useEffect(() => {
    if (!mediaFlyoutOpen) return;
    const handleScrollOrResize = () => setMediaFlyoutOpen(false);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [mediaFlyoutOpen]);

  // When expanding sidebar, close flyout
  useEffect(() => {
    if (!isCollapsed) {
      setMediaFlyoutOpen(false);
    }
  }, [isCollapsed]);

  const isActive = (href) => {
    if (href === "/dashboard/endpoint") {
      return pathname === "/dashboard" || pathname.startsWith("/dashboard/endpoint");
    }
    return pathname.startsWith(href);
  };

  const isMediaActive = pathname.startsWith("/dashboard/media-providers");

  return (
    <aside
      data-sidebar="true"
      suppressHydrationWarning
      className={cn(
        "flex flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl min-h-full shrink-0 select-none overflow-hidden",
        isAnimating && "transition-[width] duration-300 ease-in-out",
        isCollapsed ? "w-16" : "w-72"
      )}
    >
      {/* 1. Top Header: Traffic lights & Sidebar Toggle (Always rendered, never disappears) */}
      <div
        className={cn(
          "flex items-center",
          isAnimating && "transition-all duration-300",
          isCollapsed ? "flex-col gap-2 pt-3.5 pb-2 px-2" : "justify-between pt-4 pb-1 px-5"
        )}
      >
        <div className={cn("flex items-center", isCollapsed ? "gap-1.5" : "gap-2")}>
          <div className={cn("rounded-full bg-[#FF5F56]", isCollapsed ? "size-2.5" : "size-3")} />
          <div className={cn("rounded-full bg-[#FFBD2E]", isCollapsed ? "size-2.5" : "size-3")} />
          <div className={cn("rounded-full bg-[#27C93F]", isCollapsed ? "size-2.5" : "size-3")} />
        </div>

        {!isMobile && (
          <Tooltip
            text={translate(isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)")}
            position={isCollapsed ? "right" : "bottom"}
            className={isCollapsed ? "flex justify-center" : undefined}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              className={cn(
                "rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors cursor-pointer",
                isCollapsed ? "size-9 flex items-center justify-center" : "p-1.5"
              )}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeftIcon size={isCollapsed ? 18 : 16} />
            </button>
          </Tooltip>
        )}

        {isMobile && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors cursor-pointer"
            aria-label="Close sidebar"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>

      {/* 2. Logo & Brand: Unified container (Logo icon ALWAYS visible, text fades smoothly) */}
      <div
        className={cn(
          "py-2 overflow-hidden",
          isAnimating && "transition-all duration-300",
          isCollapsed ? "px-2 flex justify-center" : "px-5"
        )}
      >
        <Tooltip
          text="APIRouter"
          position="right"
          disabled={!isCollapsed}
          className={isCollapsed ? "flex justify-center" : "w-full"}
        >
          <Link
            href="/dashboard"
            onClick={isMobile ? onClose : undefined}
            className={cn(
              "flex items-center rounded-[10px] group",
              isCollapsed ? "justify-center size-9" : "gap-3 w-full"
            )}
            aria-label="APIRouter"
          >
            {/* The Gradient Logo Box - ALWAYS visible */}
            <div className="relative flex items-center justify-center size-9 rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-700 shadow-[var(--shadow-warm)] text-white shrink-0 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">hub</span>
              {updateInfo && (
                <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-surface" />
              )}
            </div>

            {/* Brand text: only shown when expanded */}
            {!isCollapsed && (
              <div className="flex flex-col min-w-0 overflow-hidden whitespace-nowrap">
                <h1 className="text-lg font-semibold tracking-tight text-text-main truncate">
                  {APP_CONFIG.name}
                </h1>
                <span className="text-xs text-text-muted">v{APP_CONFIG.version}</span>
              </div>
            )}
          </Link>
        </Tooltip>
      </div>

      {/* Update banner when expanded */}
      {!isCollapsed && updateInfo && (
        <div className="mx-5 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">
          <p className="font-semibold text-amber-600 dark:text-amber-400">
            {updateInfo.latestVersion === updateInfo.currentVersion
              ? "New APIRouter commits available"
              : `APIRouter v${updateInfo.latestVersion} available`}
          </p>
          <p className="mt-1 text-text-muted">
            Current: v{updateInfo.currentVersion}
            {updateInfo.latestVersion === updateInfo.currentVersion ? ` · New: ${updateInfo.latestCommit}` : ""}
          </p>
          <p className="mt-2 text-text-main">Exit APIRouter, then run in a terminal:</p>
          <code className="mt-1 block rounded bg-black/10 px-2 py-1 font-mono text-text-main dark:bg-white/10">apirouter update</code>
          <p className="mt-1 text-text-muted">Without npm link: run ./apirouter update in the project folder.</p>
          {updateInfo.hasLocalChanges && (
            <p className="mt-2 text-amber-600 dark:text-amber-400">Commit or stash local changes first.</p>
          )}
        </div>
      )}

      {/* 3. Navigation List (Unified elements: icons ALWAYS visible in both modes) */}
      <nav
        className={cn(
          "flex-1 py-2 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar",
          isCollapsed ? "px-2" : "px-4"
        )}
      >
        {navItems.map((item) => (
          <Tooltip
            key={item.href}
            text={translate(item.label)}
            position="right"
            disabled={!isCollapsed}
            className={isCollapsed ? "flex justify-center w-full" : "inline-flex w-full"}
          >
            <Link
              href={item.href}
              onClick={isMobile ? onClose : undefined}
              className={cn(
                "flex items-center rounded-lg group transition-colors",
                isCollapsed
                  ? "justify-center size-9 mx-auto"
                  : "gap-3 px-3 py-1.5 w-full",
                isActive(item.href)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
              aria-label={item.label}
            >
              <span
                className={cn(
                  "material-symbols-outlined shrink-0 text-[18px]",
                  isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                )}
              >
                {item.icon}
              </span>
              {!isCollapsed && (
                <span className="text-[13px] font-medium truncate">
                  {translate(item.label)}
                </span>
              )}
            </Link>
          </Tooltip>
        ))}

        {/* 4. System Section Divider */}
        <div className="pt-2 mt-2 border-t border-border-subtle/70">
          {!isCollapsed && (
            <p className="px-3 text-xs font-semibold text-text-muted/60 uppercase tracking-wider mb-1.5">
              System
            </p>
          )}
        </div>

        {/* 5. Media Providers: Unified button (Icon ALWAYS visible) */}
        <div className={cn("relative", isCollapsed ? "flex justify-center w-full" : "flex flex-col")}>
          <Tooltip
            text={translate("Media Providers")}
            position="right"
            disabled={!isCollapsed || mediaFlyoutOpen}
            className={isCollapsed ? "flex justify-center w-full" : "inline-flex w-full"}
          >
            <button
              ref={mediaBtnRef}
              type="button"
              onClick={() => {
                if (isCollapsed) {
                  toggleMediaFlyout();
                } else {
                  setMediaOpen((v) => !v);
                }
              }}
              className={cn(
                "flex items-center rounded-lg group cursor-pointer transition-colors",
                isCollapsed
                  ? "justify-center size-9 mx-auto"
                  : "gap-3 px-3 py-1.5 w-full",
                isMediaActive
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
              aria-label="Media Providers"
              aria-haspopup={isCollapsed ? "menu" : undefined}
              aria-expanded={isCollapsed ? mediaFlyoutOpen : mediaOpen}
            >
              <span className="material-symbols-outlined shrink-0 text-[18px]">
                perm_media
              </span>
              {!isCollapsed && (
                <>
                  <span className="text-[13px] font-medium flex-1 text-left truncate">
                    {translate("Media Providers")}
                  </span>
                  <span
                    className="material-symbols-outlined text-[14px] transition-transform"
                    style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    expand_more
                  </span>
                </>
              )}
            </button>
          </Tooltip>

          {/* Expanded mode accordion sub-items */}
          {!isCollapsed && mediaOpen && (
            <div className="pl-4 space-y-0.5 mt-0.5">
              {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                <Link
                  key={kind.id}
                  href={`/dashboard/media-providers/${kind.id}`}
                  onClick={isMobile ? onClose : undefined}
                  className={cn(
                    "flex items-center gap-3 px-4 py-1 rounded-lg transition-colors",
                    pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                  <span className="text-sm">{kind.label}</span>
                </Link>
              ))}
              <Link
                key={COMBINED_WEB_ITEM.id}
                href={COMBINED_WEB_ITEM.href}
                onClick={isMobile ? onClose : undefined}
                className={cn(
                  "flex items-center gap-3 px-4 py-1 rounded-lg transition-colors",
                  pathname.startsWith(COMBINED_WEB_ITEM.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
              </Link>
            </div>
          )}

          {/* Collapsed mode flyout popover (portaled to document.body) */}
          {isCollapsed && portalReady && mediaFlyoutOpen && mediaFlyoutPos && typeof document !== "undefined" && createPortal(
            <div
              ref={mediaFlyoutRef}
              className="fixed z-[9998] w-52 rounded-xl border border-border-subtle bg-surface/95 backdrop-blur-xl p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100"
              style={{
                top: `${mediaFlyoutPos.top}px`,
                left: `${mediaFlyoutPos.left}px`,
              }}
            >
              <div className="px-2 py-1 text-[11px] font-semibold text-text-muted/70 uppercase tracking-wider">
                Media Providers
              </div>
              {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                <Link
                  key={kind.id}
                  href={`/dashboard/media-providers/${kind.id}`}
                  onClick={() => setMediaFlyoutOpen(false)}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                    pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                  )}
                >
                  <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
                  <span>{kind.label}</span>
                </Link>
              ))}
              <Link
                href={COMBINED_WEB_ITEM.href}
                onClick={() => setMediaFlyoutOpen(false)}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                  pathname.startsWith(COMBINED_WEB_ITEM.href)
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
                <span>{COMBINED_WEB_ITEM.label}</span>
              </Link>
            </div>,
            document.body
          )}
        </div>

        {/* 6. Debug Items (Console Log, Translator) */}
        {debugItems.map((item) => {
          const show = item.href !== "/dashboard/translator" || enableTranslator;
          if (!show) return null;
          return (
            <Tooltip
              key={item.href}
              text={translate(item.label)}
              position="right"
              disabled={!isCollapsed}
              className={isCollapsed ? "flex justify-center w-full" : "inline-flex w-full"}
            >
              <Link
                href={item.href}
                onClick={isMobile ? onClose : undefined}
                className={cn(
                  "flex items-center rounded-lg group transition-colors",
                  isCollapsed
                    ? "justify-center size-9 mx-auto"
                    : "gap-3 px-3 py-1.5 w-full",
                  isActive(item.href)
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span
                  className={cn(
                    "material-symbols-outlined shrink-0 text-[18px]",
                    isActive(item.href) ? "fill-1" : "group-hover:text-primary transition-colors"
                  )}
                >
                  {item.icon}
                </span>
                {!isCollapsed && (
                  <span className="text-[13px] font-medium truncate">
                    {translate(item.label)}
                  </span>
                )}
              </Link>
            </Tooltip>
          );
        })}

        {/* 7. Settings (Always rendered) */}
        <Tooltip
          text={translate("Settings")}
          position="right"
          disabled={!isCollapsed}
          className={isCollapsed ? "flex justify-center w-full" : "inline-flex w-full"}
        >
          <Link
            href="/dashboard/profile"
            onClick={isMobile ? onClose : undefined}
            className={cn(
              "flex items-center rounded-lg group transition-colors",
              isCollapsed
                ? "justify-center size-9 mx-auto"
                : "gap-3 px-3 py-1.5 w-full",
              isActive("/dashboard/profile")
                ? "bg-primary/10 text-primary"
                : "text-text-muted hover:bg-surface-2 hover:text-text-main"
            )}
            aria-label="Settings"
          >
            <span
              className={cn(
                "material-symbols-outlined shrink-0 text-[18px]",
                isActive("/dashboard/profile") ? "fill-1" : "group-hover:text-primary transition-colors"
              )}
            >
              settings
            </span>
            {!isCollapsed && (
              <span className="text-[13px] font-medium truncate">
                {translate("Settings")}
              </span>
            )}
          </Link>
        </Tooltip>
      </nav>
    </aside>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  isMobile: PropTypes.bool,
  initialCollapsed: PropTypes.bool,
};
