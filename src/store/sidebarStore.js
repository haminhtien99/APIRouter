"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

const useSidebarStore = create(
  persist(
    (set, get) => ({
      isCollapsed: false,

      toggleSidebar: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }));
      },

      setCollapsed: (isCollapsed) => {
        set({ isCollapsed });
      },
    }),
    {
      name: "apirouter_sidebar_collapsed",
    }
  )
);

export default useSidebarStore;
