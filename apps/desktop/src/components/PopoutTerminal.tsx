import { useTerminalSettings } from "../hooks/useTerminalSettings";
import * as api from "../lib/api";
import { TerminalView } from "./Terminal";
import { TitleBar } from "./TitleBar";

interface PopoutTerminalProps {
  sessionId: string;
  title: string;
}

export function PopoutTerminal({ sessionId, title }: PopoutTerminalProps) {
  const { terminalSettings } = useTerminalSettings();

  return (
    <div
      className="flex h-full select-none flex-col"
      style={{ background: "var(--terminal-bg)" }}
    >
      <TitleBar title={title} />
      <div className="min-h-0 flex-1">
        <TerminalView
          sessionId={sessionId}
          active
          settings={terminalSettings}
          onResize={(id, cols, rows) => void api.resizeTerminal(id, cols, rows)}
        />
      </div>
    </div>
  );
}
