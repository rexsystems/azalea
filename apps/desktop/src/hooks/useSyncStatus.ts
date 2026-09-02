import { useCallback, useEffect, useState } from "react";
import * as api from "../lib/api";

export function useSyncStatus() {
  const [status, setStatus] = useState<api.SyncStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.syncStatus();
      setStatus(next);
      return next;
    } catch {
      setStatus(null);
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, setStatus, refresh };
}
