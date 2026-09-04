import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Host,
  HostGroup,
  HostKeyMismatchEvent,
  HostKeyUnknownEvent,
  HostOsUpdatedEvent,
  ImportBackupResult,
  ImportResult,
} from "@azalea/shared";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ArrowLeftRight, Columns2, ExternalLink, FolderTree, SquareTerminal, Zap } from "./components/icons";
import * as api from "./lib/api";
import type { HostFormValues } from "./lib/utils";
import { looksLikeUnreachableError, parseQuickConnect, wolBroadcastForHost } from "./lib/utils";
import { useGroups } from "./hooks/useGroups";
import { useHosts } from "./hooks/useHosts";
import { useKeys } from "./hooks/useKeys";
import { useConnectScreen } from "./hooks/useConnectScreen";
import { useSyncStatus } from "./hooks/useSyncStatus";
import { useTerminalSettings } from "./hooks/useTerminalSettings";
import { useTheme } from "./hooks/useTheme";
import { AddServerDrawer } from "./components/AddServerDrawer";
import { AutoSyncPrompt } from "./components/AutoSyncPrompt";
import { CommandPalette, type CommandPaletteActionId } from "./components/CommandPalette";
import { SyncResolutionDialog } from "./components/SyncResolutionDialog";
import { AppShell, type NavPage } from "./components/AppShell";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { ReconnectOverlay, type ReconnectInfo, type ReconnectPhase } from "./components/ReconnectOverlay";
import { FileBrowserPanel } from "./components/FileBrowserPanel";
import { ForwardsPopover } from "./components/ForwardsPopover";
import { HomePage } from "./components/HomePage";
import { HostsPage } from "./components/HostsPage";
import { KeysPage } from "./components/KeysPage";
import { SettingsPage } from "./components/SettingsPage";
import { SnippetsPopover } from "./components/SnippetsPopover";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/Terminal";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ConnectionErrorDialog } from "./components/ui/ConnectionErrorDialog";
import { PromptDialog } from "./components/ui/PromptDialog";
import { SelectHostDialog } from "./components/ui/SelectHostDialog";
import { SelectKeyDialog } from "./components/ui/SelectKeyDialog";
import {
  collectAppSettings,
  exportBackupToFile,
  importBackupFromFile,
  type AppSettingsExport,
} from "./lib/backup";
import { checkForUpdateSilent } from "./lib/updater";
import { getStoredAutoSync, setStoredAutoSync } from "./lib/settings";
import { useIsMobile } from "./hooks/useIsMobile";

interface TabSession {
  id: string;
  hostId: string;
  title: string;
  hostname: string;
  port: number;
  username: string;
  status: "connecting" | "connected" | "disconnected" | "error" | "reconnecting";
  error?: string;
  logs: string[];
  hadConnected?: boolean;
  splitWithId?: string;
  poppedOut?: boolean;
}

