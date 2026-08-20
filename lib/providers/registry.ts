/**
 * Central lookup for provider catalogs.
 *
 * Every provider is a bundle of `ResourceSchema` data. GCP is hand-written; AWS and Azure are
 * generated from their provider schemas by `npm run codegen` and curated through
 * `codegen/overrides/`. Adding a provider touches nothing in the canvas, compiler or
 * serializers.
 */

import { awsProvider } from "./aws";
import { getCachedSchema, primeCache } from "./catalog";
import { azureProvider } from "./azure";
import { gcpProvider } from "./gcp";
import type { ProviderDefinition, ProviderId, ResourceSchema } from "./types";

export const providers: readonly ProviderDefinition[] = [gcpProvider, awsProvider, azureProvider];

// Tier-1 resources are bundled, so seed the cache with them: they must never cost a fetch,
// and this keeps one lookup path for bundled and lazily-loaded resources alike.
for (const provider of providers) primeCache(provider.id, provider.resources);

export function getProvider(id: ProviderId): ProviderDefinition {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

/**
 * Returns the schema for a resource type, or `undefined` if it is neither bundled nor loaded.
 *
 * Synchronous by design. The store awaits `loadResourceSchema` before creating a node, so
 * every resource on the canvas is already cached by the time anything renders or compiles.
 */
export function findResourceSchema(
  providerId: ProviderId,
  resourceType: string,
): ResourceSchema | undefined {
  return getCachedSchema(providerId, resourceType);
}

/** Same as {@link findResourceSchema}, but throws — for call sites where absence is a bug. */
export function getResourceSchema(
  providerId: ProviderId,
  resourceType: string,
): ResourceSchema {
  const schema = findResourceSchema(providerId, resourceType);
  if (!schema) {
    throw new Error(`Unknown resource type for provider ${providerId}: ${resourceType}`);
  }
  return schema;
}
