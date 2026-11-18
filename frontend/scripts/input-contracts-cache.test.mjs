import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { inputContractCacheOptions } from '../src/lib/input-contract-cache.ts';

const id = 'a'.repeat(64);
const method = { plugin_id: 'example.method', capability: 'rating', version: '1.2.3', release_digest: id };

test('sealed input-contract reads survive hot navigation without repeated backend calls', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let reads = 0;
  const options = inputContractCacheOptions(method);
  assert.equal(options.staleTime, Infinity);
  assert.equal(options.gcTime, 30 * 60 * 1000);
  const read = { ...options, queryFn: async () => { reads++; return { release_digest: id }; } };
  try {
    for (let n = 0; n < 40; n++) {
      const result = await cache.fetchQuery(read);
      assert.equal(result.release_digest, id);
    }
    assert.equal(reads, 1, 'all 40 hot entries use the exact pinned schema');

    const newIdentity = inputContractCacheOptions({ ...method, release_digest: 'b'.repeat(64) });
    assert.notDeepEqual(options.queryKey, newIdentity.queryKey);
    await cache.fetchQuery({ ...newIdentity, queryFn: async () => { reads++; return { release_digest: 'b'.repeat(64) }; } });
    assert.equal(reads, 2, 'a different release always has a separate schema');

    await cache.invalidateQueries({ queryKey: ['input-contracts', method.plugin_id] });
    await cache.fetchQuery(read);
    assert.equal(reads, 3, 'an explicit invalidation forces a fresh read');
  } finally { cache.clear(); }
});

test('unverified releases keep the original short-lived freshness window', () => {
  assert.equal(inputContractCacheOptions({ ...method, release_digest: '' }).staleTime, 30000);
  assert.equal(inputContractCacheOptions({ ...method, release_digest: 'invalid' }).staleTime, 30000);
  assert.notDeepEqual(inputContractCacheOptions(method).queryKey, inputContractCacheOptions({ ...method, version: '1.2.4' }).queryKey);
});
