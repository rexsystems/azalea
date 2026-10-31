import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Search, WindowClose } from "../icons";
import { Logo } from "../Logo";
import { MaximizeIcon, RestoreIcon } from "../TitleBar";

interface WorkbenchTitleBarProps {
  onOpenPalette: () => void;
}

/**
 * Window chrome for the New and Minimal interfaces: brand, a command palette
 * trigger and the window controls. The whole bar is a drag region except the
 * interactive controls.
 */
export function WorkbenchTitleBar({ onOpenPalette }: WorkbenchTitleBarProps) {
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
    return () => unlisten?.();
  }, []);

  const appWindow = getCurrentWindow();

  return (
    <header data-tauri-drag-region className="wb-titlebar">
      <div data-tauri-drag-region className="wb-titlebar-brand">
        <Logo size={16} style={{ color: "var(--accent)", pointerEvents: "none" }} />
        <span data-tauri-drag-region>Azalea</span>
      </div>

      <div data-tauri-drag-region className="wb-titlebar-center">
        <button
          type="button"
          className="wb-palette-trigger"
          onClick={onOpenPalette}
          aria-label="Search hosts and commands"
          aria-keyshortcuts="Control+/"
        >
          <Search size={13} />
          <span className="wb-palette-label">Search hosts and commands</span>
          <kbd className="wb-kbd">Ctrl /</kbd>
        </button>
      </div>

      <div className="wb-window-controls">
        <button
          type="button"
          onClick={() => void appWindow.minimize()}
          className="titlebar-btn"
          aria-label="Minimize window"
          title="Minimize"
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          onClick={() => void appWindow.toggleMaximize()}
          className="titlebar-btn"
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? <RestoreIcon size={12} /> : <MaximizeIcon size={12} />}
        </button>
        <button
          type="button"
          onClick={() => void appWindow.close()}
          className="titlebar-btn titlebar-btn-close"
          aria-label="Close window"
          title="Close"
        >
          <WindowClose size={14} />
        </button>
      </div>
    </header>
  );
}
