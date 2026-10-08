import type { AdminUser } from "@/lib/admin-users";
import { fmtAdminBytes, monthBuckets } from "@/lib/admin-users";

interface AdminChartsProps {
  users: AdminUser[];
}

export function AdminCharts({ users }: AdminChartsProps) {
  const top = [...users].sort((a, b) => b.vault_bytes - a.vault_bytes).slice(0, 8);
  const maxBytes = Math.max(1, ...top.map((user) => user.vault_bytes));
  const signups = monthBuckets(users, 6);
  const maxSignups = Math.max(1, ...signups.map((item) => item.count));
  const free = users.filter((user) => user.plan !== "pro").length;
  const pro = users.filter((user) => user.plan === "pro").length;
  const total = Math.max(1, users.length);
  const freePct = Math.round((free / total) * 100);
  const proPct = 100 - freePct;

  return (
    <div className="admin-grid">
      <section className="rex-card">
        <div className="rex-card-head">
          <h2>Vault usage</h2>
          <span>Top accounts</span>
        </div>
        {top.length === 0 ? (
          <p className="rex-empty">No users yet.</p>
        ) : (
          <div className="admin-bars">
            {top.map((user) => (
              <div key={user.id} className="admin-bar-row">
                <div className="admin-bar-meta">
                  <span className="admin-bar-email">{user.email}</span>
                  <span>{fmtAdminBytes(user.vault_bytes)}</span>
                </div>
                <div className="rex-meter">
                  <div
                    className="rex-meter-fill"
                    style={{ width: `${Math.max(2, (user.vault_bytes / maxBytes) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rex-card">
        <div className="rex-card-head">
          <h2>Signups</h2>
          <span>Last 6 months</span>
        </div>
        <div className="admin-column-chart" aria-hidden>
          {signups.map((item) => (
            <div key={item.label} className="admin-column">
              <div className="admin-column-track">
                <div
                  className="admin-column-fill"
                  style={{ height: `${Math.max(item.count ? 8 : 0, (item.count / maxSignups) * 100)}%` }}
                />
              </div>
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="rex-card">
        <div className="rex-card-head">
          <h2>Plans</h2>
          <span>
            {free} free · {pro} pro
          </span>
        </div>
        <div className="rex-stack-bar" aria-hidden>
          <div style={{ width: `${freePct}%` }} className="rex-stack-free" />
          <div style={{ width: `${proPct}%` }} className="rex-stack-pro" />
        </div>
        <div className="admin-legend">
          <span>
            <i className="rex-dot" /> Free {freePct}%
          </span>
          <span>
            <i className="rex-dot rex-dot-pro" /> Pro {proPct}%
          </span>
        </div>
      </section>
    </div>
  );
}
