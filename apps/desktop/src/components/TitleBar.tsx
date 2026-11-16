import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, WindowClose } from "./icons";
import { Logo } from "./Logo";

function MaximizeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RestoreIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="1.5"
        width="7"
        height="7"
        rx="0.8"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M1.5 4.5h6.2c.44 0 .8.36.8.8V11.5H2.3c-.44 0-.8-.36-.8-.8V4.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        fill="none"
      />
    </svg>
  );
}

interface TitleBarProps {
  title?: string;
  /** Replaces the plain title. Used by the Command layout for navigation and session tabs. */
  children?: ReactNode;
  /** Sits left of the window buttons. */
  trailing?: ReactNode;
}

export function TitleBar({ title, children, trailing }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void appWindow.isMaximized().then(setMaximized);
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-center border-b"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        data-tauri-drag-region
        className="flex h-full shrink-0 items-center gap-2.5 pl-3.5 pr-3 text-sm font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        <Logo size={18} style={{ color: "var(--accent)", pointerEvents: "none" }} />
        {children ? null : (title ?? "Azalea")}
      </div>

      {children ? (
        <div className="flex h-full min-w-0 flex-1 items-center gap-1">{children}</div>
      ) : (
        <div data-tauri-drag-region className="h-full flex-1" />
      )}

      {trailing && <div className="flex h-full shrink-0 items-center gap-1 px-1.5">{trailing}</div>}

      <div className="flex h-full items-stretch">
        <button
          onClick={() => void appWindow.minimize()}
          className="titlebar-btn"
          title="Minimize"
          tabIndex={-1}
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => void appWindow.toggleMaximize()}
          className="titlebar-btn"
          title={maximized ? "Restore" : "Maximize"}
          tabIndex={-1}
        >
          {maximized ? <RestoreIcon size={12} /> : <MaximizeIcon size={12} />}
        </button>
        <button
          onClick={() => void appWindow.close()}
          className="titlebar-btn titlebar-btn-close"
          title="Close"
          tabIndex={-1}
        >
          <WindowClose size={14} />
        </button>
      </div>
    </div>
  );
}
