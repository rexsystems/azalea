import { useHideHostAddresses } from "../../hooks/useHideHostAddresses";
import { abbreviateHome } from "../../lib/sessionInfo";
import { sessionStatusInfo, type SessionStatus } from "./sessionStatus";

export interface FooterSession {
  isLocal: boolean;
  username: string;
  hostname: string;
  port: number;
  status: SessionStatus;
  /** How the session signed in, such as "ed25519 · laptop" or "password". */
  auth?: string | null;
  /** Working directory reported by the shell (OSC 7 or the window title). */
  cwd?: string | null;
  cols?: number;
  rows?: number;
}

interface SessionFooterProps {
  session: FooterSession | null;
  statusMessage?: string;
}

/**
 * Status line under the terminal. Shows only facts the app knows: endpoint,
 * sign-in method, working directory, encoding and grid size. The
 * last status message is announced politely to screen readers.
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
  const connected = session?.status === "connected";
  const cwd =
    session?.cwd && !session.isLocal ? abbreviateHome(session.cwd, session.username) : session?.cwd;
  return (
    <footer className="wb-foot">
      {session && status && (
        <>
          <span className="wb-foot-item">
            <span className={`wb-dot ${status.tone}`} aria-hidden />
            <span className="wb-mono">{endpoint}</span>
            {!connected && <span>{status.label}</span>}
          </span>
          {session.auth && <span>{session.auth}</span>}
        </>
      )}
      <span className="wb-foot-r">
        <span className="wb-foot-msg" role="status" aria-live="polite">
          {statusMessage}
        </span>
        {session?.cwd && (
          <span className="wb-foot-cwd" title={session.cwd}>
            {cwd}
          </span>
        )}
        {session && <span className="wb-mono">UTF-8</span>}
        {session?.cols != null && session.rows != null && (
          <span className="wb-mono" aria-label={`${session.cols} columns by ${session.rows} rows`}>
            {session.cols}×{session.rows}
          </span>
        )}
      </span>
    </footer>
  );
}
