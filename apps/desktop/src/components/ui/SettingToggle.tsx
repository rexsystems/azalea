interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Single clickable control - do not wrap a button in a <label> (double-fires). */
export function SettingToggle({ label, description, checked, onChange }: SettingToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="hover-subtle flex w-full cursor-pointer items-start justify-between gap-4 rounded-xl border px-4 py-3.5 text-left"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--bg-card)",
      }}
    >
      <div className="min-w-0">
        <div className="text-base font-medium" style={{ color: "var(--text)" }}>
          {label}
        </div>
        {description && (
          <div className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {description}
          </div>
        )}
      </div>
      <span
        className="transition-ui relative mt-0.5 h-7 w-12 shrink-0 rounded-full"
        style={{
          background: checked
            ? "var(--accent)"
            : "color-mix(in srgb, var(--text-muted) 40%, var(--bg-input))",
          boxShadow: checked ? "none" : "inset 0 0 0 1px var(--border)",
        }}
        aria-hidden
      >
        <span
          className="transition-ui absolute top-0.5 h-6 w-6 rounded-full shadow-sm"
          style={{
            left: checked ? "24px" : "2px",
            background: checked ? "var(--accent-fg)" : "var(--text-secondary)",
          }}
        />
      </span>
    </button>
  );
}
