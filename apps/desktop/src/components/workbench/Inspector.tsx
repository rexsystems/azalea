import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ArrowLeftRight, FolderTree, Message, X, type AppIcon } from "../icons";

export type InspectorView = "files" | "assistant" | "forwards";

const VIEW_META: Record<InspectorView, { label: string; icon: AppIcon }> = {
  files: { label: "Files", icon: FolderTree },
  assistant: { label: "Assistant", icon: Message },
  forwards: { label: "Forwards", icon: ArrowLeftRight },
};

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
  /** Views offered for the active session, in display order. */
  views: InspectorView[];
  onViewChange: (view: InspectorView) => void;
  onClose: () => void;
  /** Session the panel is acting on, shown so the target is never ambiguous. */
  contextLabel: string;
  /** Running forwards for the session, shown on the Forwards tab. */
  forwardCount?: number;
  children: ReactNode;
}

/**
 * One right-hand panel for Files, Assistant and Forwards. It owns width,
 * resizing and closing so the embedded panels only render content.
 */
export function Inspector({
  view,
  views,
  onViewChange,
  onClose,
  contextLabel,
  forwardCount = 0,
  children,
}: InspectorProps) {
  const [width, setWidth] = useState(readStoredWidth);
  const [resizing, setResizing] = useState(false);
  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const tabRefs = useRef(new Map<InspectorView, HTMLButtonElement>());
  const idBase = useId();
  const panelId = `${idBase}-panel`;
  const tabId = (v: InspectorView) => `${idBase}-tab-${v}`;

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

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const index = views.indexOf(view);
    let next: InspectorView | undefined;
    if (e.key === "ArrowRight") next = views[(index + 1) % views.length];
    else if (e.key === "ArrowLeft") next = views[(index - 1 + views.length) % views.length];
    else if (e.key === "Home") next = views[0];
    else if (e.key === "End") next = views[views.length - 1];
    if (!next) return;
    e.preventDefault();
    onViewChange(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <aside className="wb-inspector" style={{ width }} aria-label="Session panel">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize session panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        className="wb-inspector-grip"
        data-resizing={resizing ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onGripKeyDown}
      />

      <div className="wb-inspector-head">
        <div role="tablist" aria-label="Session panel views" className="wb-inspector-tabs">
          {views.map((v) => {
            const meta = VIEW_META[v];
            const Icon = meta.icon;
            const selected = v === view;
            return (
              <button
                key={v}
                ref={(node) => {
                  if (node) tabRefs.current.set(v, node);
                  else tabRefs.current.delete(v);
                }}
                id={tabId(v)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className="wb-inspector-tab"
                onClick={() => onViewChange(v)}
                onKeyDown={onTabKeyDown}
              >
                <Icon size={13} />
                {meta.label}
                {v === "forwards" && forwardCount > 0 && (
                  <span className="wb-tool-badge" aria-label={`${forwardCount} running`}>
                    {forwardCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="wb-inspector-context" title={contextLabel}>
          {contextLabel}
        </span>
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onClose}
          aria-label="Close session panel"
          title="Close panel"
        >
          <X size={13} />
        </button>
      </div>

      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(view)}
        className="wb-inspector-body"
      >
        {children}
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