interface ConnectionErrorState {
  sessionId: string;
  hostId: string;
  hostName: string;
  message: string;
  logs: string[];
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface PromptState {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
}

function App() {
  const { hosts, createHost, updateHost, removeHost, refresh: refreshHosts } = useHosts();
  const { keys, generateKey, importKey, removeKey, refresh: refreshKeys } = useKeys();
  const {
    groups,
    createGroup,
    updateGroup,
    removeGroup,
    moveHostToGroup,
    refresh: refreshGroups,
  } = useGroups();
  const { theme, changeTheme } = useTheme();
  const { connectScreen, changeConnectScreen } = useConnectScreen();
  const { status: syncStatus, setStatus: setSyncStatus, refresh: refreshSyncStatus } =
    useSyncStatus();
  const { terminalSettings, updateTerminalSettings } = useTerminalSettings();

  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Ready");

  const [navPage, setNavPage] = useState<NavPage>("home");
  const [viewingTerminal, setViewingTerminal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [drawerInitial, setDrawerInitial] = useState<Partial<HostFormValues>>();
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PromptState | null>(null);
  const [connectionError, setConnectionError] = useState<ConnectionErrorState | null>(null);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [focusSettingsSync, setFocusSettingsSync] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [keyPickerHost, setKeyPickerHost] = useState<Host | null>(null);
  const keyPickerResolver = useRef<((keyId: string | null) => void) | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const closingTabsRef = useRef(new Set<string>());
  const reconnectTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const reconnectPhaseTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>[]>());
  const reconnectAttemptsRef = useRef(new Map<string, number>());
  const [reconnectUi, setReconnectUi] = useState<Record<string, ReconnectInfo>>({});
  const [filesPanelTabs, setFilesPanelTabs] = useState<Set<string>>(() => new Set());
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [forwardsOpen, setForwardsOpen] = useState(false);
  const [keyMismatch, setKeyMismatch] = useState<HostKeyMismatchEvent | null>(null);
  const [unknownHostKey, setUnknownHostKey] = useState<HostKeyUnknownEvent | null>(null);
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [autoSyncPrompt, setAutoSyncPrompt] = useState<{ email: string | null } | null>(null);
  const [autoSyncPreview, setAutoSyncPreview] = useState<api.SyncPreview | null>(null);
  const [autoSyncBusy, setAutoSyncBusy] = useState(false);

  useEffect(() => {
    if (connectionError) setPendingConfirm(null);
  }, [connectionError]);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const autoSyncCheckedRef = useRef(false);
  const isMobile = useIsMobile();

  const hasTabs = tabs.some((t) => !t.poppedOut);

  useEffect(() => {
    if (isMobile) return;
    void checkForUpdateSilent().then((result) => {
      if (result) {
        setStatusMessage(
          `Update available: Azalea ${result.version} — open Settings → Updates to install`,
        );
      }
    });
  }, [isMobile]);

  const DEFAULT_COLS = 120;
  const DEFAULT_ROWS = 30;

  const hostNeedsKey = useCallback(async (host: Host) => {
    if (host.key_id) return false;
    if (await api.hostHasPassword(host.id)) return false;
    return true;
  }, []);

  const pickKeyForHost = useCallback(
    (host: Host) =>
      new Promise<string | null>((resolve) => {
        if (keys.length === 0) {
          setStatusMessage("Add an SSH key in Keychain first.");
          resolve(null);
          return;
        }
        keyPickerResolver.current = resolve;
        setKeyPickerHost(host);
      }),
    [keys.length],
  );

  const connectToHost = useCallback(async (host: Host) => {
    let target = host;
    if (await hostNeedsKey(host)) {
      const keyId = await pickKeyForHost(host);
      if (!keyId) return;
      target = await updateHost(host.id, { auth_type: "key", key_id: keyId });
      setStatusMessage(`Saved key on ${host.name}`);
    }

    setConnectingHostId(target.id);
    setConnectionError(null);
    setStatusMessage(`Connecting to ${target.name}...`);

    let sessionId = "";
    try {
      sessionId = await api.prepareSsh(target.id);
      setTabs((prev) => [
        ...prev,
        {
          id: sessionId,
          hostId: target.id,
          title: target.name,
          hostname: target.hostname,
          port: target.port,
          username: target.username,
          status: "connecting",
          logs: ["Starting session..."],
        },
      ]);
      setActiveTabId(sessionId);
      setViewingTerminal(true);

      await api.startSsh(sessionId, DEFAULT_COLS, DEFAULT_ROWS);
    } catch (err) {
      const msg = String(err);
      setStatusMessage(`Connection failed: ${msg}`);
      const logs = [`Failed to start session: ${msg}`];
      if (sessionId) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === sessionId ? { ...t, status: "error" as const, error: msg, logs } : t,
          ),
        );
      }
      setConnectionError({
        sessionId,
        hostId: target.id,
        hostName: target.name,
        message: msg,
        logs,
      });
    } finally {
      setConnectingHostId(null);
    }
  }, [hostNeedsKey, pickKeyForHost, updateHost]);

  const openLocalTerminal = useCallback(() => {
    const sessionId = api.createLocalSessionId();
    setTabs((prev) => [
      ...prev,
      {
        id: sessionId,
        hostId: "local",
        title: "Local Terminal",
        hostname: "localhost",
        port: 0,
        username: "",
        status: "connecting",
        logs: [],
        hadConnected: true,
      },
    ]);
    setActiveTabId(sessionId);
    setViewingTerminal(true);
    setStatusMessage("Local terminal");
  }, []);

  const popOutActiveTab = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.poppedOut) return;

    const popout = new WebviewWindow(`popout-${tab.id}`, {
      url: `/?popout=${encodeURIComponent(tab.id)}&title=${encodeURIComponent(tab.title)}`,
      title: `${tab.title} — Azalea`,
      width: 900,
      height: 560,
      minWidth: 480,
      minHeight: 320,
      decorations: false,
      transparent: false,
    });

    void popout.once("tauri://created", () => {
      setTabs((prev) => {
        // Un-split before popping out; the pane can't be in two windows.
        const next = prev.map((t) => {
          if (t.id === tab.id) return { ...t, poppedOut: true, splitWithId: undefined };
          if (t.splitWithId === tab.id) return { ...t, splitWithId: undefined };
          return t;
        });
        setActiveTabId((current) => {
          if (current !== tab.id) return current;
          const fallback = next.find((t) => t.id !== tab.id && !t.poppedOut);
          if (!fallback) setViewingTerminal(false);
          return fallback?.id ?? null;
        });
        return next;
      });
    });

    void popout.once("tauri://error", (err) => {
      setStatusMessage(`Pop out failed: ${JSON.stringify(err.payload)}`);
    });

    void popout.once("tauri://destroyed", () => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, poppedOut: false } : t)),
      );
    });
  }, [tabs, activeTabId]);

  const handleTerminalResize = useCallback((sessionId: string, cols: number, rows: number) => {
    void api.resizeTerminal(sessionId, cols, rows);
  }, []);

  const sendCommandToTerminal = useCallback((sessionId: string, command: string) => {
    const bytes = new TextEncoder().encode(`${command}\n`);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    void api.writeTerminal(sessionId, btoa(binary));
  }, []);

  const splitActiveTab = useCallback(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    if (tab.splitWithId) {
      // Already split: unsplit (keep both tabs open).
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id || t.id === tab.splitWithId ? { ...t, splitWithId: undefined } : t,
        ),
      );
      return;
    }

    setSplitPickerOpen(true);
  }, [tabs, activeTabId]);

  const openSplitSession = useCallback(
    async (host: Host) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;

      let target = host;
      if (await hostNeedsKey(host)) {
        const keyId = await pickKeyForHost(host);
        if (!keyId) return;
        target = await updateHost(host.id, { auth_type: "key", key_id: keyId });
      }

      try {
        const sessionId = await api.prepareSsh(target.id);
        setTabs((prev) => {
          const anchorIndex = prev.findIndex((t) => t.id === tab.id);
          const next = prev.map((t) =>
            t.id === tab.id ? { ...t, splitWithId: sessionId } : t,
          );
          const newTab: TabSession = {
            id: sessionId,
            hostId: target.id,
            title: target.name,
            hostname: target.hostname,
            port: target.port,
            username: target.username,
            status: "connecting",
            logs: ["Starting session..."],
            splitWithId: tab.id,
          };
          // Keep the split tab glued to its partner in the tab bar.
          next.splice(anchorIndex + 1, 0, newTab);
          return next;
        });
        await api.startSsh(sessionId, DEFAULT_COLS, DEFAULT_ROWS);
      } catch (err) {
        setStatusMessage(`Split failed: ${String(err)}`);
      }
    },
    [tabs, activeTabId, hostNeedsKey, pickKeyForHost, updateHost],
  );

  const removeTab = useCallback((tabId: string) => {
    setFilesPanelTabs((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    reconnectAttemptsRef.current.delete(tabId);
    setReconnectUi((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
    const phaseTimers = reconnectPhaseTimersRef.current.get(tabId);
    if (phaseTimers) {
      for (const timer of phaseTimers) clearTimeout(timer);
      reconnectPhaseTimersRef.current.delete(tabId);
    }
    const reconnectTimer = reconnectTimersRef.current.get(tabId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimersRef.current.delete(tabId);
    }
    setTabs((prev) => {
      const next = prev
        .filter((tab) => tab.id !== tabId)
        .map((tab) => (tab.splitWithId === tabId ? { ...tab, splitWithId: undefined } : tab));
      setActiveTabId((current) => {
        if (current !== tabId) return current;
        return next[next.length - 1]?.id ?? null;
      });
      if (next.length === 0) setViewingTerminal(false);
      return next;
    });
  }, []);

  const clearReconnectPhaseTimers = useCallback((sessionId: string) => {
    const timers = reconnectPhaseTimersRef.current.get(sessionId);
    if (!timers) return;
    for (const timer of timers) clearTimeout(timer);
    reconnectPhaseTimersRef.current.delete(sessionId);
  }, []);

  const clearReconnectTimer = useCallback(
    (sessionId: string) => {
      const timer = reconnectTimersRef.current.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        reconnectTimersRef.current.delete(sessionId);
      }
      clearReconnectPhaseTimers(sessionId);
    },
    [clearReconnectPhaseTimers],
  );

  const clearReconnectState = useCallback(
    (sessionId: string) => {
      clearReconnectTimer(sessionId);
      reconnectAttemptsRef.current.delete(sessionId);
      setReconnectUi((prev) => {
        if (!(sessionId in prev)) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    [clearReconnectTimer],
  );

  const setReconnectPhase = useCallback((sessionId: string, phase: ReconnectPhase, patch?: Partial<ReconnectInfo>) => {
    setReconnectUi((prev) => {
      const current = prev[sessionId];
      if (!current) return prev;
      return {
        ...prev,
        [sessionId]: { ...current, ...patch, phase },
      };
    });
  }, []);

  const RECONNECT_DELAYS_MS = [2500, 5000, 10000, 20000, 30000] as const;

  const scheduleReconnect = useCallback(
    (sessionId: string, lastError?: string) => {
      if (closingTabsRef.current.has(sessionId)) return;
      if (reconnectTimersRef.current.has(sessionId)) return;

      const attempt = reconnectAttemptsRef.current.get(sessionId) ?? 0;
      const delay =
        RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30000;
      const nextRetryAt = Date.now() + delay;
      reconnectAttemptsRef.current.set(sessionId, attempt + 1);

      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId
            ? { ...tab, status: "reconnecting" as const, error: lastError ?? tab.error }
            : tab,
        ),
      );

      setReconnectUi((prev) => ({
        ...prev,
        [sessionId]: {
          attempt: attempt + 1,
          nextRetryAt,
          phase: "disconnected",
          lastError,
        },
      }));

      if (attempt === 0) {
        setStatusMessage("Disconnected — checking host…");
      }

      clearReconnectPhaseTimers(sessionId);
      const phaseTimers: ReturnType<typeof setTimeout>[] = [];
      const checkAt = Math.min(900, Math.floor(delay * 0.35));
      phaseTimers.push(
        setTimeout(() => setReconnectPhase(sessionId, "checking"), checkAt),
      );

      const timer = setTimeout(() => {
        reconnectTimersRef.current.delete(sessionId);
        clearReconnectPhaseTimers(sessionId);
        setReconnectPhase(sessionId, "reconnecting", { nextRetryAt: Date.now() });
        void api.reconnectSsh(sessionId, DEFAULT_COLS, DEFAULT_ROWS).catch((err) => {
          scheduleReconnect(sessionId, String(err).replace(/^Error:\s*/, ""));
        });
      }, delay);

      reconnectPhaseTimersRef.current.set(sessionId, phaseTimers);
      reconnectTimersRef.current.set(sessionId, timer);
    },
    [clearReconnectPhaseTimers, setReconnectPhase],
  );

  const retryReconnectNow = useCallback(
    (sessionId: string) => {
      if (closingTabsRef.current.has(sessionId)) return;
      clearReconnectTimer(sessionId);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === sessionId ? { ...tab, status: "reconnecting" as const } : tab,
        ),
      );
      setReconnectUi((prev) => ({
        ...prev,
        [sessionId]: {
          attempt: reconnectAttemptsRef.current.get(sessionId) ?? 1,
          nextRetryAt: Date.now(),
          phase: "reconnecting",
          lastError: prev[sessionId]?.lastError,
        },
      }));
      void api.reconnectSsh(sessionId, DEFAULT_COLS, DEFAULT_ROWS).catch((err) => {
        scheduleReconnect(sessionId, String(err).replace(/^Error:\s*/, ""));
      });
    },
    [clearReconnectTimer, scheduleReconnect],
  );

  const closeTab = useCallback(
    async (tabId: string) => {
      closingTabsRef.current.add(tabId);
      clearReconnectState(tabId);
      if (api.isLocalSession(tabId)) {
        await api.closeLocalTerminal(tabId).catch(() => undefined);
      } else {
        await api.disconnectSsh(tabId).catch(() => undefined);
      }
      removeTab(tabId);
      closingTabsRef.current.delete(tabId);
    },
    [clearReconnectState, removeTab],
  );


  useEffect(() => {
    const unlistenStatus = listen<{ session_id: string; status: string; error?: string }>(
      "terminal-status",
      (event) => {
        const { session_id, status, error } = event.payload;

        // Local shell ended (exit / process killed): just close the tab.
        if (status === "exited") {
          removeTab(session_id);
          return;
        }

        if (status === "disconnected") {
          if (closingTabsRef.current.has(session_id)) return;
          if (api.isLocalSession(session_id)) return;
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === session_id ? { ...tab, status: "disconnected" as const } : tab,
            ),
          );
          scheduleReconnect(session_id);
          return;
        }

        if (status === "error") {
          const msg = error ?? "Connection failed";

          if (msg === "HOST_KEY_CHANGED") {
            // Key mismatch dialog is triggered by the host-key-mismatch event;
            // never auto-reconnect into the same failure.
            clearReconnectState(session_id);
            setTabs((prev) =>
              prev.map((t) =>
                t.id === session_id
                  ? { ...t, status: "error" as const, error: "Server key changed" }
                  : t,
              ),
            );
            setStatusMessage("Server host key changed");
            return;
          }

          setTabs((prev) => {
            const tab = prev.find((t) => t.id === session_id);
            const logs = tab ? [...tab.logs, `Error: ${msg}`] : [`Error: ${msg}`];
            if (tab && !tab.hadConnected) {
              setConnectionError({
                sessionId: session_id,
                hostId: tab.hostId,
                hostName: tab.title,
                message: msg,
                logs,
              });
              setStatusMessage(msg);
            } else if (tab?.hadConnected) {
              // Mid-session drop: stay in-terminal with cooldown reconnect UI.
              scheduleReconnect(session_id, msg);
            }
            return prev.map((t) =>
              t.id === session_id
                ? {
                    ...t,
                    status: tab?.hadConnected ? ("reconnecting" as const) : ("error" as const),
                    error: msg,
                    logs,
                  }
                : t,
            );
          });
          return;
        }

        if (status === "connected") {
          clearReconnectState(session_id);
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === session_id
                ? {
                    ...tab,
                    status: "connected" as const,
                    error: undefined,
                    hadConnected: true,
                  }
                : tab,
            ),
          );
          setStatusMessage("Connected");
          return;
        }

        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === session_id
              ? {
                  ...tab,
                  status: status as TabSession["status"],
                  error,
                  hadConnected: tab.hadConnected,
                }
              : tab,
          ),
        );
      },
    );

    const unlistenLog = listen<{ session_id: string; message: string }>(
      "connection-log",
      (event) => {
        const { session_id, message } = event.payload;
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === session_id ? { ...tab, logs: [...tab.logs, message] } : tab,
          ),
        );
      },
    );

    const unlistenMismatch = listen<HostKeyMismatchEvent>("host-key-mismatch", (event) => {
      setKeyMismatch(event.payload);
    });

    const unlistenUnknown = listen<HostKeyUnknownEvent>("host-key-unknown", (event) => {
      setUnknownHostKey(event.payload);
    });

    const unlistenOs = listen<HostOsUpdatedEvent>("host-os-updated", () => {
      void refreshHosts();
    });

    return () => {
      void unlistenStatus.then((unlisten) => unlisten());
      void unlistenLog.then((unlisten) => unlisten());
      void unlistenMismatch.then((unlisten) => unlisten());
      void unlistenUnknown.then((unlisten) => unlisten());
      void unlistenOs.then((unlisten) => unlisten());
    };
  }, [scheduleReconnect, clearReconnectState, removeTab, refreshHosts]);

  const openAddDrawer = (groupId?: string | null, initial?: Partial<HostFormValues>) => {
    setEditingHost(null);
    setDrawerInitial(initial);
    setDefaultGroupId(groupId ?? null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingHost(null);
    setDrawerInitial(undefined);
    setDefaultGroupId(null);
  };

  const openEditDrawer = (host: Host) => {
    if (drawerOpen && editingHost?.id === host.id) {
      closeDrawer();
      return;
    }
    setEditingHost(host);
    setDrawerInitial(undefined);
    setDefaultGroupId(null);
    setDrawerOpen(true);
  };

  const requestCloseTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const isLocal = api.isLocalSession(tabId);
    setPendingConfirm({
      title: isLocal ? "Close terminal?" : "Close connection?",
      message: isLocal
        ? `Close "${tab.title}"? Anything running in it will be stopped.`
        : `Disconnect from "${tab.title}"?`,
      confirmLabel: "Close",
      danger: true,
      onConfirm: () => void closeTab(tabId),
    });
  };

  const requestDeleteHost = (host: Host) => {
    setPendingConfirm({
      title: "Delete host?",
      message: `"${host.name}" will be removed permanently.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        void removeHost(host.id);
        setStatusMessage(`Deleted ${host.name}`);
        if (editingHost?.id === host.id) closeDrawer();
      },
    });
  };

  const handleQuickConnect = () => {
    const parsed = parseQuickConnect(searchQuery);
    if (!parsed.hostname) return;
    openAddDrawer(null, parsed);
  };

  const handleHostSubmit = async (values: HostFormValues, connectAfter: boolean) => {
    const payload = {
      name: values.name,
      hostname: values.hostname,
      port: values.port,
      username: values.username,
      auth_type: values.auth_type,
      key_id: values.key_id,
      group_id: values.group_id,
      password: values.password ? values.password : undefined,
      mac_address: values.mac_address.trim() || null,
    };

    if (editingHost) {
      const updated = await updateHost(editingHost.id, payload);
      setStatusMessage(`Updated ${values.name}`);
      if (connectAfter) await connectToHost(updated);
      return;
    }

    const created = await createHost({
      ...payload,
      password: payload.password ?? null,
    });
    setStatusMessage(`Added ${values.name}`);
    if (connectAfter) await connectToHost(created);
  };

  const handleDeleteHost = (host: Host) => {
    requestDeleteHost(host);
  };

  const handleAddGroup = () => {
    setPendingPrompt({
      title: "New group",
      placeholder: "Group name",
      confirmLabel: "Create",
      onConfirm: (name) => {
        void createGroup({ name }).then(() => refreshGroups());
      },
    });
  };

  const handleRenameGroup = (group: HostGroup) => {
    setPendingPrompt({
      title: "Rename group",
      defaultValue: group.name,
      confirmLabel: "Save",
      onConfirm: (name) => {
        if (name !== group.name) void updateGroup(group.id, name);
      },
    });
  };

  const handleDeleteGroup = (group: HostGroup) => {
    setPendingConfirm({
      title: "Delete group?",
      message: `"${group.name}" will be deleted. Servers in this group will be ungrouped.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        void removeGroup(group.id).then(() => void refreshHosts());
      },
    });
  };

  const handleMoveHost = async (hostId: string, groupId: string | null) => {
    await moveHostToGroup(hostId, groupId);
    await refreshHosts();
  };

  const handleNavigate = (page: NavPage) => {
    setNavPage(page);
    setViewingTerminal(false);
  };

  const handleSignInForSync = useCallback(() => {
    setNavPage("settings");
    setViewingTerminal(false);
    setFocusSettingsSync(true);
    void (async () => {
      try {
        setStatusMessage("Opening browser to sign in…");
        await api.syncBrowserLogin();
        await refreshSyncStatus();
        setStatusMessage("Signed in.");
      } catch (err) {
        setStatusMessage(`Sign in failed: ${String(err).replace(/^Error:\s*/, "")}`);
      }
    })();
  }, [refreshSyncStatus]);

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setViewingTerminal(true);
    setConnectionError(null);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === "/") {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
        return;
      }

      if (commandPaletteOpen) return;

      if (e.ctrlKey && key === "tab") {
        const cycle = tabs.filter((t) => !t.poppedOut);
        if (cycle.length === 0) return;
        e.preventDefault();
        const index = cycle.findIndex((t) => t.id === activeTabId);
        const step = e.shiftKey ? -1 : 1;
        const next = cycle[(index + step + cycle.length) % cycle.length];
        if (next) {
          setActiveTabId(next.id);
          setViewingTerminal(true);
        }
        return;
      }

      if (e.ctrlKey && e.shiftKey && key === "w") {
        if (!viewingTerminal || !activeTabId) return;
        e.preventDefault();
        requestCloseTab(activeTabId);
        return;
      }

      if (e.ctrlKey && e.shiftKey && key === "t") {
        if (!viewingTerminal || !activeTabId) return;
        e.preventDefault();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab && api.isLocalSession(tab.id)) {
          void openLocalTerminal();
          return;
        }
        const host = tab ? hosts.find((h) => h.id === tab.hostId) : undefined;
        if (host) void connectToHost(host);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleCommandPaletteAction = useCallback(
    (id: CommandPaletteActionId) => {
      if (id === "nav-home") {
        handleNavigate("home");
        return;
      }
      if (id === "nav-hosts") {
        handleNavigate("hosts");
        return;
      }
      if (id === "nav-keys") {
        handleNavigate("keys");
        return;
      }
      if (id === "nav-settings") {
        handleNavigate("settings");
        return;
      }
      if (id === "action-new-host") {
        handleNavigate("hosts");
        openAddDrawer();
        return;
      }
      if (id === "action-new-group") {
        handleNavigate("hosts");
        handleAddGroup();
        return;
      }
      if (id === "action-local-terminal") {
        void openLocalTerminal();
        return;
      }
      if (id === "action-sign-in") {
        handleSignInForSync();
        return;
      }
      if (id.startsWith("host:")) {
        const hostId = id.slice(5);
        const host = hosts.find((h) => h.id === hostId);
        if (host) void connectToHost(host);
        return;
      }
      if (id.startsWith("key:")) {
        handleNavigate("keys");
      }
    },
    [
      handleNavigate,
      openAddDrawer,
      handleAddGroup,
      openLocalTerminal,
      handleSignInForSync,
      hosts,
      connectToHost,
    ],
  );
  const dismissConnectionError = () => {
    const err = connectionError;
    setConnectionError(null);
    setWakeBusy(false);
    if (err?.sessionId) {
      void closeTab(err.sessionId);
    }
  };

  const retryConnection = () => {
    const err = connectionError;
    if (!err) return;
    const host = hosts.find((h) => h.id === err.hostId);
    setConnectionError(null);
    setWakeBusy(false);
    if (err.sessionId) {
      void closeTab(err.sessionId).then(() => {
        if (host) void connectToHost(host);
      });
    } else if (host) {
      void connectToHost(host);
    }
  };

  const wakeAndRetry = async () => {
    const err = connectionError;
    if (!err || wakeBusy) return;
    const host = hosts.find((h) => h.id === err.hostId);
    if (!host?.mac_address) return;

    setWakeBusy(true);
    setStatusMessage(`Sending wake packet to ${host.name}…`);
    try {
      await api.wakeOnLan(host.mac_address, wolBroadcastForHost(host.hostname));
      setStatusMessage(`Wake sent. Waiting for ${host.name} to come up…`);
      await new Promise((resolve) => setTimeout(resolve, 4500));
      setConnectionError(null);
      if (err.sessionId) {
        await closeTab(err.sessionId);
      }
      await connectToHost(host);
    } catch (e) {
      setStatusMessage(`Wake failed: ${String(e)}`);
    } finally {
      setWakeBusy(false);
    }
  };

  const wakeHost = async (host: Host) => {
    if (!host.mac_address) return;
    try {
      await api.wakeOnLan(host.mac_address, wolBroadcastForHost(host.hostname));
      setStatusMessage(`Wake packet sent to ${host.name}`);
    } catch (e) {
      setStatusMessage(`Wake failed: ${String(e)}`);
    }
  };

  const connectionErrorHost = useMemo(
    () =>
      connectionError ? (hosts.find((h) => h.id === connectionError.hostId) ?? null) : null,
    [connectionError, hosts],
  );
  const canWakeFailedHost =
    Boolean(connectionErrorHost?.mac_address) &&
    looksLikeUnreachableError(connectionError?.message ?? "");

  const applyImportedSettings = (settings?: Record<string, unknown>) => {
    if (!settings) return;
    if (typeof settings.theme === "string") {
      changeTheme(settings.theme as AppSettingsExport["theme"]);
    }
    if (settings.connectScreen === "fancy" || settings.connectScreen === "instant") {
      changeConnectScreen(settings.connectScreen);
    }
    if (settings.terminalSettings && typeof settings.terminalSettings === "object") {
      updateTerminalSettings(settings.terminalSettings as Partial<typeof terminalSettings>);
    }
    if (typeof settings.autoSync === "boolean") {
      setStoredAutoSync(settings.autoSync);
    }
  };

  const refreshSyncData = useCallback(async () => {
    await Promise.all([refreshHosts(), refreshGroups(), refreshKeys(), refreshSyncStatus()]);
  }, [refreshGroups, refreshHosts, refreshKeys, refreshSyncStatus]);

  const applySyncOutcome = useCallback(
    async (outcome: api.SyncOutcome) => {
      if (outcome.status === "pulled") {
        await refreshSyncData();
        applyImportedSettings(outcome.settings as Record<string, unknown> | undefined);
        setStatusMessage(`Cloud vault downloaded (v${outcome.version}).`);
        return;
      }
      if (outcome.status === "pushed") {
        setStatusMessage(`Local changes uploaded (v${outcome.version}).`);
        return;
      }
      if (outcome.status === "in_sync") {
        setStatusMessage(`Already in sync (v${outcome.version}).`);
      }
    },
    [refreshSyncData],
  );

  const showSyncPreviewIfNeeded = useCallback(
    async (next: api.SyncPreview) => {
      if (next.status === "in_sync") {
        setStatusMessage(`Already in sync (v${next.version}).`);
        return;
      }
      if (
        next.status === "push" ||
        next.status === "pull" ||
        next.status === "conflict"
      ) {
        setAutoSyncPreview(next);
      }
    },
    [],
  );

  useEffect(() => {
    if (autoSyncCheckedRef.current) return;
    autoSyncCheckedRef.current = true;

    void (async () => {
      if (!getStoredAutoSync()) return;
      try {
        const status = await api.syncStatus();
        setSyncStatus(status);
        if (!status.configured || !status.logged_in || status.vault_exists === false) return;

        if (status.unlocked) {
          await showSyncPreviewIfNeeded(await api.syncPreview(collectAppSettings()));
          return;
        }

        setAutoSyncPrompt({ email: status.email ?? null });
      } catch {
        // User can sync manually in Settings.
      }
    })();
  }, [setSyncStatus, showSyncPreviewIfNeeded]);

  const handleAutoSyncUnlock = async (passphrase: string) => {
    setAutoSyncBusy(true);
    setAutoSyncError(null);
    try {
      await api.syncUnlock({ passphrase });
      setAutoSyncPrompt(null);
      await showSyncPreviewIfNeeded(await api.syncPreview(collectAppSettings()));
    } catch (err) {
      setAutoSyncError(String(err));
    } finally {
      setAutoSyncBusy(false);
    }
  };

  const handleAutoSyncApply = async (resolution?: "keep_local" | "keep_cloud") => {
    setAutoSyncBusy(true);
    setAutoSyncError(null);
    try {
      const outcome = await api.syncNow(collectAppSettings(), resolution);
      setAutoSyncPreview(null);
      await applySyncOutcome(outcome);
    } catch (err) {
      setAutoSyncError(String(err));
    } finally {
      setAutoSyncBusy(false);
    }
  };

  const finishImport = async (result: ImportBackupResult | ImportResult) => {
    await Promise.all([refreshHosts(), refreshGroups(), refreshKeys()]);
    if ("settings" in result) {
      applyImportedSettings(result.settings as Record<string, unknown> | undefined);
    }
    setStatusMessage(
      `Imported ${result.hosts_imported} hosts, ${result.keys_imported} keys, ${result.groups_imported} groups`,
    );
  };

  const runImport = async (replace: boolean) => {
    setBackupBusy(true);
    try {
      const result = await importBackupFromFile(replace);
      if (!result) return;
      await finishImport(result);
    } catch (err) {
      setStatusMessage(String(err));
    } finally {
      setBackupBusy(false);
    }
  };

  const handleExportBackup = async () => {
    setBackupBusy(true);
    try {
      const path = await exportBackupToFile(collectAppSettings());
      if (path) setStatusMessage("Backup saved");
    } catch (err) {
      setStatusMessage(String(err));
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = () => {
    void runImport(false);
  };

  const handleImportBackupReplace = () => {
    setPendingConfirm({
      title: "Replace all data?",
      message: "This removes every host, key, and group before importing the backup.",
      confirmLabel: "Replace all",
      danger: true,
      onConfirm: () => void runImport(true),
    });
  };

  const showHostDrawer = drawerOpen && (navPage === "hosts" || navPage === "home");

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filesPanelOpen = Boolean(activeTabId && filesPanelTabs.has(activeTabId));

  const setFilesPanelOpenForActive = (open: boolean) => {
    if (!activeTabId) return;
    setFilesPanelTabs((prev) => {
      const has = prev.has(activeTabId);
      if (open === has) return prev;
      const next = new Set(prev);
      if (open) next.add(activeTabId);
      else next.delete(activeTabId);
      return next;
    });
  };

  const toggleFilesPanelForActive = () => {
    if (!activeTabId) return;
    setFilesPanelTabs((prev) => {
      const next = new Set(prev);
      if (next.has(activeTabId)) next.delete(activeTabId);
      else next.add(activeTabId);
      return next;
    });
  };

  const displayTabs = useMemo(() => {
    const hostCounts = new Map<string, number>();
    return tabs
      .map((tab) => {
        const count = (hostCounts.get(tab.hostId) ?? 0) + 1;
        hostCounts.set(tab.hostId, count);
        return {
          ...tab,
          title: count > 1 ? `${tab.title} (${count})` : tab.title,
        };
      })
      .filter((tab) => !tab.poppedOut);
  }, [tabs]);
  const useFancyConnect = connectScreen === "fancy";
  const activeNeedsConnectOverlay = Boolean(
    activeTab &&
      useFancyConnect &&
      viewingTerminal &&
      !api.isLocalSession(activeTab.id) &&
      (activeTab.status === "connecting" || activeTab.status === "error") &&
      !activeTab.hadConnected,
  );

  const [connectOverlayTabId, setConnectOverlayTabId] = useState<string | null>(null);

  useEffect(() => {
    if (activeNeedsConnectOverlay && activeTab) {
      setConnectOverlayTabId(activeTab.id);
    }
  }, [activeNeedsConnectOverlay, activeTab?.id]);

  useEffect(() => {
    if (!useFancyConnect) setConnectOverlayTabId(null);
  }, [useFancyConnect]);

  const overlayTab =
    connectOverlayTabId != null
      ? tabs.find((t) => t.id === connectOverlayTabId) ?? null
      : null;

  const showConnectionScreen =
    viewingTerminal &&
    useFancyConnect &&
    overlayTab != null &&
    !api.isLocalSession(overlayTab.id) &&
    (activeTabId === overlayTab.id || activeNeedsConnectOverlay);

  const connectOverlayStatus: "connecting" | "connected" | "error" =
    overlayTab?.status === "error"
      ? "error"
      : overlayTab?.status === "connected" || overlayTab?.hadConnected
        ? "connected"
        : "connecting";

  const clearConnectOverlay = useCallback(() => {
    setConnectOverlayTabId(null);
  }, []);

  const renderNavPage = () => {
    switch (navPage) {
      case "home":
        return (
          <HomePage
            hosts={hosts}
            keys={keys}
            openSessions={tabs.filter((t) => !t.poppedOut).length}
            connectingHostId={connectingHostId}
            onConnect={(host) => void connectToHost(host)}
            onAddServer={() => openAddDrawer()}
            onOpenLocalTerminal={() => void openLocalTerminal()}
            onOpenHosts={() => handleNavigate("hosts")}
            onOpenKeys={() => handleNavigate("keys")}
            onOpenSettings={() => handleNavigate("settings")}
            isMobile={isMobile}
          />
        );
      case "hosts":
        return (
          <HostsPage
            hosts={hosts}
            groups={groups}
            connectingHostId={connectingHostId}
            onConnect={(host) => void connectToHost(host)}
            onWakeHost={(host) => void wakeHost(host)}
            onAddServer={(groupId) => openAddDrawer(groupId)}
            onAddGroup={handleAddGroup}
            onEditHost={openEditDrawer}
            onDeleteHost={handleDeleteHost}
            onRenameGroup={handleRenameGroup}
            onDeleteGroup={handleDeleteGroup}
            onMoveHost={(hostId, groupId) => void handleMoveHost(hostId, groupId)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onQuickConnect={handleQuickConnect}
            onOpenLocalTerminal={() => void openLocalTerminal()}
            isMobile={isMobile}
          />
        );
      case "keys":
        return (
          <KeysPage
            keys={keys}
            hosts={hosts}
            onGenerate={async (input) => {
              await generateKey(input);
            }}
            onImport={async (name, pem, passphrase) => {
              await importKey({ name, private_key_pem: pem, passphrase: passphrase ?? null });
            }}
            onDelete={removeKey}
          />
        );
      case "settings":
        return (
          <SettingsPage
            theme={theme}
            onThemeChange={changeTheme}
            connectScreen={connectScreen}
            onConnectScreenChange={changeConnectScreen}
            terminalSettings={terminalSettings}
            onTerminalSettingsChange={updateTerminalSettings}
            backupBusy={backupBusy}
            onExportBackup={() => void handleExportBackup()}
            onImportBackup={handleImportBackup}
            onImportBackupReplace={handleImportBackupReplace}
            syncGetSettings={collectAppSettings}
            syncStatus={syncStatus}
            onSyncStatusChange={setSyncStatus}
            onSyncVaultApplied={(settings) => {
              void refreshSyncData();
              applyImportedSettings((settings ?? undefined) as Record<string, unknown> | undefined);
            }}
            onSyncDataRefresh={refreshSyncData}
            focusSync={focusSettingsSync}
            onFocusSyncHandled={() => setFocusSettingsSync(false)}
          />
        );
      default:
        return null;
    }
  };

  const renderMain = () => (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {hasTabs && (
        <div
          className={
            viewingTerminal
              ? "relative flex min-h-0 flex-1"
              : "pointer-events-none invisible absolute inset-0 overflow-hidden"
          }
          style={{ background: "var(--terminal-bg)" }}
          aria-hidden={!viewingTerminal}
        >
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {tabs.map((tab) => {
              if (tab.poppedOut) return null;
              const isActive = tab.id === activeTabId;
              const isSplitPartner =
                !isMobile && !isActive && activeTab?.splitWithId === tab.id;
              const isLocalConnecting =
                api.isLocalSession(tab.id) && tab.status === "connecting";
              const midSessionReconnect =
                tab.hadConnected &&
                (tab.status === "reconnecting" ||
                  tab.status === "disconnected" ||
                  tab.status === "connecting" ||
                  tab.status === "error");
              const keepTerminal =
                tab.status === "connecting" ||
                tab.status === "connected" ||
                tab.status === "error" ||
                tab.status === "reconnecting" ||
                tab.status === "disconnected" ||
                tab.hadConnected ||
                isLocalConnecting;
              const statusAllowsView =
                tab.status === "connected" ||
                tab.status === "reconnecting" ||
                tab.status === "disconnected" ||
                midSessionReconnect ||
                isLocalConnecting ||
                (connectScreen === "instant" && tab.status === "connecting");
              const terminalVisible =
                viewingTerminal && (isActive || isSplitPartner) && statusAllowsView;

              if (!keepTerminal) return null;

              return (
                <div
                  key={tab.id}
                  className={
                    terminalVisible ? "relative h-full min-w-0 flex-1" : "hidden"
                  }
                  style={
                    terminalVisible && isSplitPartner
                      ? { borderLeft: "1px solid var(--border-subtle)" }
                      : undefined
                  }
                  aria-hidden={!terminalVisible}
                  onMouseDownCapture={() => {
                    // In split view the tab highlight follows whichever pane
                    // the user clicks into.
                    if (!isActive) setActiveTabId(tab.id);
                  }}
                >
                  <TerminalView
                    sessionId={tab.id}
                    settings={terminalSettings}
                    bootstrapLocal={isLocalConnecting}
                    active={
                      viewingTerminal &&
                      (isActive || isSplitPartner) &&
                      (tab.status === "connected" ||
                        midSessionReconnect ||
                        isLocalConnecting)
                    }
                    onResize={handleTerminalResize}
                    onStatusChange={(status, error) => {
                      setTabs((prev) =>
                        prev.map((item) =>
                          item.id === tab.id
                            ? {
                                ...item,
                                status: status as TabSession["status"],
                                error,
                                hadConnected: status === "connected" ? true : item.hadConnected,
                              }
                            : item,
                        ),
                      );
                    }}
                  />
                  {midSessionReconnect && (
                    <ReconnectOverlay
                      hostName={tab.title}
                      info={
                        reconnectUi[tab.id] ?? {
                          attempt: reconnectAttemptsRef.current.get(tab.id) ?? 1,
                          nextRetryAt: Date.now(),
                          phase:
                            tab.status === "connecting" || tab.status === "reconnecting"
                              ? "reconnecting"
                              : "disconnected",
                          lastError: tab.error,
                        }
                      }
                      onCloseSession={() => void closeTab(tab.id)}
                      onRetryNow={() => retryReconnectNow(tab.id)}
                    />
                  )}
                </div>
              );
            })}

            {showConnectionScreen && overlayTab && (
              <ConnectionScreen
                key={overlayTab.id}
                hostName={overlayTab.title}
                username={overlayTab.username}
                hostname={overlayTab.hostname}
                port={overlayTab.port}
                status={connectOverlayStatus}
                error={overlayTab.error}
                logs={overlayTab.logs}
                markSeed={overlayTab.hostId || overlayTab.id}
                osId={hosts.find((h) => h.id === overlayTab.hostId)?.os_id}
                onExitComplete={clearConnectOverlay}
              />
            )}

            {viewingTerminal && snippetsOpen && activeTab && (
              <SnippetsPopover
                onRun={(command) => sendCommandToTerminal(activeTab.id, command)}
                onClose={() => setSnippetsOpen(false)}
              />
            )}

            {viewingTerminal && forwardsOpen && activeTab && (
              <ForwardsPopover
                hostId={activeTab.hostId}
                sessionId={activeTab.id}
                onClose={() => setForwardsOpen(false)}
                onStatus={setStatusMessage}
              />
            )}
          </div>

          {viewingTerminal && filesPanelOpen && activeTab && (
            <FileBrowserPanel
              key={activeTab.id}
              sessionId={activeTab.id}
              onClose={() => setFilesPanelOpenForActive(false)}
              onCdTerminal={(path) =>
                sendCommandToTerminal(activeTab.id, `cd '${path.replace(/'/g, "'\\''")}'`)
              }
            />
          )}
        </div>
      )}

      {!viewingTerminal && (
        <div className="flex min-h-0 flex-1 flex-col">{renderNavPage()}</div>
      )}
    </div>
  );

  return (
    <>
      <AppShell
        activePage={navPage}
        onNavigate={handleNavigate}
        onSignInForSync={handleSignInForSync}
        statusMessage={isMobile ? undefined : statusMessage}
        syncStatus={syncStatus}
        showTabs={hasTabs && (viewingTerminal || !isMobile)}
        isMobile={isMobile}
        immersive={isMobile && viewingTerminal}
        tabBar={
          <TabBar
            tabs={displayTabs}
            activeTabId={viewingTerminal ? activeTabId : null}
            onSelectTab={handleSelectTab}
            onCloseTab={requestCloseTab}
            isMobile={isMobile}
            onBack={
              isMobile
                ? () => {
                    setViewingTerminal(false);
                    setFilesPanelOpenForActive(false);
                    setNavPage("hosts");
                  }
                : undefined
            }
            actions={[
              ...(!isMobile
                ? [
                    {
                      icon: SquareTerminal,
                      title: "New local terminal",
                      active: false,
                      onClick: () => void openLocalTerminal(),
                    },
                  ]
                : []),
              ...(viewingTerminal && activeTab
                ? [
                    ...(!api.isLocalSession(activeTab.id)
                      ? [
                          {
                            icon: FolderTree,
                            title: "File browser",
                            active: filesPanelOpen,
                            onClick: () => toggleFilesPanelForActive(),
                          },
                          ...(!isMobile
                            ? [
                                {
                                  icon: ArrowLeftRight,
                                  title: "Port forwarding",
                                  active: forwardsOpen,
                                  onClick: () => {
                                    setSnippetsOpen(false);
                                    setForwardsOpen((v) => !v);
                                  },
                                },
                              ]
                            : []),
                        ]
                      : []),
                    ...(!isMobile
                      ? [
                          {
                            icon: Zap,
                            title: "Snippets",
                            active: snippetsOpen,
                            onClick: () => {
                              setForwardsOpen(false);
                              setSnippetsOpen((v) => !v);
                            },
                          },
                          {
                            icon: Columns2,
                            title: activeTab.splitWithId ? "Unsplit" : "Split view",
                            active: Boolean(activeTab.splitWithId),
                            onClick: () => splitActiveTab(),
                          },
                          {
                            icon: ExternalLink,
                            title: "Pop out terminal",
                            active: false,
                            onClick: () => popOutActiveTab(),
                          },
                        ]
                      : []),
                  ]
                : []),
            ].map(({ icon: Icon, title, active, onClick }) => (
              <button
                key={title}
                type="button"
                onClick={onClick}
                className="hover-subtle transition-ui rounded-lg p-2"
                style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}
                title={title}
                {...(title === "Port forwarding" || title === "Snippets"
                  ? { "data-azalea-popover-trigger": "" }
                  : {})}
              >
                <Icon size={15} />
              </button>
            ))}
          />
        }
        sidePanel={
          <AddServerDrawer
            open={showHostDrawer}
            host={editingHost}
            keys={keys}
            groups={groups}
            initialValues={drawerInitial}
            defaultGroupId={defaultGroupId}
            onClose={closeDrawer}
            onSubmit={handleHostSubmit}
            onDelete={
              editingHost ? () => requestDeleteHost(editingHost) : undefined
            }
          />
        }
      >
        {renderMain()}
      </AppShell>

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        message={pendingConfirm?.message ?? ""}
        confirmLabel={pendingConfirm?.confirmLabel}
        danger={pendingConfirm?.danger}
        onConfirm={() => pendingConfirm?.onConfirm()}
        onCancel={() => setPendingConfirm(null)}
      />

      <PromptDialog
        open={pendingPrompt !== null}
        title={pendingPrompt?.title ?? ""}
        message={pendingPrompt?.message}
        defaultValue={pendingPrompt?.defaultValue}
        placeholder={pendingPrompt?.placeholder}
        confirmLabel={pendingPrompt?.confirmLabel}
        onConfirm={(value) => pendingPrompt?.onConfirm(value)}
        onCancel={() => setPendingPrompt(null)}
      />

      {autoSyncPrompt && (
        <AutoSyncPrompt
          email={autoSyncPrompt.email}
          busy={autoSyncBusy}
          error={autoSyncError}
          onUnlock={(passphrase) => void handleAutoSyncUnlock(passphrase)}
          onDisableAutoSync={() => {
            setStoredAutoSync(false);
            setAutoSyncPrompt(null);
            setAutoSyncError(null);
          }}
          onSkip={() => {
            setAutoSyncPrompt(null);
            setAutoSyncError(null);
          }}
        />
      )}

      {autoSyncPreview && (
        <SyncResolutionDialog
          preview={autoSyncPreview}
          busy={autoSyncBusy}
          onApply={(resolution) => void handleAutoSyncApply(resolution)}
          onSkip={() => {
            setAutoSyncPreview(null);
            setAutoSyncError(null);
          }}
        />
      )}

      <SelectHostDialog
        open={splitPickerOpen}
        title="Split terminal"
        message="Choose the host for the second pane."
        hosts={hosts}
        onSelect={(host) => {
          setSplitPickerOpen(false);
          void openSplitSession(host);
        }}
        onCancel={() => setSplitPickerOpen(false)}
      />

      <SelectKeyDialog
        open={keyPickerHost !== null}
        hostName={keyPickerHost?.name ?? ""}
        keys={keys}
        onSelect={(keyId) => {
          keyPickerResolver.current?.(keyId);
          keyPickerResolver.current = null;
          setKeyPickerHost(null);
        }}
        onCancel={() => {
          keyPickerResolver.current?.(null);
          keyPickerResolver.current = null;
          setKeyPickerHost(null);
        }}
      />

      <ConnectionErrorDialog
        open={
          connectionError !== null &&
          viewingTerminal &&
          activeTabId === connectionError.sessionId &&
          !tabs.find((t) => t.id === connectionError.sessionId)?.hadConnected
        }
        title="Connection failed"
        hostName={connectionError?.hostName ?? ""}
        message={connectionError?.message ?? ""}
        logs={connectionError?.logs ?? []}
        onClose={dismissConnectionError}
        onRetry={connectionError?.hostId ? retryConnection : undefined}
        canWake={canWakeFailedHost}
        wakeBusy={wakeBusy}
        onWake={() => void wakeAndRetry()}
      />

      <ConfirmDialog
        open={keyMismatch !== null}
        title="Server key changed"
        message={
          keyMismatch
            ? `The host key for ${keyMismatch.hostname}:${keyMismatch.port} has changed.\n\n` +
              `Old: ${keyMismatch.old_fingerprint}\nNew: ${keyMismatch.new_fingerprint}\n\n` +
              `This can mean the server was reinstalled — or that someone is intercepting the connection. ` +
              `Replace the saved key and connect?`
            : ""
        }
        confirmLabel="Replace & connect"
        danger
        onConfirm={() => {
          const mismatch = keyMismatch;
          setKeyMismatch(null);
          if (!mismatch) return;
          void api
            .trustHostKey(mismatch.session_id)
            .then(() => {
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === mismatch.session_id
                    ? { ...t, status: "connecting" as const, error: undefined }
                    : t,
                ),
              );
              return api.reconnectSsh(mismatch.session_id, DEFAULT_COLS, DEFAULT_ROWS);
            })
            .catch((err) => setStatusMessage(String(err)));
        }}
        onCancel={() => setKeyMismatch(null)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        hosts={hosts}
        keys={keys}
        isMobile={isMobile}
        signedIn={Boolean(syncStatus?.logged_in)}
        onAction={handleCommandPaletteAction}
      />

      <ConfirmDialog
        open={unknownHostKey !== null}
        title="Unknown server key"
        message={
          unknownHostKey
            ? `${unknownHostKey.hostname}:${unknownHostKey.port} has not been seen before.\n\n` +
              `${unknownHostKey.key_type} fingerprint:\n${unknownHostKey.fingerprint}\n\n` +
              `Only continue if this fingerprint matches the server. Azalea will remember it for future connections.`
            : ""
        }
        confirmLabel="Trust & connect"
        onConfirm={() => {
          const pending = unknownHostKey;
          setUnknownHostKey(null);
          if (!pending) return;
          void api
            .respondHostKey(pending.session_id, true)
            .catch((err) => setStatusMessage(String(err)));
        }}
        onCancel={() => {
          const pending = unknownHostKey;
          setUnknownHostKey(null);
          if (!pending) return;
          void api.respondHostKey(pending.session_id, false).catch(() => undefined);
        }}
      />
    </>
  );
}

export default App;
