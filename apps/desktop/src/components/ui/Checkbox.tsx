import { Tick } from "../icons";

interface CheckboxProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Same control as RexUI Checkbox (compact box + label + muted description). */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className = "",
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex w-full cursor-pointer items-start gap-3 text-left transition-ui disabled:cursor-not-allowed disabled:opacity-55 ${className}`}
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-ui"
        style={{
          background: checked ? "var(--accent)" : "var(--bg-input)",
          borderColor: checked ? "var(--accent)" : "var(--border)",
          color: "var(--accent-fg)",
        }}
      >
        {checked ? <Tick size={12} strokeWidth={2.5} /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
