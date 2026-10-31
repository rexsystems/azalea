import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import * as api from "../../lib/api";
import { Logo } from "../Logo";
import { WbImport, WbPlus, WbTerminal, type WbIcon } from "./wbIcons";

interface WorkbenchEmptyProps {
  onImportSsh: () => void;
  onAddHost: () => void;
  /** Missing on platforms without a local shell. */
  onOpenLocalTerminal?: () => void;
  onRestoreBackup: () => void;
  backupBusy?: boolean;
}

type ScanState =
  { kind: "pending" } | { kind: "done"; hosts: number; keys: number } | { kind: "none" };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the SSH folder scan found, in one line. Never guesses a count. */
function importHint(scan: ScanState): string {
  if (scan.kind === "pending") return "Looking for hosts and keys…";
  if (scan.kind === "none") return "Hosts and keys from your SSH folder. You pick which to keep.";
  if (scan.hosts === 0 && scan.keys === 0) {
    return "No Host entries or keys found yet. You can still import later.";
  }
  return `Found ${plural(scan.hosts, "host", "hosts")} and ${plural(
    scan.keys,
    "key",
    "keys",
  )}. You pick which ones to keep.`;
}

interface StartCard {
  id: string;
  icon: WbIcon;
  title: string;
  hint: string;
  kbd: string;
  onClick: () => void;
  primary?: boolean;
}

/**
 * First-run screen for the New and Minimal interfaces: one obvious way in
 * (import from the SSH config), two alternatives, and a restore link.
 */
export function WorkbenchEmpty({
  onImportSsh,
  onAddHost,
  onOpenLocalTerminal,
  onRestoreBackup,
  backupBusy = false,
}: WorkbenchEmptyProps) {
  const [scan, setScan] = useState<ScanState>({ kind: "pending" });
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .scanSshDir()
      .then((result) => {
        if (cancelled) return;
        if (!result.exists) {
          setScan({ kind: "none" });
          return;
        }
        setScan({
          kind: "done",
          hosts: result.hosts.filter((h) => !h.already_imported).length,
          keys: result.keys.filter((k) => !k.already_imported).length,
        });
      })
      .catch(() => {
        if (!cancelled) setScan({ kind: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Enter starts the import because the primary card holds focus on arrival.
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        onAddHost();
      } else if (key === "t" && onOpenLocalTerminal) {
        e.preventDefault();
        onOpenLocalTerminal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAddHost, onOpenLocalTerminal]);

  const cards: StartCard[] = [
    {
      id: "import",
      icon: WbImport,
      title: "Import from ~/.ssh/config",
      hint: importHint(scan),
      kbd: "Enter",
      onClick: onImportSsh,
      primary: true,
    },
    {
      id: "add",
      icon: WbPlus,
      title: "Add a host",
      hint: "Hostname, user and a key or password.",
      kbd: "Ctrl N",
      onClick: onAddHost,
    },
  ];
  if (onOpenLocalTerminal) {
    cards.push({
      id: "local",
      icon: WbTerminal,
      title: "Open a local terminal",
      hint: "Your default shell on this computer. No setup needed.",
      kbd: "Ctrl T",
      onClick: onOpenLocalTerminal,
    });
  }

  return (
    <div className="wb-empty-page">
      <div className="wb-empty-col">
        <div>
          <Logo size={40} className="wb-logo" />
          <h1 className="wb-h1">Add your first server</h1>
          <p className="wb-empty-lead">
            Hosts and keys are kept in an encrypted vault on this device. Sync is optional and you
            can turn it on later.
          </p>
        </div>
        <ul role="list" className="wb-start">
          {cards.map((card) => (
            <li key={card.id}>
              <StartButton card={card} buttonRef={card.primary ? primaryRef : undefined} />
            </li>
          ))}
        </ul>
        <p className="wb-empty-foot">
          Coming from another device?{" "}
          <button type="button" className="wb-link" onClick={onRestoreBackup} disabled={backupBusy}>
            Restore an Azalea backup
          </button>
        </p>
      </div>
    </div>
  );
}

function StartButton({
  card,
  buttonRef,
}: {
  card: StartCard;
  buttonRef?: Ref<HTMLButtonElement>;
}): ReactNode {
  const Icon = card.icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      className="wb-start-card"
      data-primary={card.primary ? "true" : undefined}
      onClick={card.onClick}
      aria-keyshortcuts={card.kbd === "Enter" ? undefined : card.kbd.replace("Ctrl ", "Control+")}
    >
      <Icon className="wb-start-icon" />
      <span className="wb-start-text">
        <span className="wb-start-title">{card.title}</span>
        <span className="wb-start-hint" aria-live={card.primary ? "polite" : undefined}>
          {card.hint}
        </span>
      </span>
      <kbd className="wb-kbd" aria-hidden>
        {card.kbd}
      </kbd>
    </button>
  );
}
