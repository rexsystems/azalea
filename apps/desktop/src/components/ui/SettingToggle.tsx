interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function SettingToggle({ label, description, checked, onChange }: SettingToggleProps) {
  return (
    <label
      className="hover-subtle flex cursor-pointer items-start justify-between gap-4 rounded-xl border px-4 py-3"
      style={{
        borderColor: "var(--border-subtle)",
        background: "var(--bg-card)",
      }}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {label}
        </div>
        {description && (
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="transition-ui relative mt-0.5 h-6 w-11 shrink-0 rounded-full"
        style={{
          background: checked ? "var(--accent)" : "var(--bg-card)",
          border: checked ? "none" : "1px solid var(--border-subtle)",
        }}
      >
        <span
          className="transition-ui absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm"
          style={{ left: checked ? "22px" : "2px" }}
        />
      </button>
    </label>
  );
}
