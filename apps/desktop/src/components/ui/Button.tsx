import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "xs" | "sm" | "md";
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  const sizeClass =
    size === "xs"
      ? "h-6 shrink-0 px-2 text-[11px] rounded-md"
      : size === "sm"
        ? "px-3 py-2 text-sm rounded-lg"
        : "px-4 py-2.5 text-sm rounded-lg";

  const hoverClass =
    variant === "primary"
      ? "enabled:hover:brightness-110"
      : "button-hover-subtle";

  return (
    <button
      className={`transition-ui inline-flex items-center justify-center gap-1.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 ${sizeClass} ${hoverClass} ${className}`}
      style={buttonStyle(variant)}
      {...props}
    >
      {children}
    </button>
  );
}

function buttonStyle(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return { background: "var(--accent)", color: "var(--accent-fg, #fff)" };
    case "secondary":
      return {
        background: "var(--bg-card)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border-subtle)",
      };
    case "ghost":
      return { background: "transparent", color: "var(--text-muted)" };
    case "danger":
      return {
        background: "transparent",
        color: "#f87171",
        border: "1px solid rgba(248,113,113,0.2)",
      };
  }
}
