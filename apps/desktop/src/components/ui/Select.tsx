import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "../icons";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  /** Where the menu opens. Default bottom. */
  menuPlacement?: "bottom" | "top";
  /** Compact trigger for dense toolbars / composers. */
  size?: "md" | "sm";
  className?: string;
  onChange: (value: string) => void;
}

export function Select({
  label,
  value,
  options,
  placeholder,
  icon,
  menuPlacement = "bottom",
  size = "md",
  className,
  onChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const listId = useId();
  const compact = size === "sm";

  const selected = options.find((o) => o.value === value);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const leadingIcon = selected?.icon ?? icon;
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
    <div ref={ref} className={`relative flex flex-col ${compact ? "gap-0" : "gap-1.5"} ${className ?? ""}`}>
      {label && (
        <span
          id={labelId}
          className={compact ? "text-[11px] font-medium" : "text-sm font-medium"}
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </span>
      )}

      <div className="relative">
        {leadingIcon && (
          <span
            className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 ${
              compact ? "left-2.5" : "left-3.5"
            }`}
            style={{ color: "var(--text-muted)" }}
            aria-hidden
          >
            {leadingIcon}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const nextIndex = Math.min(
                Math.max(selectedIndex + direction, 0),
                options.length - 1,
              );
              onChange(options[nextIndex].value);
              setOpen(true);
            }
            if (event.key === "Home" && options.length > 0) {
              event.preventDefault();
              onChange(options[0].value);
            }
            if (event.key === "End" && options.length > 0) {
              event.preventDefault();
              onChange(options[options.length - 1].value);
            }
          }}
          aria-labelledby={label ? labelId : undefined}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          className={`transition-ui flex w-full cursor-pointer items-center justify-between gap-2 border text-left outline-none focus:border-[var(--accent)] ${
            compact
              ? "rounded-full py-1 pr-2 text-[12px] font-medium"
              : "rounded-lg py-3 pr-3.5 text-sm"
          }`}
          style={{
            paddingLeft: leadingIcon ? (compact ? "1.75rem" : "2.5rem") : compact ? "0.625rem" : "0.875rem",
            background: compact ? "var(--bg-card)" : "var(--bg-input)",
            borderColor: open ? "var(--accent)" : compact ? "var(--border)" : "var(--border-subtle)",
            color: selected ? "var(--text)" : "var(--text-muted)",
          }}
        >
          <span className="min-w-0 truncate">{display}</span>
          <ChevronDown
            size={compact ? 12 : 16}
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            style={{ color: "var(--text-muted)" }}
          />
        </button>
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className={`animate-menu-in absolute z-[60] max-h-52 overflow-y-auto rounded-lg border py-1 ${
            compact ? "left-0 min-w-full w-max max-w-[240px]" : "left-0 right-0"
          } ${
            menuPlacement === "top" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
          }`}
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--border)",
            boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)",
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value || "__empty"}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`hover-subtle transition-ui flex w-full cursor-pointer items-center gap-2.5 text-left ${
                  compact ? "px-2.5 py-2 text-[12px]" : "px-3 py-2.5 text-sm"
                }`}
                style={{
                  color: active ? "var(--text)" : "var(--text-secondary)",
                  background: active ? "var(--accent-muted)" : "transparent",
                }}
              >
                {option.icon && (
                  <span
                    className="flex shrink-0 items-center justify-center"
                    style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}
                  >
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active && (
                  <Check size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
