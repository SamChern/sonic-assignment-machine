import { useMemo, useState } from "react";
import { calculateSimilarity } from "@/lib/fingerprintMath";
import type { AudioSourceWithProfile } from "@/components/admin/workbench/types";

/**
 * User/source selection state for the workbench plus the derived lookups
 * (by-user, by-provider, nearest-neighbour) that operate on that selection.
 */
export function useWorkbenchSelection(allSources: AudioSourceWithProfile[], allFingerprints: any[]) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  const getSourcesByUser = (userId: string) => allSources.filter(s => s.user_id === userId);

  const getSourcesByProvider = (provider: string) =>
    allSources.filter(s => s.source_type === provider);

  const selectAllUserSources = (userId: string) => {
    const userSourceIds = allSources
      .filter(s => s.user_id === userId)
      .map(s => s.id);

    setSelectedSourceIds(prev => {
      const otherIds = prev.filter(id => !userSourceIds.includes(id));
      const hasAll = userSourceIds.every(id => prev.includes(id));
      return hasAll ? otherIds : [...new Set([...prev, ...userSourceIds])];
    });
  };

  const selectAllProviderSources = (provider: string) => {
    const ids = getSourcesByProvider(provider).map(s => s.id);
    setSelectedSourceIds(prev => {
      const others = prev.filter(id => !ids.includes(id));
      const hasAll = ids.every(id => prev.includes(id));
      return hasAll ? others : [...new Set([...prev, ...ids])];
    });
  };

  // Compute top 3 closest users for a given user_id from cached fingerprints
  const getTopNeighbors = (userId: string, limit = 3) => {
    const target = allFingerprints.find(fp => fp.user_id === userId);
    if (!target) return [];
    return allFingerprints
      .filter(fp => fp.user_id !== userId)
      .map(fp => ({ fp, similarity: calculateSimilarity(target as any, fp as any, "all") }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  };

  return {
    selectedUserIds,
    setSelectedUserIds,
    selectedSourceIds,
    setSelectedSourceIds,
    toggleUserSelection,
    toggleSourceSelection,
    getSourcesByUser,
    getSourcesByProvider,
    selectAllUserSources,
    selectAllProviderSources,
    getTopNeighbors,
  };
}
