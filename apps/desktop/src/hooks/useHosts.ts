import { useCallback, useEffect, useState } from "react";
import type { CreateHostInput, Host, UpdateHostInput } from "@azalea/shared";
import * as api from "../lib/api";

export function useHosts() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listHosts();
      setHosts(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createHost = async (input: CreateHostInput) => {
    const host = await api.createHost(input);
    setHosts((prev) => [...prev, host].sort((a, b) => a.name.localeCompare(b.name)));
    return host;
  };

  const updateHost = async (id: string, input: UpdateHostInput) => {
    const host = await api.updateHost(id, input);
    setHosts((prev) =>
      prev
        .map((item) => (item.id === id ? host : item))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    return host;
  };

  const removeHost = async (id: string) => {
    await api.deleteHost(id);
    setHosts((prev) => prev.filter((item) => item.id !== id));
  };

  return {
    hosts,
    loading,
    error,
    refresh,
    createHost,
    updateHost,
    removeHost,
  };
}
