import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";

const POLL_MS = 45_000;

export function useSyncStatus() {
  const [status, setStatus] = useState<api.SyncStatus | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

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
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { status, setStatus, refresh };
}
