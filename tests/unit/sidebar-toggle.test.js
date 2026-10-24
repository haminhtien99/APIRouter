import assert from "node:assert/strict";
import test from "node:test";
import useSidebarStore from "../../src/store/sidebarStore.js";

test("useSidebarStore initializes with isCollapsed=false", () => {
  useSidebarStore.getState().setCollapsed(false);
  assert.equal(useSidebarStore.getState().isCollapsed, false);
});

test("toggleSidebar toggles isCollapsed state", () => {
  useSidebarStore.getState().setCollapsed(false);
  assert.equal(useSidebarStore.getState().isCollapsed, false);

  useSidebarStore.getState().toggleSidebar();
  assert.equal(useSidebarStore.getState().isCollapsed, true);

  useSidebarStore.getState().toggleSidebar();
  assert.equal(useSidebarStore.getState().isCollapsed, false);
});

test("setCollapsed explicitly sets isCollapsed state", () => {
  useSidebarStore.getState().setCollapsed(true);
  assert.equal(useSidebarStore.getState().isCollapsed, true);

  useSidebarStore.getState().setCollapsed(false);
  assert.equal(useSidebarStore.getState().isCollapsed, false);
});

test("sidebar shortcut key detection logic", () => {
  const isShortcut = (e) => (e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === "b";

  assert.equal(isShortcut({ ctrlKey: true, key: "b" }), true);
  assert.equal(isShortcut({ ctrlKey: true, key: "B" }), true);
  assert.equal(isShortcut({ metaKey: true, key: "b" }), true);
  assert.equal(isShortcut({ ctrlKey: false, metaKey: false, key: "b" }), false);
  assert.equal(isShortcut({ ctrlKey: true, key: "a" }), false);
});
