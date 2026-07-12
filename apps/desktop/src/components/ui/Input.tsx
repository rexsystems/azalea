import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

const fieldClass =
  "transition-ui w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]";

const fieldStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  borderColor: "var(--border-subtle)",
  color: "var(--text)",
};

export function Input({ label, hint, className = "", id, style, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <label className="flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}
      <input
        id={inputId}
        className={`${fieldClass} placeholder:opacity-50 ${className}`}
        style={{ ...fieldStyle, ...style }}
        {...props}
      />
      {hint && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}
