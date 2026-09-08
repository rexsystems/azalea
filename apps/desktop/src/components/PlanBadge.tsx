interface PlanBadgeProps {
  plan: "free" | "pro";
  size?: "sm" | "md";
}

export function PlanBadge({ plan, size = "sm" }: PlanBadgeProps) {
  const isPro = plan === "pro";

  return (
    <span
      className={`inline-flex shrink-0 items-center ${
        size === "md" ? "text-[12px]" : "text-[11px]"
      }`}
      style={{
        fontWeight: 550,
        color: isPro ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {isPro ? "Pro" : "Free"}
    </span>
  );
}
