"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredSession } from "@/lib/azalea-api";
import {
  createAdminUser,
  getAdminSettings,
  listAdminUsers,
  patchAdminSettings,
  patchAdminUser,
} from "@/lib/admin-api";
import {
  ADMIN_USER_SORT_OPTIONS,
  filterAdminUsers,
  fmtAdminBytes,
  fmtAdminDate,
  fmtAdminDateTime,
  planLimit,
  sortAdminUsers,
  totalVaultBytes,
  usagePct,
  type AdminSettings,
  type AdminUser,
  type AdminUserSort,
  type PlanFilter,
  type RoleFilter,
  type StatusFilter,
} from "@/lib/admin-users";
import { AdminCharts } from "@/components/admin/AdminCharts";
import { AdminDenied, AdminLayout, AdminLoading } from "@/components/admin/AdminLayout";
import { EditUserDrawer } from "@/components/admin/EditUserDrawer";
import { CustomSelect } from "@/components/CustomSelect";

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<AdminUserSort>("storage_desc");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newPlan, setNewPlan] = useState<"free" | "pro">("free");
  const [instanceName, setInstanceName] = useState("");

  const session = typeof window === "undefined" ? null : getStoredSession();

  const reload = async () => {
    const [nextUsers, nextSettings] = await Promise.all([listAdminUsers(), getAdminSettings()]);
    setUsers(nextUsers);
    setSettings(nextSettings);
    setInstanceName(nextSettings.instance_name);
  };

  useEffect(() => {
    void (async () => {
      const current = getStoredSession();
      if (!current) {
        router.replace("/login");
        return;
      }
      try {
        await reload();
        setDenied(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/403|forbidden|admin/i.test(message)) {
          setDenied(true);
        } else {
          setError(message);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [router]);

  const filtered = useMemo(
    () => sortAdminUsers(filterAdminUsers(users, query, role, plan, status), sort),
    [users, query, role, plan, status, sort],
  );

  const stats = useMemo(() => {
    const active = users.filter((user) => !user.disabled).length;
    const admins = users.filter((user) => user.role === "admin").length;
    const used = totalVaultBytes(users);
    return { total: users.length, active, disabled: users.length - active, admins, used };
  }, [users]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <AdminLoading />;
  if (denied) return <AdminDenied />;

  return (
    <AdminLayout
      title={settings?.instance_name || "Admin"}
      subtitle={`${stats.total} users · ${fmtAdminBytes(stats.used)} vault used`}
    >
      {error && <p className="admin-error">{error}</p>}

      <section className="admin-stats">
        <article>
          <span>Users</span>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <span>Active</span>
          <strong>{stats.active}</strong>
        </article>
        <article>
          <span>Disabled</span>
          <strong>{stats.disabled}</strong>
        </article>
        <article>
          <span>Admins</span>
          <strong>{stats.admins}</strong>
        </article>
        <article>
          <span>Vault used</span>
          <strong>{fmtAdminBytes(stats.used)}</strong>
        </article>
      </section>

      <AdminCharts users={users} />

      <div className="admin-split">
        <section className="rex-card">
          <div className="rex-card-head">
            <h2>Instance</h2>
            <span>Signup and limits</span>
          </div>
          <div className="admin-instance">
            <label className="rex-label">
              Name
              <input
                className="field"
                value={instanceName}
                onChange={(event) => setInstanceName(event.target.value)}
              />
            </label>
            <div className="admin-instance-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || !settings}
                onClick={() =>
                  void run(async () => {
                    const next = await patchAdminSettings({
                      signup_enabled: !settings?.signup_enabled,
                    });
                    setSettings(next);
                  })
                }
              >
                Signup: {settings?.signup_enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !instanceName.trim()}
                onClick={() =>
                  void run(async () => {
                    const next = await patchAdminSettings({ instance_name: instanceName.trim() });
                    setSettings(next);
                  })
                }
              >
                Save name
              </button>
            </div>
            <p className="rex-hint">
              Free {fmtAdminBytes(settings?.free_limit_bytes ?? 0)} · Pro{" "}
              {fmtAdminBytes(settings?.pro_limit_bytes ?? 0)}
            </p>
          </div>
        </section>

        <section className="rex-card">
          <div className="rex-card-head">
            <h2>Create user</h2>
            <span>Email and password</span>
          </div>
          <div className="admin-create">
            <input
              className="field"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              className="field"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              placeholder="Password (8+)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <CustomSelect
              ariaLabel="New user role"
              value={newRole}
              onChange={setNewRole}
              options={[
                { value: "user", label: "User" },
                { value: "admin", label: "Admin" },
              ]}
            />
            <CustomSelect
              ariaLabel="New user plan"
              value={newPlan}
              onChange={setNewPlan}
              options={[
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
              ]}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await createAdminUser({
                    email,
                    password,
                    role: newRole,
                    plan: newPlan,
                  });
                  setEmail("");
                  setPassword("");
                  await reload();
                })
              }
            >
              Create
            </button>
          </div>
        </section>
      </div>

      <section className="rex-card rex-table-card">
        <div className="rex-card-head rex-table-toolbar">
          <div>
            <h2>Users</h2>
            <span>
              {filtered.length} shown
              {filtered.length !== users.length ? ` of ${users.length}` : ""}
            </span>
          </div>
          <div className="admin-filters">
            <input
              className="field admin-search"
              placeholder="Filter email, id, plan..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <CustomSelect
              ariaLabel="Filter role"
              value={role}
              onChange={setRole}
              options={[
                { value: "all", label: "All roles" },
                { value: "admin", label: "Admins" },
                { value: "user", label: "Users" },
              ]}
            />
            <CustomSelect
              ariaLabel="Filter plan"
              value={plan}
              onChange={setPlan}
              options={[
                { value: "all", label: "All plans" },
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
              ]}
            />
            <CustomSelect
              ariaLabel="Filter status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All status" },
                { value: "active", label: "Active" },
                { value: "disabled", label: "Disabled" },
              ]}
            />
            <CustomSelect
              ariaLabel="Sort users"
              value={sort}
              onChange={setSort}
              options={ADMIN_USER_SORT_OPTIONS.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
            />
          </div>
        </div>

        <div className="rex-table-wrap">
          <table className="rex-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Used</th>
                <th>Registered</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="rex-empty">
                    No users match these filters.
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const limit = planLimit(user, settings);
                  const pct = usagePct(user.vault_bytes, limit);
                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="rex-user-cell">
                          <strong>{user.email}</strong>
                          <span className="rex-mono">{user.id.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`rex-pill ${user.role === "admin" ? "danger" : ""}`}>
                          {user.role}
                        </span>
                      </td>
                      <td>
                        <span className={`rex-pill ${user.plan === "pro" ? "accent" : ""}`}>
                          {user.plan}
                        </span>
                      </td>
                      <td>
                        <span className={`rex-pill ${user.disabled ? "warn" : "ok"}`}>
                          {user.disabled ? "Disabled" : "Active"}
                        </span>
                      </td>
                      <td className="rex-used">
                        <div className="rex-meter compact">
                          <div
                            className="rex-meter-fill"
                            style={{
                              width: `${Math.max(user.vault_bytes ? 4 : 0, pct)}%`,
                              background: pct >= 90 ? "var(--danger)" : "var(--accent)",
                            }}
                          />
                        </div>
                        <span>
                          {fmtAdminBytes(user.vault_bytes)} · {pct}%
                        </span>
                      </td>
                      <td title={fmtAdminDateTime(user.created_at)}>{fmtAdminDate(user.created_at)}</td>
                      <td title={fmtAdminDateTime(user.last_sign_in_at)}>
                        {user.last_sign_in_at ? fmtAdminDate(user.last_sign_in_at) : "Never"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => setEditing(user)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <EditUserDrawer
        user={editing}
        settings={settings}
        busy={busy}
        selfId={session?.user.id}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          if (!editing) return;
          await run(async () => {
            await patchAdminUser(editing.id, input);
            await reload();
            setEditing(null);
          });
        }}
      />
    </AdminLayout>
  );
}
