/** Only an exact, sealed release identity may remain fresh across navigation. */
export type ContractIdentity = {
  plugin_id: string;
  capability: string;
  version?: string | null;
  release_digest?: string | null;
};

export function inputContractCacheOptions(method: ContractIdentity) {
  const pinned = /^[a-f0-9]{64}$/.test(method.release_digest || '');
  return {
    queryKey: ['input-contracts', method.plugin_id, method.capability, method.version, method.release_digest],
    // A sealed release cannot change its parameter schema under this digest.
    // Unpinned/older methods retain a short freshness window, and manual
    // query invalidation can still revalidate either kind.
    staleTime: pinned ? Infinity : 30_000,
    gcTime: pinned ? 30 * 60 * 1000 : 5 * 60 * 1000,
  };
}
