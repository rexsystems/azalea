import { useHideHostAddresses } from "../../hooks/useHideHostAddresses";
import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";

export interface FooterSession {
  isLocal: boolean;
  username: string;
  hostname: string;
  port: number;
  status: SessionStatus;
  cols?: number;
  rows?: number;
}

interface SessionFooterProps {
  session: FooterSession | null;
  statusMessage?: string;
}

/**
 * Status line under the work area. Shows only facts the app knows: the
 * active endpoint, its connection state, the terminal grid size and the last
 * status message, which is announced politely to screen readers.
 */
export function SessionFooter({ session, statusMessage }: SessionFooterProps) {
  const hideAddress = useHideHostAddresses();
  const status = session ? sessionStatusInfo(session.status) : null;
  // Respect "Hide host addresses" so the footer is safe to screen-share.
  const endpoint = !session
    ? null
    : session.isLocal
      ? "Local shell"
      : hideAddress
        ? session.username
        : `${session.username}@${session.hostname}:${session.port}`;
  return (
    <footer className="wb-footer">
      {session && status && (
        <div className="wb-footer-session">
          <span className={`wb-dot wb-dot-${status.tone}`} aria-hidden />
          <span className="wb-footer-strong">{endpoint}</span>
          <span>{status.label}</span>
          {session.cols != null && session.rows != null && (
            <span
              className="wb-footer-meta"
              aria-label={`${session.cols} columns by ${session.rows} rows`}
            >
              {session.cols}×{session.rows}
            </span>
          )}
        </div>
      )}
      <div className="wb-footer-message" role="status" aria-live="polite">
        {statusMessage}
      </div>
    </footer>
  );
}
