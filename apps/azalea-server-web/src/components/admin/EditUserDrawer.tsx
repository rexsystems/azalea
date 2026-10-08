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
  selfId?: string;
  onClose: () => void;
  onSave: (input: {
    role: "user" | "admin";
    plan: "free" | "pro";
    disabled: boolean;
    password?: string;
  }) => Promise<void>;
}

export function EditUserDrawer({
  user,
  settings,
  busy,
  selfId,
  onClose,
  onSave,
}: EditUserDrawerProps) {
  const [role, setRole] = useState<"user" | "admin">("user");
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [disabled, setDisabled] = useState(false);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!user) return;
    setRole(user.role === "admin" ? "admin" : "user");
    setPlan(user.plan === "pro" ? "pro" : "free");
    setDisabled(user.disabled);
    setPassword("");
  }, [user]);

  if (!user) return null;

  const limit = planLimit({ ...user, plan }, settings);
  const pct = usagePct(user.vault_bytes, limit);
  const isSelf = user.id === selfId;

  return (
    <div className="rex-overlay" onClick={onClose}>
      <aside className="rex-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="rex-drawer-head">
          <div>
            <p>Edit user</p>
            <h2>{user.email}</h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="rex-drawer-body">
          <div className="rex-usage-block">
            <div className="admin-bar-meta">
              <span>Vault</span>
              <span>
                {fmtAdminBytes(user.vault_bytes)} / {fmtAdminBytes(limit)} · {pct}%
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
              value={plan}
              onChange={setPlan}
              options={[
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
              ]}
            />
          </label>

          <label className="rex-label">
            New password
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              placeholder="Leave blank to keep"
              value={password}
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
              <p>{isSelf ? "You cannot disable your own account." : "Blocked from signing in."}</p>
            </div>
          </button>
        </div>

        <footer className="rex-drawer-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void onSave({
                role,
                plan,
                disabled: isSelf ? false : disabled,
                password: password.trim() || undefined,
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
