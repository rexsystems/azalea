interface PlanBadgeProps {
  plan: "free" | "pro";
  size?: "sm" | "md";
}

export function PlanBadge({ plan, size = "sm" }: PlanBadgeProps) {
  const isPro = plan === "pro";
  const label = isPro ? "Pro" : "Free";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded font-medium uppercase tracking-wide ${
        size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]"
      }`}
      style={{
        background: isPro ? "var(--accent-muted)" : "transparent",
        border: "1px solid var(--border-subtle)",
        color: isPro ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {label}
    </span>
  );
}
