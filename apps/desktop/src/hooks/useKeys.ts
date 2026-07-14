import { useCallback, useEffect, useState } from "react";
import type { CreateKeyInput, ImportKeyInput, SshKey } from "@azalea/shared";
import * as api from "../lib/api";

export function useKeys() {
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listKeys();
      setKeys(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generateKey = async (input: CreateKeyInput) => {
    const key = await api.generateKey(input);
    setKeys((prev) => [...prev, key].sort((a, b) => a.name.localeCompare(b.name)));
    return key;
  };

  const importKey = async (input: ImportKeyInput) => {
    const key = await api.importKey(input);
    setKeys((prev) => [...prev, key].sort((a, b) => a.name.localeCompare(b.name)));
    return key;
  };

  const removeKey = async (id: string) => {
    await api.deleteKey(id);
    setKeys((prev) => prev.filter((item) => item.id !== id));
  };

  return {
    keys,
    loading,
    error,
    refresh,
    generateKey,
    importKey,
    removeKey,
  };
}
