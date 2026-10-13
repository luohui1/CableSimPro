import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { basisPin, basisQuery, type Pin } from '@/features/standards/client';

export const standardsPinQuery = () => queryOptions({
  queryKey: ['standards-basis-pin'], queryFn: ({ signal }) => basisPin(signal), retry: false, staleTime: 30000,
});
export const standardsCatalogueQuery = (pin: Pin | undefined) => queryOptions({
  queryKey: ['standards-basis-catalog', pin?.release_digest], enabled: !!pin,
  queryFn: ({ signal }) => basisQuery(pin!, { schema_version: 'cablesim.standards-query/1', operation: 'browse', standard: 'GB/T 12706.2', edition: '2020', locator: '表 7' }, signal),
  retry: false, staleTime: Infinity,
});

/** Begin the verified read alongside the route chunk; never hold route mounting. */
export function prefetchStandardsBasis(client: QueryClient) {
  void client.fetchQuery(standardsPinQuery()).then(pin => client.prefetchQuery(standardsCatalogueQuery(pin))).catch(() => {
    // The mounted query retains its error and offers the ordinary retry control.
  });
}
