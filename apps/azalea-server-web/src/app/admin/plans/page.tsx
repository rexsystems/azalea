"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRequestError, getStoredSession } from "@/lib/azalea-api";
import {
  createAdminPlan,
  deleteAdminPlan,
  listAdminPlans,
  patchAdminPlan,
} from "@/lib/admin-api";
import type { AdminPlan } from "@/lib/admin-users";
import {
  AdminDenied,
  AdminLayout,
  AdminLoading,
} from "@/components/admin/AdminLayout";

function PlanEditor({
  plan,
  busy,
  onSave,
  onDelete,
}: {
  plan: AdminPlan;
  busy: boolean;
  onSave: (id: string, name: string, bytes: number) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(plan.name);
  const [quota, setQuota] = useState(String(plan.limit_bytes / 1024));
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setName(plan.name);
    setQuota(String(plan.limit_bytes / 1024));
  }, [plan]);
  const changed =
    name.trim() !== plan.name || Number(quota) * 1024 !== plan.limit_bytes;
  const builtin = plan.id === "free" || plan.id === "pro";
  return (
    <form
      className="admin-plan-row"
      aria-label={`${plan.name} plan`}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(plan.id, name.trim(), Math.round(Number(quota) * 1024));
      }}
    >
      <label className="rex-label">
        Plan name
        <input
          className="field"
          required
          maxLength={80}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="rex-hint">
          ID: {plan.id}
          {plan.id === "free" ? " · New accounts start here" : ""}
        </span>
      </label>
      <label className="rex-label">
        Vault quota (KiB)
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
      <div className="admin-plan-assigned">
        <strong>{plan.user_count}</strong>
        <span>assigned {plan.user_count === 1 ? "user" : "users"}</span>
      </div>
      <div className="admin-plan-actions">
        <button className="btn btn-primary" disabled={busy || !changed}>
          Save plan
        </button>
        {!builtin && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || plan.user_count > 0}
            title={
              plan.user_count > 0
                ? "Reassign users before deleting this plan"
                : undefined
            }
            onClick={() => {
              if (confirmDelete) void onDelete(plan.id);
              else setConfirmDelete(true);
            }}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </button>
        )}
        {confirmDelete && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("1024");
  const load = () => listAdminPlans().then(setPlans);
  useEffect(() => {
    if (!getStoredSession()) {
      router.replace("/login?next=%2Fadmin%2Fplans");
      return;
    }
    void load().catch((err) => {
      if (err instanceof ApiRequestError && err.status === 403) setDenied(true);
      else setError(err instanceof Error ? err.message : String(err));
    });
  }, [router]);
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load();
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (denied) return <AdminDenied />;
  if (!plans && !error) return <AdminLoading />;
  return (
    <AdminLayout
      title="Plans & quotas"
      subtitle="Set shared vault quotas, then assign plans in Users."
    >
      {error && (
        <p className="admin-error" role="alert">
          {error}{" "}
          {!plans && (
            <button
              className="btn btn-ghost"
              onClick={() => void run(load, "Plans loaded.")}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {message && (
        <p className="admin-success" role="status">
          {message}
        </p>
      )}
      {plans && (
        <>
          <section
            className="rex-card admin-plan-list"
            aria-label="Existing plans"
          >
            <div className="rex-card-head">
              <h2>Existing plans</h2>
              <span>{plans.length} plans</span>
            </div>
            <p className="rex-hint">
              Quota changes apply to users who follow the plan. Individual
              overrides stay in place. Lowering a quota preserves saved data and
              blocks uploads above the new limit.
            </p>
            {plans.map((plan) => (
              <PlanEditor
                key={plan.id}
                plan={plan}
                busy={busy}
                onSave={(id, name, limit_bytes) =>
                  run(
                    () => patchAdminPlan(id, { name, limit_bytes }),
                    "Plan saved.",
                  )
                }
                onDelete={(id) =>
                  run(() => deleteAdminPlan(id), "Plan deleted.")
                }
              />
            ))}
          </section>
          <section className="rex-card">
            <div className="rex-card-head">
              <h2>Add a plan</h2>
              <span>Quota range: 1 KiB to 1 GiB</span>
            </div>
            <form
              className="admin-plan-create"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await createAdminPlan({
                    id: id.trim(),
                    name: name.trim(),
                    limit_bytes: Math.round(Number(quota) * 1024),
                  });
                  setId("");
                  setName("");
                }, "Plan created. Assign it from Users.");
              }}
            >
              <label className="rex-label">
                Plan ID
                <input
                  className="field"
                  placeholder="team"
                  required
                  maxLength={40}
                  pattern="[a-z][a-z0-9_-]*"
                  value={id}
                  disabled={busy}
                  onChange={(e) => setId(e.target.value)}
                />
                <span className="rex-hint">
                  Stable ID: lowercase letters, digits, hyphens or underscores.
                </span>
              </label>
              <label className="rex-label">
                Display name
                <input
                  className="field"
                  placeholder="Team"
                  required
                  maxLength={80}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="rex-label">
                Vault quota (KiB)
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
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Create plan"}
              </button>
            </form>
          </section>
        </>
      )}
    </AdminLayout>
  );
}
