interface PlanBadgeProps {
  plan: "free" | "pro";
  role?: string | null;
  size?: "sm" | "md";
}

export function PlanBadge({ plan, role, size = "sm" }: PlanBadgeProps) {
  const isAdmin = (role ?? "").toLowerCase() === "admin";
  const isPro = plan === "pro";

  const label = isAdmin ? "Admin" : isPro ? "Pro" : "Free";
  const color = isAdmin
    ? "var(--danger)"
    : isPro
      ? "var(--accent)"
      : "var(--text-muted)";

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
