export type SessionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"
  | "reconnecting";

/** Human label and tone for a session status, shared by sidebar, tabs and footer. */
export function sessionStatusInfo(status: SessionStatus): {
  label: string;
  tone: "ok" | "warn" | "danger";
} {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "connecting":
      return { label: "Connecting", tone: "warn" };
    case "reconnecting":
      return { label: "Reconnecting", tone: "warn" };
    case "disconnected":
      return { label: "Disconnected", tone: "danger" };
    case "error":
      return { label: "Connection failed", tone: "danger" };
  }
}
