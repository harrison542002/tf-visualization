/**
 * Lazily-loaded resource catalog.
 *
 * A provider has ~1300 resources and several megabytes of schema, far too much to bundle. Only
 * the curated tier-1 set ships in the JavaScript; everything else is fetched from
 * `public/catalog/` on demand:
 *
 * - `index.json` — one small row per resource, fetched once when a provider is chosen. Enough
 *   to search and render the palette.
 * - `r/<type>.json` — the full schema, fetched the first time a resource is used.
 *
 * Loaded schemas go into a module-level cache that {@link findResourceSchema} reads
 * **synchronously**. That is the design's load-bearing detail: the store awaits the fetch
 * before it creates a node, so by the time anything renders or compiles, the schema is already
 * in the cache and the rest of the app never has to know loading happened.
 */

import type { ProviderId, ResourceSchema } from "./types";

export interface CatalogIndexEntry {
  readonly type: string;
  readonly displayName: string;
  readonly category: string;
  readonly description: string;
  /** Has hand-curated connections. The palette surfaces these first. */
  readonly curated: boolean;
}

interface CatalogManifest {
  readonly provider: string;
  readonly providerVersion: string;
  readonly generatedResources: number;
  readonly entries: readonly CatalogIndexEntry[];
}

const schemaCache = new Map<string, ResourceSchema>();
const indexCache = new Map<ProviderId, readonly CatalogIndexEntry[]>();
/** In-flight requests, so dropping five of the same resource fetches once. */
const pending = new Map<string, Promise<ResourceSchema | undefined>>();

const cacheKey = (providerId: ProviderId, type: string): string => `${providerId}:${type}`;

/** Reads an already-loaded schema. Returns `undefined` if it has not been fetched yet. */
export function getCachedSchema(providerId: ProviderId, type: string): ResourceSchema | undefined {
  return schemaCache.get(cacheKey(providerId, type));
}

/** Seeds the cache with eagerly-bundled resources, so tier-1 never needs a request. */
export function primeCache(providerId: ProviderId, resources: readonly ResourceSchema[]): void {
  for (const resource of resources) {
    schemaCache.set(cacheKey(providerId, resource.type), resource);
  }
}

/** Fetches the palette index for a provider. Cached for the session. */
export async function loadCatalogIndex(
  providerId: ProviderId,
): Promise<readonly CatalogIndexEntry[]> {
  const cached = indexCache.get(providerId);
  if (cached) return cached;

  const response = await fetch(`/catalog/${providerId}/index.json`);
  if (!response.ok) {
    throw new Error(`catalog index for ${providerId} returned ${response.status}`);
  }

  const manifest = (await response.json()) as CatalogManifest;
  indexCache.set(providerId, manifest.entries);
  return manifest.entries;
}

/**
 * Fetches one resource schema, or returns `undefined` when the provider has no such resource.
 *
 * A missing resource is a normal outcome — a stale link or a type removed in a newer provider
 * version — so it resolves rather than throwing.
 */
export async function loadResourceSchema(
  providerId: ProviderId,
  type: string,
): Promise<ResourceSchema | undefined> {
  const key = cacheKey(providerId, type);

  const cached = schemaCache.get(key);
  if (cached) return cached;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    const response = await fetch(`/catalog/${providerId}/r/${type}.json`);
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`catalog entry ${providerId}/${type} returned ${response.status}`);
    }

    const schema = (await response.json()) as ResourceSchema;
    schemaCache.set(key, schema);
    return schema;
  })();

  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

/** Clears everything. Only used by tests. */
export function resetCatalogCache(): void {
  schemaCache.clear();
  indexCache.clear();
  pending.clear();
}
