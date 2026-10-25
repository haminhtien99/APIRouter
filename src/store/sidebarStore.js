"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const syncCookieAndStorage = (isCollapsed) => {
  if (typeof document !== "undefined") {
    try {
      document.cookie = `apirouter_sidebar_collapsed=${isCollapsed}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
    if (isCollapsed) {
      document.documentElement.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.documentElement.removeAttribute("data-sidebar-collapsed");
    }
  }
};

const getInitialCollapsed = () => {
  if (typeof window === "undefined") return false;
  try {
    if (window.location.pathname.startsWith("/dashboard/agent")) return true;
    const match = document.cookie.match(/(?:^|;\s*)apirouter_sidebar_collapsed=([^;]+)/);
    if (match) return match[1] === "true";
    const raw = localStorage.getItem("apirouter_sidebar_collapsed");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.state?.isCollapsed === "boolean") {
        return parsed.state.isCollapsed;
      }
    }
  } catch {}
  return false;
};

const useSidebarStore = create(
  persist(
    (set, get) => ({
      isCollapsed: getInitialCollapsed(),
      isHydrated: false,
      isAnimating: false,

      toggleSidebar: () => {
        set((state) => {
          const next = !state.isCollapsed;
          syncCookieAndStorage(next);
          return { isCollapsed: next, isAnimating: true };
        });
        if (typeof window !== "undefined") {
          setTimeout(() => {
            set({ isAnimating: false });
          }, 350);
        }
      },

      setCollapsed: (isCollapsed) => {
        set((state) => {
          if (state.isCollapsed === isCollapsed) return {};
          syncCookieAndStorage(isCollapsed);
          return { isCollapsed, isAnimating: true };
        });
        if (typeof window !== "undefined") {
          setTimeout(() => {
            set({ isAnimating: false });
          }, 350);
        }
      },
    }),
    {
      name: "apirouter_sidebar_collapsed",
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.isHydrated = true;
          syncCookieAndStorage(state.isCollapsed);
        }
      },
    }
  )
);

export default useSidebarStore;
