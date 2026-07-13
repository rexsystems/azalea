import { useCallback, useEffect, useRef, useState } from "react";
import type { PortForward } from "@azalea/shared";
import { Plus, Trash2, X } from "lucide-react";
import * as api from "../lib/api";

interface ForwardsPopoverProps {
  hostId: string;
  sessionId: string;
  onClose: () => void;
  onStatus: (message: string) => void;
}

export function ForwardsPopover({ hostId, sessionId, onClose, onStatus }: ForwardsPopoverProps) {
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("localhost");
  const [remotePort, setRemotePort] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    void api.listPortForwards(hostId).then(setForwards).catch(() => setForwards([]));
    void api
      .listActiveForwards(sessionId)
      .then((ids) => setActiveIds(new Set(ids)))
      .catch(() => setActiveIds(new Set()));
  }, [hostId, sessionId]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
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
    try {
      if (activeIds.has(forward.id)) {
        await api.stopForward(sessionId, forward.id);
        onStatus(`Stopped forward ${forward.label}`);
      } else {
        await api.startForward(sessionId, forward.id);
        onStatus(`Forwarding 127.0.0.1:${forward.local_port} → ${forward.remote_host}:${forward.remote_port}`);
      }
    } catch (err) {
      onStatus(String(err));
    }
    refresh();
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
            style={{ background: "var(--accent)", color: "#fff" }}
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
          const active = activeIds.has(forward.id);
          return (
            <div
              key={forward.id}
              className="hover-subtle group flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <button
                onClick={() => void toggle(forward)}
                className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
                style={{ background: active ? "var(--accent)" : "var(--border-subtle)" }}
                title={active ? "Stop" : "Start"}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: active ? "14px" : "2px" }}
                />
              </button>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
                  {forward.label}
                </span>
                <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                  127.0.0.1:{forward.local_port} → {forward.remote_host}:{forward.remote_port}
                </span>
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
