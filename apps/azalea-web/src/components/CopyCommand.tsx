"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyCommandProps {
  command: string;
  className?: string;
}

export function CopyCommand({ command, className = "" }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={`glass-surface flex items-stretch overflow-hidden rounded-xl border ${className}`}
      style={{ borderColor: "var(--border-strong)" }}
    >
      <code
        className="min-w-0 flex-1 overflow-x-auto px-4 py-3 text-left text-[0.8125rem] leading-relaxed sm:text-sm"
        style={{ color: "var(--text)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="btn btn-ghost shrink-0 rounded-none border-l px-3.5"
        style={{ borderColor: "var(--border-strong)" }}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy"}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
