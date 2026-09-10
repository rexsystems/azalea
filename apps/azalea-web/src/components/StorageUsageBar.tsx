import { fmtPlanBytes } from "@/lib/plans";

interface StorageUsageBarProps {
  usedBytes: number;
  limitBytes: number;
  plan: "free" | "pro";
  blocked?: boolean;
}

export function StorageUsageBar({
  usedBytes,
  limitBytes,
  plan,
  blocked = false,
}: StorageUsageBarProps) {
  const pct = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span style={{ color: "var(--text-secondary)" }}>Cloud vault storage</span>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
          style={{
            border: "1px solid var(--border)",
            color: plan === "pro" ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {plan}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: blocked ? "#fbbf24" : "var(--accent)",
          }}
        />
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        {fmtPlanBytes(usedBytes)} / {fmtPlanBytes(limitBytes)} used
      </p>
    </div>
  );
}
