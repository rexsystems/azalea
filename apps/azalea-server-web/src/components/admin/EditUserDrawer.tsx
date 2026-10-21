"use client";

import { useEffect, useState } from "react";
import type { AdminSettings, AdminUser } from "@/lib/admin-users";
import {
  fmtAdminBytes,
  fmtAdminDateTime,
  planLimit,
  usagePct,
} from "@/lib/admin-users";
import { CustomSelect } from "@/components/CustomSelect";

interface EditUserDrawerProps {
  user: AdminUser | null;
  settings: AdminSettings | null;
  busy: boolean;
  error?: string | null;
  selfId?: string;
  onClose: () => void;
  onSave: (input: {
    role: "user" | "admin";
    plan: string;
    quota_override_bytes?: number;
    reset_quota: boolean;
    disabled: boolean;
    password?: string;
  }) => Promise<void>;
}

export function EditUserDrawer({
  user,
  settings,
  busy,
  error,
  selfId,
  onClose,
  onSave,
}: EditUserDrawerProps) {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [plan, setPlan] = useState("free");
  const [customQuota, setCustomQuota] = useState(false);
  const [quota, setQuota] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!user) return;
    setRole(user.role === "admin" ? "admin" : "user");
    setPlan(user.plan);
    setCustomQuota(user.quota_override_bytes != null);
    setQuota(
      String((user.quota_override_bytes ?? planLimit(user, settings)) / 1024),
    );
    setDisabled(user.disabled);
    setPassword("");
  }, [user, settings]);

  useEffect(() => {
    if (!user) return;
    const before = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById("edit-user-dialog");
    drawer?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => before?.focus();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const drawer = document.getElementById("edit-user-dialog");
    const focusables = () =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !busy &&
        !drawer?.querySelector('[aria-expanded="true"]')
      )
        onClose();
      if (event.key === "Tab") {
        const elements = focusables();
        if (!elements.length) {
          event.preventDefault();
          drawer?.focus();
          return;
        }
        const first = elements[0],
          last = elements[elements.length - 1];
        if (!drawer?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
    };
  }, [user, busy, onClose]);

  if (!user) return null;

  const limit = planLimit(
    {
      ...user,
      plan,
      quota_override_bytes: customQuota
        ? Math.round(Number(quota) * 1024)
        : null,
    },
    settings,
  );
  const quotaValid =
    !customQuota ||
    (Number.isFinite(Number(quota)) &&
      Number(quota) >= 1 &&
      Number(quota) <= 1048576);
  const pct = usagePct(user.vault_bytes, limit);
  const isSelf = user.id === selfId;

  return (
    <div
      className="rex-overlay"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <aside
        id="edit-user-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="edit-user-title"
        className="rex-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rex-drawer-head">
          <div>
            <p>Edit user</p>
            <h2 id="edit-user-title">{user.email}</h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="rex-drawer-body">
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <div className="rex-usage-block">
            <div className="admin-bar-meta">
              <span>Vault</span>
              <span>
                {fmtAdminBytes(user.vault_bytes)} / {fmtAdminBytes(limit)} ·{" "}
                {pct}%
              </span>
            </div>
            <div className="rex-meter">
              <div
                className="rex-meter-fill"
                style={{
                  width: `${Math.max(user.vault_bytes ? 3 : 0, pct)}%`,
                  background: pct >= 90 ? "var(--danger)" : "var(--accent)",
                }}
              />
            </div>
          </div>

          <dl className="rex-meta-list">
            <div>
              <dt>Registered</dt>
              <dd>{fmtAdminDateTime(user.created_at)}</dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>{fmtAdminDateTime(user.last_sign_in_at)}</dd>
            </div>
            <div>
              <dt>Vault updated</dt>
              <dd>{fmtAdminDateTime(user.vault_updated_at)}</dd>
            </div>
            <div>
              <dt>User ID</dt>
              <dd className="rex-mono">{user.id}</dd>
            </div>
          </dl>

          <label className="rex-label">
            Role
            <CustomSelect
              ariaLabel="Role"
              disabled={busy}
              value={role}
              onChange={setRole}
              options={[
                { value: "user", label: "User" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </label>

          <label className="rex-label">
            Plan
            <CustomSelect
              ariaLabel="Plan"
              disabled={busy}
              value={plan}
              onChange={setPlan}
              options={(settings?.plans ?? []).map((plan) => ({
                value: plan.id,
                label: plan.name,
              }))}
            />
          </label>

          <fieldset className="admin-user-quota">
            <legend>Storage quota</legend>
            <label className="admin-quota-choice">
              <input
                type="radio"
                name="quota-source"
                checked={!customQuota}
                disabled={busy}
                onChange={() => setCustomQuota(false)}
              />{" "}
              Follow plan quota (
              {fmtAdminBytes(
                settings?.plans.find((item) => item.id === plan)?.limit_bytes ??
                  0,
              )}
              )
            </label>
            <label className="admin-quota-choice">
              <input
                type="radio"
                name="quota-source"
                checked={customQuota}
                disabled={busy}
                onChange={() => setCustomQuota(true)}
              />{" "}
              Custom quota for this user
            </label>
            {customQuota && (
              <label className="rex-label">
                User quota (KiB)
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={1048576}
                  step="any"
                  required
                  value={quota}
                  disabled={busy}
                  onChange={(e) => setQuota(e.target.value)}
                />
              </label>
            )}
            <p className="rex-hint">
              Custom quotas stay in place when the plan changes. Choose Follow
              plan to remove the override. Saved vault data is preserved.
            </p>
          </fieldset>

          <label className="rex-label">
            New password
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to keep"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button
            type="button"
            className={`rex-check ${disabled ? "on" : ""}`}
            disabled={isSelf}
            onClick={() => setDisabled((current) => !current)}
          >
            <span />
            <div>
              <strong>Disabled</strong>
              <p>
                {isSelf
                  ? "You cannot disable your own account."
                  : "Blocked from signing in."}
              </p>
            </div>
          </button>
        </div>

        <footer className="rex-drawer-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy ||
              !quotaValid ||
              (password.length > 0 && password.length < 8)
            }
            onClick={() =>
              void onSave({
                role,
                plan,
                disabled: isSelf ? false : disabled,
                password: password || undefined,
                reset_quota: !customQuota,
                ...(customQuota
                  ? { quota_override_bytes: Math.round(Number(quota) * 1024) }
                  : {}),
              })
            }
          >
            Save
          </button>
        </footer>
      </aside>
    </div>
  );
}
