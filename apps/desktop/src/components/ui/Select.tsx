import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
  /** Where the menu prefers to open. Flips if there is not enough space. */
  menuPlacement?: "bottom" | "top";
  /** Compact trigger for dense toolbars / composers. */
  size?: "md" | "sm";
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface MenuPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placeTop: boolean;
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
  disabled = false,
  onChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }

    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const pad = 8;
      const spaceBelow = window.innerHeight - rect.bottom - pad;
      const spaceAbove = rect.top - pad;
      const preferTop = menuPlacement === "top";
      const placeTop = preferTop
        ? spaceAbove >= 96 || spaceAbove > spaceBelow
        : spaceBelow < 96 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(208, placeTop ? spaceAbove - gap : spaceBelow - gap);
      const width = Math.max(rect.width, compact ? Math.min(240, rect.width) : rect.width);
      setMenuPos({
        top: placeTop ? rect.top - gap : rect.bottom + gap,
        left: Math.min(rect.left, window.innerWidth - width - pad),
        width,
        maxHeight: Math.max(96, maxHeight),
        placeTop,
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, menuPlacement, compact, options.length]);

  useEffect(() => {
    if (!open) return;

    const closeOnClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
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

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            data-azalea-select-menu=""
            className="animate-menu-in z-[200] overflow-y-auto rounded-lg border py-1"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menuPos.placeTop ? undefined : menuPos.top,
              bottom: menuPos.placeTop
                ? window.innerHeight - menuPos.top
                : undefined,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
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
                  onMouseDown={(e) => e.preventDefault()}
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
                      style={{
                        color: active ? "var(--accent)" : "var(--text-muted)",
                      }}
                    >
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {active && (
                    <Check
                      size={14}
                      className="shrink-0"
                      style={{ color: "var(--accent)" }}
                    />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col ${compact ? "gap-0.5" : "gap-1.5"} ${className ?? ""}`}
    >
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
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              options.length > 0
            ) {
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
              ? "rounded-full py-1.5 pr-2 text-[12px] font-medium"
              : "rounded-lg py-3 pr-3.5 text-sm"
          }`}
          style={{
            paddingLeft: leadingIcon
              ? compact
                ? "1.75rem"
                : "2.5rem"
              : compact
                ? "0.625rem"
                : "0.875rem",
            background: compact ? "var(--bg-card)" : "var(--bg-input)",
            borderColor: open
              ? "var(--accent)"
              : compact
                ? "var(--border)"
                : "var(--border-subtle)",
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

      {menu}
    </div>
  );
}
