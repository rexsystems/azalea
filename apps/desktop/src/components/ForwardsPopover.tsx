import { useCallback, useEffect, useRef, useState } from "react";
import type { PortForward, PortForwardStatus } from "@azalea/shared";
import { listen } from "@tauri-apps/api/event";
import { Plus, Trash2, X } from "./icons";
import * as api from "../lib/api";

interface ForwardsPopoverProps {
  hostId: string;
  sessionId: string;
  onClose: () => void;
  onStatus: (message: string) => void;
}

function statusLabel(status: PortForwardStatus | undefined): {
  text: string;
  color: string;
} {
  if (!status || status.state === "stopped") {
    return { text: "Off", color: "var(--text-muted)" };
  }
  if (status.state === "failed") {
    return { text: "Failed", color: "#f87171" };
  }
  if (status.state === "connected") {
    const n = status.connections;
    return {
      text: n === 1 ? "Connected · 1" : `Connected · ${n}`,
      color: "#86efac",
    };
  }
  return { text: "Listening", color: "var(--accent)" };
}

export function ForwardsPopover({
  hostId,
  sessionId,
  onClose,
  onStatus,
}: ForwardsPopoverProps) {
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [statuses, setStatuses] = useState<Record<string, PortForwardStatus>>({});
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("localhost");
  const [remotePort, setRemotePort] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const applyStatuses = useCallback((list: PortForwardStatus[]) => {
    const next: Record<string, PortForwardStatus> = {};
    for (const item of list) {
      if (item.state !== "stopped") next[item.forward_id] = item;
    }
    setStatuses(next);
  }, []);

  const refresh = useCallback(() => {
    void api.listPortForwards(hostId).then(setForwards).catch(() => setForwards([]));
    void api
      .listActiveForwards(sessionId)
      .then(applyStatuses)
      .catch(() => applyStatuses([]));
  }, [hostId, sessionId, applyStatuses]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.listActiveForwards(sessionId).then(applyStatuses).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [sessionId, applyStatuses]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<PortForwardStatus>("port-forward-status", (event) => {
      const status = event.payload;
      if (status.session_id !== sessionId) return;
      setStatuses((prev) => {
        const next = { ...prev };
        if (status.state === "stopped") {
          delete next[status.forward_id];
        } else {
          next[status.forward_id] = status;
        }
        return next;
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [sessionId]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-azalea-popover-trigger]")) return;
      onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  const submit = async () => {
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (!lp || !rp || !remoteHost.trim()) return;
    await api.createPortForward({
      host_id: hostId,
      label: label.trim() || `${lp} → ${remoteHost}:${rp}`,
      local_port: lp,
      remote_host: remoteHost.trim(),
      remote_port: rp,
    });
    setLabel("");
    setLocalPort("");
    setRemotePort("");
    setAdding(false);
    refresh();
  };

  const toggle = async (forward: PortForward) => {
    const current = statuses[forward.id];
    const running =
      current && (current.state === "listening" || current.state === "connected");
    setBusyId(forward.id);
    try {
      if (running) {
        await api.stopForward(sessionId, forward.id);
        onStatus(`Stopped forward ${forward.label}`);
      } else {
        const started = await api.startForward(sessionId, forward.id);
        setStatuses((prev) => ({ ...prev, [forward.id]: started }));
        onStatus(
          `Listening on 127.0.0.1:${forward.local_port} → ${forward.remote_host}:${forward.remote_port}`,
        );
      }
    } catch (err) {
      const message = String(err).replace(/^Error:\s*/, "");
      setStatuses((prev) => ({
        ...prev,
        [forward.id]: {
          session_id: sessionId,
          forward_id: forward.id,
          label: forward.label,
          local_port: forward.local_port,
          remote_host: forward.remote_host,
          remote_port: forward.remote_port,
          state: "failed",
          connections: 0,
          error: message,
        },
      }));
      onStatus(message);
    } finally {
      setBusyId(null);
      refresh();
    }
  };

  const inputStyle = {
    background: "var(--bg-base)",
    borderColor: "var(--border-subtle)",
    color: "var(--text)",
  } as const;

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-1 z-20 flex w-80 flex-col rounded-xl border shadow-xl"
      style={{ background: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Port forwarding
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setAdding((v) => !v)}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="New forward"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={onClose}
            className="hover-subtle rounded p-1.5"
            style={{ color: "var(--text-muted)" }}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {adding && (
        <div className="flex flex-col gap-1.5 border-b px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            className="rounded-md border px-2 py-1 text-xs outline-none"
            style={inputStyle}
          />
          <div className="flex items-center gap-1.5">
            <input
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ""))}
              placeholder="Local port"
              className="w-20 rounded-md border px-2 py-1 text-xs outline-none"
              style={inputStyle}
            />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>→</span>
            <input
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
              placeholder="Remote host"
              className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs outline-none"
              style={inputStyle}
            />
            <input
              value={remotePort}
              onChange={(e) => setRemotePort(e.target.value.replace(/\D/g, ""))}
              placeholder="Port"
              className="w-16 rounded-md border px-2 py-1 text-xs outline-none"
              style={inputStyle}
            />
          </div>
          <button
            onClick={() => void submit()}
            className="hover-subtle-active rounded-md px-2 py-1 text-xs font-medium"
            style={{ background: "var(--accent)", color: "var(--accent-fg, #fff)" }}
          >
            Save forward
          </button>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto p-1.5">
        {forwards.length === 0 && !adding && (
          <div className="px-2 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
            No forwards for this host. Click + to add one.
          </div>
        )}
        {forwards.map((forward) => {
          const status = statuses[forward.id];
          const running =
            status?.state === "listening" || status?.state === "connected";
          const failed = status?.state === "failed";
          const badge = statusLabel(status);
          const toggleOn = running || (failed && Boolean(status?.error && busyId === forward.id));

          return (
            <div
              key={forward.id}
              className="hover-subtle group flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <button
                onClick={() => void toggle(forward)}
                disabled={busyId === forward.id}
                className="relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50"
                style={{
                  background: running
                    ? "var(--accent)"
                    : failed
                      ? "rgba(248,113,113,0.45)"
                      : "var(--border-subtle)",
                }}
                title={running ? "Stop" : "Start"}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: running || toggleOn ? "14px" : "2px" }}
                />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                    {forward.label}
                  </span>
                  <span
                    className="shrink-0 text-[10px] font-medium"
                    style={{ color: badge.color }}
                  >
                    {badge.text}
                  </span>
                </div>
                <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                  127.0.0.1:{forward.local_port} → {forward.remote_host}:{forward.remote_port}
                </span>
                {status?.error && (
                  <span className="truncate text-[10px]" style={{ color: "#f87171" }} title={status.error}>
                    {status.error}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  void api.stopForward(sessionId, forward.id).catch(() => undefined);
                  void api.deletePortForward(forward.id).then(refresh);
                }}
                className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100"
                style={{ color: "#f87171" }}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
