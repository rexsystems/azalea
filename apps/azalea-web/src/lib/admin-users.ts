export interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin" | string;
  plan: "free" | "pro" | string;
  disabled: boolean;
  vault_bytes: number;
  created_at: string;
  updated_at: string;
  vault_updated_at: string | null;
  last_sign_in_at: string | null;
}

export interface AdminSettings {
  signup_enabled: boolean;
  captcha_provider: string;
  captcha_site_key: string;
  captcha_secret_configured: boolean;
  free_limit_bytes: number;
  pro_limit_bytes: number;
  instance_name: string;
}

export type AdminUserSort =
  | "storage_desc"
  | "storage_asc"
  | "joined_desc"
  | "joined_asc"
  | "sign_in_desc"
  | "email_asc";

export type RoleFilter = "all" | "admin" | "user";
export type PlanFilter = "all" | "free" | "pro";
export type StatusFilter = "all" | "active" | "disabled";

export const ADMIN_USER_SORT_OPTIONS: { id: AdminUserSort; label: string }[] = [
  { id: "storage_desc", label: "Storage · high" },
  { id: "storage_asc", label: "Storage · low" },
  { id: "joined_desc", label: "Registered · new" },
  { id: "joined_asc", label: "Registered · old" },
  { id: "sign_in_desc", label: "Last sign-in" },
  { id: "email_asc", label: "Email" },
];

export function fmtAdminDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtAdminDateTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtAdminBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function planLimit(user: AdminUser, settings: AdminSettings | null): number {
  if (!settings) return user.plan === "pro" ? 10_485_760 : 262_144;
  return user.plan === "pro" ? settings.pro_limit_bytes : settings.free_limit_bytes;
}

export function usagePct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function totalVaultBytes(users: AdminUser[]): number {
  return users.reduce((sum, user) => sum + (user.vault_bytes ?? 0), 0);
}

export function filterAdminUsers(
  users: AdminUser[],
  query: string,
  role: RoleFilter,
  plan: PlanFilter,
  status: StatusFilter,
): AdminUser[] {
  const q = query.trim().toLowerCase();
  return users.filter((user) => {
    if (role !== "all" && user.role !== role) return false;
    if (plan !== "all" && user.plan !== plan) return false;
    if (status === "active" && user.disabled) return false;
    if (status === "disabled" && !user.disabled) return false;
    if (!q) return true;
    return (
      user.email.toLowerCase().includes(q) ||
      user.id.toLowerCase().includes(q) ||
      user.role.toLowerCase().includes(q) ||
      user.plan.toLowerCase().includes(q)
    );
  });
}

export function sortAdminUsers(users: AdminUser[], sort: AdminUserSort): AdminUser[] {
  const next = [...users];
  const time = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  switch (sort) {
    case "storage_desc":
      return next.sort((a, b) => (b.vault_bytes ?? 0) - (a.vault_bytes ?? 0));
    case "storage_asc":
      return next.sort((a, b) => (a.vault_bytes ?? 0) - (b.vault_bytes ?? 0));
    case "joined_desc":
      return next.sort((a, b) => time(b.created_at) - time(a.created_at));
    case "joined_asc":
      return next.sort((a, b) => time(a.created_at) - time(b.created_at));
    case "sign_in_desc":
      return next.sort((a, b) => time(b.last_sign_in_at) - time(a.last_sign_in_at));
    case "email_asc":
      return next.sort((a, b) => a.email.localeCompare(b.email, undefined, { sensitivity: "base" }));
    default:
      return next;
  }
}

export function monthBuckets(users: AdminUser[], months = 6): { label: string; count: number }[] {
  const now = new Date();
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString(undefined, { month: "short" }),
      count: 0,
    });
  }
  for (const user of users) {
    const date = new Date(user.created_at);
    if (Number.isNaN(date.getTime())) continue;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  }
  return buckets.map(({ label, count }) => ({ label, count }));
}
