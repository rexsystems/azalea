import { useEffect, useRef, type RefObject } from "react";

export function useDialogFocus(open: boolean, ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const dialog = ref.current;
    if (!dialog) return;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex='0']")].filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialog.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
      if (event.key === "Tab") {
        const elements = controls();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!elements.includes(document.activeElement as HTMLElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, ref]);
}
