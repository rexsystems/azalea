import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Host,
  HostGroup,
  HostKeyMismatchEvent,
  ImportBackupResult,
  ImportResult,
} from "@azalea/shared";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ArrowLeftRight, Columns2, ExternalLink, FolderTree, SquareTerminal, Zap } from "lucide-react";
import * as api from "./lib/api";
import type { HostFormValues } from "./lib/utils";
import { parseQuickConnect } from "./lib/utils";
import { useGroups } from "./hooks/useGroups";
import { useHosts } from "./hooks/useHosts";
import { useKeys } from "./hooks/useKeys";
import { useConnectScreen } from "./hooks/useConnectScreen";
import { useTerminalSettings } from "./hooks/useTerminalSettings";
import { useTheme } from "./hooks/useTheme";
import { AddServerDrawer } from "./components/AddServerDrawer";
import { AutoSyncPrompt } from "./components/AutoSyncPrompt";
import { AppShell, type NavPage } from "./components/AppShell";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { FileBrowserPanel } from "./components/FileBrowserPanel";
import { ForwardsPopover } from "./components/ForwardsPopover";
import { GroupsPage, HostsPage } from "./components/HostsPage";
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
  const { terminalSettings, updateTerminalSettings } = useTerminalSettings();

  const [tabs, setTabs] = useState<TabSession[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Ready");

  const [navPage, setNavPage] = useState<NavPage>("hosts");
  const [viewingTerminal, setViewingTerminal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [drawerInitial, setDrawerInitial] = useState<Partial<HostFormValues>>();
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmState | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PromptState | null>(null);
  const [connectionError, setConnectionError] = useState<ConnectionErrorState | null>(null);
  const [keyPickerHost, setKeyPickerHost] = useState<Host | null>(null);
  const keyPickerResolver = useRef<((keyId: string | null) => void) | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const closingTabsRef = useRef(new Set<string>());
  const reconnectTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [forwardsOpen, setForwardsOpen] = useState(false);
  const [keyMismatch, setKeyMismatch] = useState<HostKeyMismatchEvent | null>(null);
  const [splitPickerOpen, setSplitPickerOpen] = useState(false);
  const [autoSyncPrompt, setAutoSyncPrompt] = useState<{ email: string | null } | null>(null);
  const [autoSyncBusy, setAutoSyncBusy] = useState(false);
  const [autoSyncError, setAutoSyncError] = useState<string | null>(null);
  const autoSyncCheckedRef = useRef(false);

  const hasTabs = tabs.some((t) => !t.poppedOut);

  useEffect(() => {
    void checkForUpdateSilent().then((result) => {
      if (result) {
        setStatusMessage(
          `Update available: Azalea ${result.version} — open Settings → Updates to install`,
        );
      }
    });
  }, []);

  const DEFAULT_COLS = 120;
  const DEFAULT_ROWS = 30;

  const hostNeedsKey = useCallback(async (host: Host) => {
    if (host.auth_type === "none") return true;
    if (host.auth_type === "key" && !host.key_id) return true;
    if (host.auth_type === "password") {
      return !(await api.hostHasPassword(host.id));
    }
    return false;
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
        title: "PowerShell",
        hostname: "localhost",
        port: 0,
        username: "",
        status: "connecting",
        logs: [],
        hadConnected: false,
      },
    ]);
    setActiveTabId(sessionId);
    setViewingTerminal(true);
    setStatusMessage("Opening local terminal...");
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
      transparent: true,
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

  const clearReconnectTimer = useCallback((sessionId: string) => {
    const timer = reconnectTimersRef.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      reconnectTimersRef.current.delete(sessionId);
    }
  }, []);

  const scheduleReconnect = useCallback((sessionId: string) => {
    if (closingTabsRef.current.has(sessionId)) return;
    if (reconnectTimersRef.current.has(sessionId)) return;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === sessionId ? { ...tab, status: "reconnecting" as const, error: undefined } : tab,
      ),
    );
    setStatusMessage("Connection lost — reconnecting...");

    const timer = setTimeout(() => {
      reconnectTimersRef.current.delete(sessionId);
      void api.reconnectSsh(sessionId, DEFAULT_COLS, DEFAULT_ROWS).catch(() => {
        scheduleReconnect(sessionId);
      });
    }, 2000);

    reconnectTimersRef.current.set(sessionId, timer);
  }, []);

  const closeTab = useCallback(
    async (tabId: string) => {
      closingTabsRef.current.add(tabId);
      clearReconnectTimer(tabId);
      if (api.isLocalSession(tabId)) {
        await api.closeLocalTerminal(tabId).catch(() => undefined);
      } else {
        await api.disconnectSsh(tabId).catch(() => undefined);
      }
      removeTab(tabId);
      closingTabsRef.current.delete(tabId);
    },
    [clearReconnectTimer, removeTab],
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
            clearReconnectTimer(session_id);
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
            } else if (tab?.hadConnected) {
              scheduleReconnect(session_id);
            }
            return prev.map((t) =>
              t.id === session_id
                ? { ...t, status: tab?.hadConnected ? ("reconnecting" as const) : ("error" as const), error: msg, logs }
                : t,
            );
          });
          setStatusMessage(msg);
          return;
        }

        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === session_id
              ? {
                  ...tab,
                  status: status as TabSession["status"],
                  error,
                  hadConnected: status === "connected" ? true : tab.hadConnected,
                }
              : tab,
          ),
        );
        if (status === "connected") setStatusMessage("Connected");
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

    return () => {
      void unlistenStatus.then((unlisten) => unlisten());
      void unlistenLog.then((unlisten) => unlisten());
      void unlistenMismatch.then((unlisten) => unlisten());
    };
  }, [scheduleReconnect, clearReconnectTimer, removeTab]);

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
      key_id: values.auth_type === "key" ? values.key_id : null,
      group_id: values.group_id,
      password:
        values.auth_type === "password" && values.password ? values.password : undefined,
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

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setViewingTerminal(true);
    setConnectionError(null);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

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

  const dismissConnectionError = () => {
    const err = connectionError;
    setConnectionError(null);
    if (err?.sessionId) {
      void closeTab(err.sessionId);
    }
  };

  const retryConnection = () => {
    const err = connectionError;
    if (!err) return;
    const host = hosts.find((h) => h.id === err.hostId);
    setConnectionError(null);
    if (err.sessionId) {
      void closeTab(err.sessionId).then(() => {
        if (host) void connectToHost(host);
      });
    } else if (host) {
      void connectToHost(host);
    }
  };

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

  useEffect(() => {
    if (autoSyncCheckedRef.current) return;
    autoSyncCheckedRef.current = true;

    void (async () => {
      if (!getStoredAutoSync()) return;
      try {
        const status = await api.syncStatus();
        if (!status.configured || !status.logged_in || status.vault_exists === false) return;

        if (status.unlocked) {
          const outcome = await api.syncNow(collectAppSettings());
          if (outcome.status === "pulled") {
            await Promise.all([refreshHosts(), refreshGroups(), refreshKeys()]);
            applyImportedSettings(outcome.settings as Record<string, unknown> | undefined);
            setStatusMessage(`Auto-sync pulled cloud vault (v${outcome.version}).`);
          }
          return;
        }

        setAutoSyncPrompt({ email: status.email ?? null });
      } catch {
        // User can sync manually in Settings.
      }
    })();
  }, [refreshGroups, refreshHosts, refreshKeys]);

  const handleAutoSyncUnlock = async (passphrase: string) => {
    setAutoSyncBusy(true);
    setAutoSyncError(null);
    try {
      const result = await api.syncUnlock({ passphrase });
      applyImportedSettings(result.settings as Record<string, unknown> | undefined);
      await Promise.all([refreshHosts(), refreshGroups(), refreshKeys()]);
      setAutoSyncPrompt(null);
      setStatusMessage(`Vault unlocked and synced (v${result.version}).`);
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

  const showHostDrawer = drawerOpen && navPage === "hosts";

  const activeTab = tabs.find((t) => t.id === activeTabId);

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
  const showConnectionScreen =
    viewingTerminal &&
    activeTab &&
    useFancyConnect &&
    (activeTab.status === "connecting" || activeTab.status === "error") &&
    !activeTab.hadConnected;

  const renderNavPage = () => {
    switch (navPage) {
      case "hosts":
        return (
          <HostsPage
            hosts={hosts}
            groups={groups}
            connectingHostId={connectingHostId}
            onConnect={(host) => void connectToHost(host)}
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
          />
        );
      case "groups":
        return (
          <GroupsPage
            groups={groups}
            hosts={hosts}
            onAddGroup={handleAddGroup}
            onAddServer={(groupId) => {
              setNavPage("hosts");
              openAddDrawer(groupId);
            }}
            onRenameGroup={handleRenameGroup}
            onDeleteGroup={handleDeleteGroup}
          />
        );
      case "keys":
        return (
          <KeysPage
            keys={keys}
            onGenerate={async (name) => {
              await generateKey({ name });
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
            onSyncVaultApplied={(settings) => {
              void Promise.all([refreshHosts(), refreshGroups(), refreshKeys()]);
              applyImportedSettings((settings ?? undefined) as Record<string, unknown> | undefined);
            }}
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
                !isActive && activeTab?.splitWithId === tab.id;
              const isLocalConnecting =
                api.isLocalSession(tab.id) && tab.status === "connecting";
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
                isLocalConnecting ||
                (connectScreen === "instant" && tab.status === "connecting");
              const terminalVisible =
                viewingTerminal && (isActive || isSplitPartner) && statusAllowsView;

              if (!keepTerminal) return null;

              return (
                <div
                  key={tab.id}
                  className={terminalVisible ? "h-full min-w-0 flex-1" : "hidden"}
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
                        tab.status === "reconnecting" ||
                        tab.status === "disconnected" ||
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
                </div>
              );
            })}

            {showConnectionScreen && activeTab && (
              <ConnectionScreen
                hostName={activeTab.title}
                username={activeTab.username}
                hostname={activeTab.hostname}
                port={activeTab.port}
                status={activeTab.status === "error" ? "error" : "connecting"}
                error={activeTab.error}
                logs={activeTab.logs}
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
              onClose={() => setFilesPanelOpen(false)}
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
        statusMessage={statusMessage}
        showTabs={hasTabs}
        tabBar={
          <TabBar
            tabs={displayTabs}
            activeTabId={viewingTerminal ? activeTabId : null}
            onSelectTab={handleSelectTab}
            onCloseTab={requestCloseTab}
            actions={[
              {
                icon: SquareTerminal,
                title: "New local terminal",
                active: false,
                onClick: () => void openLocalTerminal(),
              },
              ...(viewingTerminal && activeTab
                ? [
                    ...(!api.isLocalSession(activeTab.id)
                      ? [
                          {
                            icon: FolderTree,
                            title: "File browser",
                            active: filesPanelOpen,
                            onClick: () => setFilesPanelOpen((v) => !v),
                          },
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
            ].map(({ icon: Icon, title, active, onClick }) => (
              <button
                key={title}
                onClick={onClick}
                className="hover-subtle transition-ui rounded-lg p-2"
                style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}
                title={title}
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
        open={connectionError !== null}
        title="Connection failed"
        hostName={connectionError?.hostName ?? ""}
        message={connectionError?.message ?? ""}
        logs={connectionError?.logs ?? []}
        onClose={dismissConnectionError}
        onRetry={connectionError?.hostId ? retryConnection : undefined}
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
            .trustHostKey({
              hostname: mismatch.hostname,
              port: mismatch.port,
              key_type: mismatch.key_type,
              public_key: mismatch.public_key,
              fingerprint: mismatch.new_fingerprint,
            })
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
    </>
  );
}

export default App;
