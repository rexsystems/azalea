import { useMemo } from "react";

interface HostMarkProps {
  seed: string;
  size?: number;
  className?: string;
  rounded?: number;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(h: number, items: T[], salt: number): T {
  return items[((h + Math.imul(salt, 2654435761)) >>> 0) % items.length];
}

const PALETTES = [
  ["#1d4ed8", "#60a5fa", "#0f172a"],
  ["#7c3aed", "#c4b5fd", "#1e1b4b"],
  ["#0f766e", "#5eead4", "#042f2e"],
  ["#b45309", "#fbbf24", "#451a03"],
  ["#be123c", "#fb7185", "#4c0519"],
  ["#0369a1", "#38bdf8", "#0c4a6e"],
  ["#15803d", "#86efac", "#052e16"],
  ["#6d28d9", "#a78bfa", "#2e1065"],
  ["#c2410c", "#fdba74", "#431407"],
  ["#334155", "#94a3b8", "#0f172a"],
];

/** Unique geometric mark from a host seed. Pure SVG, no assets. */
export function HostMark({ seed, size = 48, className = "", rounded = 10 }: HostMarkProps) {
  const art = useMemo(() => {
    const h = hashSeed(seed || "azalea");
    const [a, b, c] = pick(h, PALETTES, 1);
    const style = h % 5;
    const rot = (h % 24) * 15;
    const uid = `hm-${h.toString(36)}`;

    if (style === 0) {
      return (
        <>
          <rect width="64" height="64" fill={c} />
          <circle cx="20" cy="22" r="18" fill={a} />
          <circle cx="48" cy="40" r="22" fill={b} opacity="0.9" />
          <circle cx="34" cy="50" r="10" fill={a} opacity="0.7" />
        </>
      );
    }

    if (style === 1) {
      return (
        <>
          <rect width="64" height="64" fill={c} />
          <path d="M0 40 Q32 8 64 40 L64 64 L0 64 Z" fill={a} />
          <path d="M0 52 Q32 28 64 52 L64 64 L0 64 Z" fill={b} opacity="0.85" />
          <circle cx="48" cy="18" r="8" fill={b} />
        </>
      );
    }

    if (style === 2) {
      return (
        <>
          <rect width="64" height="64" fill={c} />
          <g transform={`rotate(${rot} 32 32)`}>
            <rect x="8" y="8" width="24" height="24" rx="6" fill={a} />
            <rect x="32" y="20" width="24" height="24" rx="6" fill={b} opacity="0.9" />
            <rect x="20" y="32" width="24" height="24" rx="6" fill={a} opacity="0.75" />
          </g>
        </>
      );
    }

    if (style === 3) {
      return (
        <>
          <defs>
            <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} />
            </linearGradient>
          </defs>
          <rect width="64" height="64" fill={c} />
          <circle cx="32" cy="32" r="26" fill={`url(#${uid}-g)`} />
          <circle cx="32" cy="32" r="14" fill={c} />
          <circle cx="32" cy="32" r="6" fill={b} />
        </>
      );
    }

    return (
      <>
        <rect width="64" height="64" fill={c} />
        <path
          d="M8 48 L24 12 L40 48 Z"
          fill={a}
          transform={`rotate(${rot % 40} 32 32)`}
        />
        <path
          d="M24 52 L40 16 L56 52 Z"
          fill={b}
          opacity="0.88"
          transform={`rotate(${(rot + 20) % 40} 32 32)`}
        />
      </>
    );
  }, [seed]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={{ borderRadius: rounded, display: "block", flexShrink: 0 }}
      aria-hidden
    >
      {art}
    </svg>
  );
}

export function hostMarkAccent(seed: string): string {
  const h = hashSeed(seed || "azalea");
  return pick(h, PALETTES, 1)[0];
}
