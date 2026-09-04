import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  onChange: (value: string) => void;
}

export function Select({ label, value, options, placeholder, icon, onChange }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const display =
    selected?.label ??
    placeholder ??
    options.find((o) => o.value === "")?.label ??
    "Select...";

  useEffect(() => {
    if (!open) return;

    const closeOnClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", closeOnClick);
    window.addEventListener("keydown", closeOnEsc);
    return () => {
      window.removeEventListener("mousedown", closeOnClick);
      window.removeEventListener("keydown", closeOnEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex flex-col gap-1.5">
      {label && (
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}

      <div className="relative">
        {icon && (
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="transition-ui flex w-full items-center justify-between gap-2 rounded-lg border py-3 pr-3.5 text-left text-sm outline-none focus:border-[var(--accent)]"
          style={{
            paddingLeft: icon ? "2.5rem" : "0.875rem",
            background: "var(--bg-input)",
            borderColor: open ? "var(--accent)" : "var(--border-subtle)",
            color: selected ? "var(--text)" : "var(--text-muted)",
          }}
        >
          <span className="min-w-0 truncate">{display}</span>
          <ChevronDown
            size={16}
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        </button>
      </div>

      {open && (
        <div
          className="animate-menu-in absolute left-0 right-0 top-[calc(100%+4px)] z-[60] max-h-52 overflow-y-auto rounded-lg border py-1"
          style={{
            background: "var(--bg-panel)",
            borderColor: "var(--border)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value || "__empty"}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="hover-subtle transition-ui flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                style={{
                  color: active ? "var(--text)" : "var(--text-secondary)",
                  background: active ? "var(--accent-muted)" : "transparent",
                }}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {active && <Check size={14} style={{ color: "var(--accent)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
