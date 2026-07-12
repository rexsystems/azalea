import { useCallback, useEffect, useState } from "react";
import type { Host, HostGroup } from "@azalea/shared";
import { listen } from "@tauri-apps/api/event";
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
import { AppShell, type NavPage } from "./components/AppShell";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { GroupsPage, HostsPage } from "./components/HostsPage";
import { KeysPage } from "./components/KeysPage";
import { SettingsPage } from "./components/SettingsPage";
import { TabBar } from "./components/TabBar";
import { TerminalView } from "./components/Terminal";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { ConnectionErrorDialog } from "./components/ui/ConnectionErrorDialog";
import { PromptDialog } from "./components/ui/PromptDialog";

interface TabSession {
  id: string;
  hostId: string;
  title: string;
  hostname: string;
  port: number;
  username: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  error?: string;
  logs: string[];
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
  const { keys, generateKey, importKey, removeKey } = useKeys();
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

  const hasTabs = tabs.length > 0;

  const DEFAULT_COLS = 120;
  const DEFAULT_ROWS = 30;

  const connectToHost = useCallback(async (host: Host) => {
    setConnectingHostId(host.id);
    setConnectionError(null);
    setStatusMessage(`Connecting to ${host.name}...`);

    let sessionId = "";
    try {
      sessionId = await api.prepareSsh(host.id);
      setTabs((prev) => [
        ...prev,
        {
          id: sessionId,
          hostId: host.id,
          title: host.name,
          hostname: host.hostname,
          port: host.port,
          username: host.username,
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
        hostId: host.id,
        hostName: host.name,
        message: msg,
        logs,
      });
    } finally {
      setConnectingHostId(null);
    }
  }, []);

  const handleTerminalResize = useCallback((sessionId: string, cols: number, rows: number) => {
    void api.resizeTerminal(sessionId, cols, rows);
  }, []);

  const removeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.id !== tabId);
      setActiveTabId((current) => {
        if (current !== tabId) return current;
        return next[next.length - 1]?.id ?? null;
      });
      if (next.length === 0) setViewingTerminal(false);
      return next;
    });
  }, []);

  const closeTab = useCallback(async (tabId: string) => {
    await api.disconnectSsh(tabId).catch(() => undefined);
    removeTab(tabId);
  }, [removeTab]);


  useEffect(() => {
    const unlistenStatus = listen<{ session_id: string; status: string; error?: string }>(
      "terminal-status",
      (event) => {
        const { session_id, status, error } = event.payload;

        if (status === "disconnected") {
          setStatusMessage("Session ended");
          removeTab(session_id);
          return;
        }

        if (status === "error") {
          const msg = error ?? "Connection failed";
          setTabs((prev) => {
            const tab = prev.find((t) => t.id === session_id);
            const logs = tab ? [...tab.logs, `Error: ${msg}`] : [`Error: ${msg}`];
            if (tab) {
              setConnectionError({
                sessionId: session_id,
                hostId: tab.hostId,
                hostName: tab.title,
                message: msg,
                logs,
              });
            }
            return prev.map((t) =>
              t.id === session_id
                ? { ...t, status: "error" as const, error: msg, logs }
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

    return () => {
      void unlistenStatus.then((unlisten) => unlisten());
      void unlistenLog.then((unlisten) => unlisten());
    };
  }, [removeTab]);

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
    setPendingConfirm({
      title: "Close connection?",
      message: `Disconnect from "${tab.title}"?`,
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
    if (editingHost) {
      const updated = await updateHost(editingHost.id, {
        name: values.name,
        hostname: values.hostname,
        port: values.port,
        username: values.username,
        auth_type: values.auth_type,
        key_id: values.key_id,
        group_id: values.group_id,
        password: values.password || undefined,
      });
      setStatusMessage(`Updated ${values.name}`);
      if (connectAfter) await connectToHost(updated);
      return;
    }

    const created = await createHost({
      name: values.name,
      hostname: values.hostname,
      port: values.port,
      username: values.username,
      auth_type: values.auth_type,
      key_id: values.key_id,
      group_id: values.group_id,
      password: values.password || null,
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

  const showHostDrawer = drawerOpen && navPage === "hosts";

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const useFancyConnect = connectScreen === "fancy";
  const showConnectionScreen =
    viewingTerminal &&
    activeTab &&
    useFancyConnect &&
    (activeTab.status === "connecting" || activeTab.status === "error");

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
            onImport={async (name, pem) => {
              await importKey({ name, private_key_pem: pem });
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
              ? "relative min-h-0 flex-1"
              : "pointer-events-none invisible absolute inset-0 overflow-hidden"
          }
          style={{ background: "var(--terminal-bg)" }}
          aria-hidden={!viewingTerminal}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const shouldMountTerminal =
              isActive && (tab.status === "connecting" || tab.status === "connected");
            const terminalVisible =
              isActive &&
              (tab.status === "connected" ||
                (connectScreen === "instant" && tab.status === "connecting"));

            if (!shouldMountTerminal) return null;

            return (
              <div
                key={tab.id}
                className={terminalVisible ? "h-full w-full" : "hidden"}
              >
                <TerminalView
                  sessionId={tab.id}
                  settings={terminalSettings}
                  active={viewingTerminal && isActive && tab.status === "connected"}
                  onResize={handleTerminalResize}
                  onStatusChange={(status, error) => {
                    setTabs((prev) =>
                      prev.map((item) =>
                        item.id === tab.id
                          ? { ...item, status: status as TabSession["status"], error }
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
            tabs={tabs}
            activeTabId={viewingTerminal ? activeTabId : null}
            onSelectTab={handleSelectTab}
            onCloseTab={requestCloseTab}
            onBrowse={() => {
              setNavPage("hosts");
              setViewingTerminal(false);
            }}
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

      <ConnectionErrorDialog
        open={connectionError !== null}
        title="Connection failed"
        hostName={connectionError?.hostName ?? ""}
        message={connectionError?.message ?? ""}
        logs={connectionError?.logs ?? []}
        onClose={dismissConnectionError}
        onRetry={connectionError?.hostId ? retryConnection : undefined}
      />
    </>
  );
}

export default App;
