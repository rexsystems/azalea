import { useCallback, useState } from "react";
import {
  defaultTerminalSettings,
  getStoredTerminalSettings,
  setStoredTerminalSettings,
  type TerminalSettings,
} from "../lib/settings";

export function useTerminalSettings() {
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>(() =>
    getStoredTerminalSettings(),
  );

  const updateTerminalSettings = useCallback((patch: Partial<TerminalSettings>) => {
    setTerminalSettings((prev) => {
      const next = { ...prev, ...patch };
      setStoredTerminalSettings(next);
      return next;
    });
  }, []);

  const resetTerminalSettings = useCallback(() => {
    setTerminalSettings(defaultTerminalSettings);
    setStoredTerminalSettings(defaultTerminalSettings);
  }, []);

  return { terminalSettings, updateTerminalSettings, resetTerminalSettings };
}
