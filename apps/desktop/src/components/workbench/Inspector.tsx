import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { WbClose, WbServer } from "./wbIcons";

export type InspectorView = "files" | "assistant" | "forwards";

const VIEW_TITLE: Record<InspectorView, string> = {
  files: "Files",
  assistant: "Assistant",
  forwards: "Port forwards",
};

const ActionsSlotContext = createContext<HTMLElement | null>(null);

/**
 * Header buttons that belong to the panel's content (upload, refresh, model
 * picker). Rendered into the inspector header so the panel needs no second
 * toolbar of its own.
 */
export function InspectorActions({ children }: { children: ReactNode }) {
  const slot = useContext(ActionsSlotContext);
  return slot ? createPortal(children, slot) : null;
}

const WIDTH_KEY = "azalea-inspector-width";
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const KEY_STEP = 24;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6));
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function storeWidth(value: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(value));
  } catch {
    // Width is a convenience; a full or blocked storage just means no memory.
  }
}

interface InspectorProps {
  view: InspectorView;
  onClose: () => void;
  /** Session the panel is acting on, shown so the target is never ambiguous. */
  contextLabel: string;
  children: ReactNode;
}

/**
 * One right-hand panel for Files, Assistant and Forwards. It owns width,
 * resizing and closing so the embedded panels only render content.
 */
export function Inspector({ view, onClose, contextLabel, children }: InspectorProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commitWidth = useCallback((next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    storeWidth(value);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
    setResizing(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // The panel grows to the left, so moving the pointer left widens it.
    setWidth(clampWidth(drag.startWidth + (drag.startX - e.clientX)));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setResizing(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    storeWidth(widthRef.current);
  };

  const onGripKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") commitWidth(width + KEY_STEP);
    else if (e.key === "ArrowRight") commitWidth(width - KEY_STEP);
    else if (e.key === "Home") commitWidth(MIN_WIDTH);
    else if (e.key === "End") commitWidth(maxWidth());
    else return;
    e.preventDefault();
  };

  return (
    <aside className="wb-insp" style={{ width }} aria-label={VIEW_TITLE[view]}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        className="wb-grip"
        data-resizing={resizing ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onGripKeyDown}
      />

      <div className="wb-insp-h">
        <h2>{VIEW_TITLE[view]}</h2>
        <span className="wb-insp-ctx" title={contextLabel}>
          <WbServer />
          <span>{contextLabel}</span>
        </span>
        <span className="wb-insp-actions" ref={setSlot} />
        <button
          type="button"
          className="wb-ib"
          onClick={onClose}
          aria-label={`Close ${VIEW_TITLE[view].toLowerCase()} panel`}
          title="Close panel"
        >
          <WbClose />
        </button>
      </div>

      <div className="wb-insp-body">
        <ActionsSlotContext.Provider value={slot}>{children}</ActionsSlotContext.Provider>
      </div>
    </aside>
  );
}

/** Placeholder while a lazily loaded panel downloads its code. */
export function PanelLoading({ label }: { label: string }) {
  return (
    <p className="wb-empty" role="status">
      {label}…
    </p>
  );
}
