import { useCallback, useEffect, useState } from "react";
import type { CreateGroupInput, HostGroup } from "@azalea/shared";
import * as api from "../lib/api";

export function useGroups() {
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.listGroups();
      setGroups(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createGroup = async (input: CreateGroupInput) => {
    const group = await api.createGroup(input);
    setGroups((prev) => [...prev, group].sort((a, b) => a.name.localeCompare(b.name)));
    return group;
  };

  const updateGroup = async (id: string, name: string) => {
    const group = await api.updateGroup(id, { name });
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? group : g)).sort((a, b) => a.name.localeCompare(b.name)),
    );
    return group;
  };

  const removeGroup = async (id: string) => {
    await api.deleteGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  const moveHostToGroup = async (hostId: string, groupId: string | null) => {
    await api.moveHostToGroup(hostId, groupId);
  };

  return {
    groups,
    loading,
    refresh,
    createGroup,
    updateGroup,
    removeGroup,
    moveHostToGroup,
  };
}
