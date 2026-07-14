import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface ContextMenuSection {
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  sections: ContextMenuSection[];
  onClose: () => void;
}

export function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    el.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  }, [x, y]);

  return createPortal(
    <div
      ref={ref}
      className="animate-menu-in fixed z-[100] min-w-[180px] rounded-lg border py-1"
      style={{
        left: x,
        top: y,
        background: "var(--bg-panel)",
        borderColor: "var(--border)",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sections.map((section, si) => (
        <div key={si}>
          {si > 0 && (
            <div className="my-1 border-t" style={{ borderColor: "var(--border-subtle)" }} />
          )}
          {section.items.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => {
                item.onClick();
                onClose();
              }}
              className="transition-ui flex w-full px-3 py-1.5 text-left text-sm disabled:opacity-40"
              style={{
                color: item.danger ? "#f87171" : "var(--text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = item.danger
                  ? "rgba(127,29,29,0.3)"
                  : "var(--bg-card-hover)";
                e.currentTarget.style.color = item.danger ? "#fca5a5" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = item.danger ? "#f87171" : "var(--text-secondary)";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    sections: ContextMenuSection[];
  } | null>(null);

  const openMenu = (e: React.MouseEvent, sections: ContextMenuSection[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, sections });
  };

  const menuElement = menu ? (
    <ContextMenu {...menu} onClose={() => setMenu(null)} />
  ) : null;

  return { openMenu, menuElement };
}
