import type { ReactNode } from "react";
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Right panel overlay — does not shrink or reflow main content. */
export function Drawer({ open, title, subtitle, onClose, children, footer }: DrawerProps) {
  if (!open) return null;

  return (
    <aside
      className="animate-drawer-in absolute right-0 top-0 z-20 flex h-full w-[min(100%,28rem)] flex-col border-l"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
        boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.25)",
      }}
    >
      <div
        className="flex items-start justify-between border-b px-5 py-4"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="transition-ui rounded-md p-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && (
        <div
          className="flex gap-2 border-t px-5 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {footer}
        </div>
      )}
    </aside>
  );
}
