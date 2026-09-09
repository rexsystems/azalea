export interface AdminUser {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  approved_at: string | null;
  is_admin: boolean;
  plan: "free" | "pro";
  vault_version: number | null;
  vault_updated_at: string | null;
  vault_bytes: number;
}

export type AdminUserSort =
  | "storage_desc"
  | "storage_asc"
  | "vault_updated_desc"
  | "last_sign_in_desc"
  | "created_desc"
  | "email_asc";

export const ADMIN_USER_SORT_OPTIONS: { id: AdminUserSort; label: string }[] = [
  { id: "storage_desc", label: "Storage (largest first)" },
  { id: "storage_asc", label: "Storage (smallest first)" },
  { id: "vault_updated_desc", label: "Vault updated (newest)" },
  { id: "last_sign_in_desc", label: "Last sign-in (recent)" },
  { id: "created_desc", label: "Joined (newest)" },
  { id: "email_asc", label: "Email (A–Z)" },
];

export function fmtAdminDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtAdminBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function totalVaultBytes(users: AdminUser[]): number {
  return users.reduce((sum, user) => sum + (user.vault_bytes ?? 0), 0);
}

export function sortAdminUsers(users: AdminUser[], sort: AdminUserSort): AdminUser[] {
  const next = [...users];

  const byTime = (a: string | null, b: string | null) => {
    const av = a ? new Date(a).getTime() : 0;
    const bv = b ? new Date(b).getTime() : 0;
    return bv - av;
  };

  switch (sort) {
    case "storage_desc":
      return next.sort((a, b) => (b.vault_bytes ?? 0) - (a.vault_bytes ?? 0));
    case "storage_asc":
      return next.sort((a, b) => (a.vault_bytes ?? 0) - (b.vault_bytes ?? 0));
    case "vault_updated_desc":
      return next.sort((a, b) => byTime(a.vault_updated_at, b.vault_updated_at));
    case "last_sign_in_desc":
      return next.sort((a, b) => byTime(a.last_sign_in_at, b.last_sign_in_at));
    case "created_desc":
      return next.sort((a, b) => byTime(a.created_at, b.created_at));
    case "email_asc":
      return next.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "", undefined, { sensitivity: "base" }));
    default:
      return next;
  }
}

export function isPendingApproval(user: AdminUser): boolean {
  return !user.is_admin && !user.approved_at;
}

export function pendingUsers(users: AdminUser[]): AdminUser[] {
  return users
    .filter(isPendingApproval)
    .sort((a, b) => {
      const aVerified = a.email_confirmed_at ? 1 : 0;
      const bVerified = b.email_confirmed_at ? 1 : 0;
      if (aVerified !== bVerified) return bVerified - aVerified;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
}
