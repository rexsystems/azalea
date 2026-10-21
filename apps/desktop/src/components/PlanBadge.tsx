interface PlanBadgeProps {
  plan: string;
  planName?: string;
  role?: string | null;
  size?: "sm" | "md";
}

export function PlanBadge({ plan, planName, role, size = "sm" }: PlanBadgeProps) {
  const isAdmin = (role ?? "").toLowerCase() === "admin";
  const normalized = plan.trim().toLowerCase();
  if (normalized === "personal") return null;

  const isPro = normalized === "pro";
  const label = isAdmin
    ? "Admin"
    : planName?.trim() ||
      (isPro ? "Pro" : normalized === "free" ? "Free" : plan.replace(/[-_]/g, " "));
  const color = isAdmin ? "var(--danger)" : isPro ? "var(--accent)" : "var(--text-muted)";

  return (
    <span
      className={`inline-flex shrink-0 items-center ${
        size === "md" ? "text-[12px]" : "text-[11px]"
      }`}
      style={{
        fontWeight: 550,
        color,
      }}
    >
      {label}
    </span>
  );
}
