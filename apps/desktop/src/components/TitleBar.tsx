import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { Logo } from "./Logo";

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
      className="flex h-9 shrink-0 items-center justify-between border-b"
      style={{
        background: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-3 text-xs font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        <Logo size={16} style={{ color: "var(--accent)", pointerEvents: "none" }} />
        {title ?? "Azalea"}
      </div>

      <div className="flex h-full items-stretch">
        <button
          onClick={() => void appWindow.minimize()}
          className="titlebar-btn"
          title="Minimize"
          tabIndex={-1}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => void appWindow.toggleMaximize()}
          className="titlebar-btn"
          title={maximized ? "Restore" : "Maximize"}
          tabIndex={-1}
        >
          {maximized ? (
            <Copy size={12} style={{ transform: "scaleX(-1)" }} />
          ) : (
            <Square size={11} />
          )}
        </button>
        <button
          onClick={() => void appWindow.close()}
          className="titlebar-btn titlebar-btn-close"
          title="Close"
          tabIndex={-1}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
