export type AccountPlan = "free" | "pro";

export const FREE_VAULT_LIMIT_BYTES = 262_144;
export const PRO_VAULT_LIMIT_BYTES = 10_485_760;

export interface AccountPlanInfo {
  plan: AccountPlan;
  limit_bytes: number;
  used_bytes: number;
  remaining_bytes: number;
}

export function fmtPlanBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function planLabel(plan: AccountPlan): string {
  return plan === "pro" ? "Pro" : "Free";
}

export const PLAN_COPY = {
  free: {
    name: "Free",
    price: "€0",
    period: "forever",
    storage: "256 KB cloud vault",
    storageBytes: FREE_VAULT_LIMIT_BYTES,
  },
  pro: {
    name: "Pro",
    price: "€10",
    period: "per month",
    storage: "10 MB cloud vault",
    storageBytes: PRO_VAULT_LIMIT_BYTES,
  },
} as const;
