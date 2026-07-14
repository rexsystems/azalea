import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-surface-500 bg-surface-800 shadow-2xl shadow-lilac-950/40">
        <div className="flex items-center justify-between border-b border-surface-600 px-5 py-4">
          <h2 className="text-lg font-semibold text-violet-50">{title}</h2>
          <Button variant="ghost" className="!p-1.5" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-surface-600 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
