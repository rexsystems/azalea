import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  icon?: ReactNode;
}

const fieldClass =
  "transition-ui w-full rounded-lg border px-3.5 py-3 text-sm outline-none focus:border-[var(--accent)] no-number-spinners";

const fieldStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border-subtle)",
  color: "var(--text)",
};

export function Input({ label, hint, icon, className = "", id, style, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}
      <span className="relative block">
        {icon && (
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <input
          id={inputId}
          className={`${fieldClass} placeholder:opacity-50 ${icon ? "!pl-10" : ""} ${className}`}
          style={{ ...fieldStyle, ...style }}
          {...props}
        />
      </span>
      {hint && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
