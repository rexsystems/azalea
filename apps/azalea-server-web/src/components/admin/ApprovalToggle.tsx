"use client";

import { FiLoader } from "react-icons/fi";

interface ApprovalToggleProps {
  approved: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (approved: boolean) => void;
  id?: string;
  approvedLabel?: string;
  pendingLabel?: string;
}

export function ApprovalToggle({
  approved,
  disabled = false,
  busy = false,
  onChange,
  id,
  approvedLabel = "Approved",
  pendingLabel = "Pending",
}: ApprovalToggleProps) {
  const inactive = disabled || busy;

  return (
    <label
      htmlFor={id}
      className="approval-toggle"
      data-approved={approved ? "true" : "false"}
      data-disabled={inactive ? "true" : "false"}
    >
      <input
        id={id}
        type="checkbox"
        className="approval-toggle-input"
        checked={approved}
        disabled={inactive}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="approval-toggle-track" aria-hidden="true">
        <span className="approval-toggle-thumb" />
      </span>
      <span className="approval-toggle-label">{approved ? approvedLabel : pendingLabel}</span>
      {busy && <FiLoader size={12} className="animate-spin" style={{ color: "var(--text-muted)" }} />}
    </label>
  );
}
