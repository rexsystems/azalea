import type { CSSProperties } from "react";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/** Soft pulse placeholder matching Azalea theme tokens. */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{
        background: "color-mix(in srgb, var(--text-muted) 18%, var(--bg-card))",
        ...style,
      }}
      aria-hidden
    />
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "62%" : "100%" }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-xl border p-4 ${className}`}
      style={{ borderColor: "var(--border-subtle)", background: "var(--bg-card)" }}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="mt-4 h-16 w-full" />
    </div>
  );
}
