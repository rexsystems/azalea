import { Tick } from "../icons";

interface CheckboxProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Compact control for dense panels (AI chat settings, etc.). */
  size?: "md" | "sm";
  className?: string;
}

/** Same control as RexUI Checkbox (compact box + label + muted description). */
export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  size = "md",
  className = "",
}: CheckboxProps) {
  const compact = size === "sm";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex w-full cursor-pointer items-center text-left transition-ui disabled:cursor-not-allowed disabled:opacity-55 ${
        compact ? "gap-2" : "items-start gap-3"
      } ${className}`}
    >
      <span
        className={`flex shrink-0 items-center justify-center border transition-ui ${
          compact
            ? "h-3.5 w-3.5 rounded"
            : "mt-0.5 h-5 w-5 rounded-md"
        }`}
        style={{
          background: checked ? "var(--accent)" : "var(--bg-input)",
          borderColor: checked ? "var(--accent)" : "var(--border)",
          color: "var(--accent-fg)",
        }}
      >
        {checked ? (
          <Tick size={compact ? 9 : 12} strokeWidth={2.5} />
        ) : null}
      </span>
      <span className="min-w-0">
        <span
          className={`block font-medium ${compact ? "text-[12px] leading-tight" : "text-sm"}`}
          style={{ color: "var(--text)" }}
        >
          {label}
        </span>
        {description ? (
          <span
            className={`mt-0.5 block truncate ${compact ? "text-[11px]" : "text-xs"}`}
            style={{ color: "var(--text-muted)" }}
          >
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
