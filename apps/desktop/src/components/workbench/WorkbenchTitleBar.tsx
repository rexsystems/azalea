import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SavedWorkspace } from "../../lib/workspaces";
import { LAST_SYNC_EVENT, lastSyncAt, type SyncStatus } from "../../lib/api";
import { syncedLabel } from "../../lib/sessionInfo";
import { Logo } from "../Logo";
import { RestoreIcon } from "../TitleBar";
import {
  WbCheck,
  WbChevronDown,
  WbClose,
  WbMaximize,
  WbMinimize,
  WbPlus,
  WbSearch,
} from "./wbIcons";

export interface TitleBarWorkspaces {
  items: SavedWorkspace[];
  activeId: string | null;
  canSave: boolean;
  onOpen: (workspace: SavedWorkspace) => void;
  onSave: () => void;
  onManage: () => void;
}

interface WorkbenchTitleBarProps {
  onOpenPalette: () => void;
  onHome: () => void;
  workspaces: TitleBarWorkspaces;
  syncStatus: SyncStatus | null | undefined;
}

type SyncTone = "ok" | "warn" | "off";

function syncState(status: SyncStatus | null | undefined, last: number | null) {
  if (!status?.configured || !status.logged_in) {
    return { tone: "off" as SyncTone, label: "Local vault, sync off" };
  }
  if (status.auth_disconnected) return { tone: "warn" as SyncTone, label: "Sync signed out" };
  if (status.storage_blocked)
    return { tone: "warn" as SyncTone, label: "Sync paused, storage full" };
  if (!status.unlocked) return { tone: "warn" as SyncTone, label: "Vault locked" };
  return { tone: "ok" as SyncTone, label: syncedLabel(last) };
}

/**
 * Window chrome for the New and Minimal interfaces: brand, workspace switcher,
 * command menu trigger, sync state and the window controls. The bar is a drag
 * region except for its controls.
 */
export function WorkbenchTitleBar({
  onOpenPalette,
  onHome,
  workspaces,
  syncStatus,
}: WorkbenchTitleBarProps) {
  const [maximized, setMaximized] = useState(false);
  const [last, setLast] = useState(lastSyncAt);
  const [, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized);
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // Keep "Synced N min ago" current without a store: re-read on sync events
  // and re-render once a minute.
  useEffect(() => {
    const onSync = () => setLast(lastSyncAt());
    window.addEventListener(LAST_SYNC_EVENT, onSync);
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      window.removeEventListener(LAST_SYNC_EVENT, onSync);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const appWindow = getCurrentWindow();
  const active = workspaces.items.find((w) => w.id === workspaces.activeId) ?? null;
  const sync = syncState(syncStatus, last);

  const choose = (run: () => void) => {
    setMenuOpen(false);
    run();
  };

  return (
    <header data-tauri-drag-region className="wb-title">
      <button type="button" className="wb-brand" onClick={onHome} aria-label="Azalea home">
        <Logo size={18} className="wb-logo" />
        <span>Azalea</span>
      </button>

      <div className="wb-ws-wrap">
        <button
          ref={triggerRef}
          type="button"
          className="wb-ws"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Workspace: ${active?.name ?? "Default"}. Switch workspace`}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {active?.name ?? "Default"}
          <WbChevronDown />
        </button>
        {menuOpen && (
          <div ref={menuRef} className="wb-menu" role="menu" aria-label="Workspaces">
            {workspaces.items.length === 0 ? (
              <p className="wb-menu-note">
                No saved workspaces. Open the tabs you use together, then save them here.
              </p>
            ) : (
              workspaces.items.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.id === workspaces.activeId}
                  className="wb-menu-item"
                  onClick={() => choose(() => workspaces.onOpen(workspace))}
                >
                  <span className="wb-menu-label">{workspace.name}</span>
                  <span className="wb-menu-meta">
                    {workspace.tabs.length} {workspace.tabs.length === 1 ? "tab" : "tabs"}
                  </span>
                  {workspace.id === workspaces.activeId && <WbCheck className="wb-menu-check" />}
                </button>
              ))
            )}
            <div className="wb-menu-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="wb-menu-item"
              disabled={!workspaces.canSave}
              onClick={() => choose(workspaces.onSave)}
            >
              <WbPlus />
              <span className="wb-menu-label">Save open tabs as workspace</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="wb-menu-item"
              onClick={() => choose(workspaces.onManage)}
            >
              <span className="wb-menu-label">Manage workspaces</span>
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className="wb-cmdk"
        onClick={onOpenPalette}
        aria-label="Open command menu"
        aria-keyshortcuts="Control+/"
      >
        <WbSearch />
        <span>Search hosts, commands, files</span>
        <kbd className="wb-kbd">Ctrl /</kbd>
      </button>

      <div className="wb-sync" role="status">
        <span className={`wb-dot${sync.tone === "ok" ? "" : ` ${sync.tone}`}`} aria-hidden />
        {sync.label}
      </div>

      <div className="wb-winbtns">
        <button
          type="button"
          onClick={() => void appWindow.minimize()}
          aria-label="Minimize window"
          title="Minimize"
        >
          <WbMinimize />
        </button>
        <button
          type="button"
          onClick={() => void appWindow.toggleMaximize()}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <RestoreIcon size={12} /> : <WbMaximize />}
        </button>
        <button
          type="button"
          className="wb-winbtn-close"
          onClick={() => void appWindow.close()}
          aria-label="Close window"
          title="Close"
        >
          <WbClose />
        </button>
      </div>
    </header>
  );
}
