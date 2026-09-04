import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "./icons";
import { Logo } from "./Logo";

function MaximizeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect
        x="1.5"
        y="1.5"
        width="9"
        height="9"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.4"
      />
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

export function TitleBar({ title }: { title?: string }) {
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
      className="flex h-10 shrink-0 items-center justify-between border-b"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2.5 px-3.5 text-sm font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        <Logo size={18} style={{ color: "var(--accent)", pointerEvents: "none" }} />
        {title ?? "Azalea"}
      </div>

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
          <X size={17} />
        </button>
      </div>
    </div>
  );
}
