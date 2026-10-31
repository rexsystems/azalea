import { useCallback, useState } from "react";
import {
  currentDefaultTerminalSettings,
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
    const defaults = currentDefaultTerminalSettings();
    setTerminalSettings(defaults);
    setStoredTerminalSettings(defaults);
  }, []);

  return { terminalSettings, updateTerminalSettings, resetTerminalSettings };
}
