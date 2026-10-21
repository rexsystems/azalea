import { useCallback, useEffect, useState } from "react";
import {
  BATCH_SETTINGS_EVENT,
  getStoredBatchSettings,
  setStoredBatchSettings,
  type BatchSettings,
} from "../lib/batchSettings";

export function useBatchSettings() {
  const [settings, setSettings] = useState(getStoredBatchSettings);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setSettings(getStoredBatchSettings());
    window.addEventListener(BATCH_SETTINGS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BATCH_SETTINGS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const update = useCallback((patch: Partial<BatchSettings>) => {
    try {
      const next = { ...getStoredBatchSettings(), ...patch };
      setStoredBatchSettings(next);
      setSettings(next);
      setError(null);
    } catch {
      setError("Could not save batch settings on this device. Try again.");
    }
  }, []);
  return { settings, update, error };
}
