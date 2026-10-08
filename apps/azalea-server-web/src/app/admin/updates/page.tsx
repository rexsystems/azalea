"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiRefreshCw } from "react-icons/fi";
import { ApiRequestError, getStoredSession } from "@/lib/azalea-api";
import {
  getServerUpdateStatus,
  requestServerUpdate,
  type ServerUpdateStatus,
} from "@/lib/admin-api";
import {
  AdminDenied,
  AdminLayout,
  AdminLoading,
} from "@/components/admin/AdminLayout";

const terminal = new Set(["idle", "succeeded", "failed"]);
const short = (value?: string) =>
  value ? value.replace(/^sha256:/, "").slice(0, 12) : "Unknown";
const date = (value?: number) =>
  value ? new Date(value * 1000).toLocaleString() : "Not checked yet";

export default function UpdatesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ServerUpdateStatus | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<{
    action: "apply" | "rollback";
    selection: string;
  } | null>(null);
  const latest = useRef({ status, queued });
  latest.current = { status, queued };
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const next = await getServerUpdateStatus();
      setStatus(next);
      setError(null);
      setQueued((current) =>
        current &&
        next.operation_id !== current &&
        next.request_pending !== false
          ? current
          : null,
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) setDenied(true);
      else if (err instanceof ApiRequestError && err.status === 401)
        router.replace("/login?next=%2Fadmin%2Fupdates");
      else
        setError(
          latest.current.queued ||
            (latest.current.status &&
              !terminal.has(latest.current.status.phase))
            ? "Waiting for the server to reconnect. Progress resumes automatically after restart."
            : err instanceof Error
              ? err.message
              : String(err),
        );
    } finally {
      loading.current = false;
    }
  }, [router]);
  useEffect(() => {
    if (!getStoredSession()) {
      router.replace("/login?next=%2Fadmin%2Fupdates");
      return;
    }
    let cancelled = false;
    const poll = async () => {
      if (!cancelled) await load();
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [router, load]);
  const request = async (
    action: "check" | "apply" | "rollback",
    reviewedSelection?: string,
  ) => {
    setSending(true);
    setError(null);
    try {
      const result = await requestServerUpdate(
        action,
        reviewedSelection ??
          (action === "apply"
            ? status?.check_id
            : action === "rollback"
              ? status?.backup_id
              : undefined),
      );
      setQueued(result.id);
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };
  if (denied) return <AdminDenied />;
  if (!status && !error) return <AdminLoading />;
  const active =
    sending || !!queued || (!!status && !terminal.has(status.phase));
  return (
    <AdminLayout
      title="Updates"
      subtitle="Server and optional dashboard releases, backups and recovery"
    >
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      <section className="rex-card">
        <div className="rex-card-head">
          <div>
            <h2>Installed version</h2>
            <p className="rex-hint">
              Azalea server {status?.version ?? "…"} ·{" "}
              {status?.revision === "local"
                ? "Local build"
                : short(status?.revision)}
            </p>
          </div>
          <span className="rex-pill">
            {!status?.connected
              ? "Manager offline"
              : active
                ? "Working"
                : status.phase === "failed"
                  ? "Needs attention"
                  : status.available
                    ? "Update available"
                    : status.last_checked
                      ? "Up to date"
                      : "Not checked"}
          </span>
        </div>
        <p className="rex-hint" role="status">
          {queued ? "Request queued…" : status?.message}
        </p>
        <p className="rex-hint">Last checked: {date(status?.last_checked)}</p>
        {active && (
          <p className="rex-hint">
            <FiRefreshCw className="animate-spin" aria-hidden="true" />{" "}
            {queued
              ? "Waiting for the host manager"
              : status?.phase.replaceAll("_", " ")}{" "}
            — this page reconnects after restart.
          </p>
        )}
        <div className="server-ai-toolbar">
          <button
            className="btn btn-ghost"
            disabled={active || !status?.connected}
            onClick={() => void request("check")}
          >
            Check for updates
          </button>
          <button
            className="btn btn-primary"
            disabled={active || !status?.connected || !status.available}
            onClick={() =>
              status?.check_id &&
              setConfirm({ action: "apply", selection: status.check_id })
            }
          >
            Update installation
          </button>
        </div>
      </section>
      {status?.images?.map((image) => (
        <section key={image.service} className="rex-card">
          <div className="rex-card-head">
            <h2>
              {image.service === "azalea-server" ? "Server" : "Dashboard"}
            </h2>
            <span className="rex-pill">
              {image.available ? "New image available" : "Current"}
            </span>
          </div>
          <p className="rex-hint">{image.image}</p>
          <div className="server-ai-grid">
            <div>
              <p className="rex-hint">Installed image</p>
              <code>{short(image.current_digest)}</code>
            </div>
            <div>
              <p className="rex-hint">Published image</p>
              <code>{short(image.latest_digest)}</code>
            </div>
            <div>
              <p className="rex-hint">Installed revision</p>
              <code>{short(image.revision)}</code>
            </div>
          </div>
        </section>
      ))}
      <section className="rex-card">
        <div className="rex-card-head">
          <div>
            <h2>Rollback</h2>
            <p className="rex-hint">
              {status?.backup_created_at
                ? `Pre-update backup: ${date(status.backup_created_at)}`
                : "A database and configuration backup is created before each managed update."}
            </p>
          </div>
          <button
            className="btn btn-ghost"
            disabled={
              active || !status?.connected || !status.rollback_available
            }
            onClick={() =>
              status?.backup_id &&
              setConfirm({ action: "rollback", selection: status.backup_id })
            }
          >
            Restore previous version
          </button>
        </div>
        <p className="rex-hint">
          Rollback restores the previous images, database and configuration.
          Changes made after that backup will be replaced.
        </p>
      </section>
      {confirm && (
        <section
          className="rex-card"
          role="alertdialog"
          aria-label={
            confirm.action === "apply" ? "Confirm update" : "Confirm rollback"
          }
        >
          <h2>
            {confirm.action === "apply"
              ? "Update this installation?"
              : "Restore the pre-update backup?"}
          </h2>
          <p className="rex-hint">
            {confirm.action === "apply"
              ? "The checked images will be downloaded, the API stopped for backup, and the services restarted. Failed health checks trigger automatic recovery."
              : "The API will stop while the previous database, configuration and images are restored. Changes made since the backup will be replaced."}
          </p>
          <div className="server-ai-toolbar">
            <button
              className="btn btn-ghost"
              disabled={sending}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={active}
              onClick={() => void request(confirm.action, confirm.selection)}
            >
              {confirm.action === "apply"
                ? "Back up and update"
                : "Restore backup"}
            </button>
          </div>
        </section>
      )}
      {!status?.connected && (
        <section className="rex-card">
          <h2>Enable host updates</h2>
          <p className="rex-hint">
            Enable the optional host update manager during installation, or
            follow the self-host update setup instructions. Docker socket access
            stays on the host. The same manager works with a CLI-only
            installation.
          </p>
          <a
            className="btn btn-ghost"
            href="https://github.com/rexsystems/azalea/blob/master/docs/self-host.md#managed-updates"
            target="_blank"
            rel="noopener noreferrer"
          >
            Setup instructions
          </a>
        </section>
      )}
    </AdminLayout>
  );
}
