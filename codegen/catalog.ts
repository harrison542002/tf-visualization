/**
 * Emits a lazily-loadable catalog.
 *
 * A provider's full converted catalog is several megabytes of TypeScript
 *
 * - **index.json**, one small entry per resource, enough to search and render the palette.
 * - **r/<type>.json**, the full schema for one resource, fetched only when it is dropped.
 *
 * Curated overrides are applied on top of conversion, so tier-1 resources keep their slots,
 * defaults and display names while the long tail still gets everything the schema knows.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ResourceSchema } from "@/lib/providers/types";
import { inferProviderConnections, RULES_BY_PROVIDER, type InferenceStats } from "./infer";
import { applyOverrides, type ProviderOverrides } from "./overrides";

/** One palette-sized row. Deliberately tiny: this file holds every resource a provider has. */
export interface CatalogIndexEntry {
  readonly type: string;
  readonly displayName: string;
  readonly category: string;
  readonly description: string;
  /** True when the resource has curated connections, so the palette can mark it. */
  readonly curated: boolean;
  /** Number of connection points, curated or inferred. Zero means it cannot be wired. */
  readonly slots: number;
}

export interface CatalogManifest {
  readonly provider: string;
  readonly providerVersion: string;
  readonly generatedResources: number;
  readonly entries: readonly CatalogIndexEntry[];
}

export interface EmitCatalogOptions {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly outDir: string;
  readonly overrides?: ProviderOverrides;
}

export interface EmitCatalogResult {
  readonly inference?: InferenceStats;
  readonly total: number;
  readonly curated: number;
  readonly indexBytes: number;
  readonly resourceBytes: number;
}

/**
 * Merges curated resources over the converted ones.
 *
 * The curated version wins where both exist, so a tier-1 resource keeps its hand-written slots
 * rather than the bare conversion.
 */
function mergeCurated(
  converted: readonly ResourceSchema[],
  overrides: ProviderOverrides | undefined,
): { readonly resources: readonly ResourceSchema[]; readonly curatedTypes: ReadonlySet<string> } {
  if (!overrides) return { resources: converted, curatedTypes: new Set() };

  const { resources: curated } = applyOverrides(converted, overrides);
  const byType = new Map(converted.map((resource) => [resource.type, resource]));
  for (const resource of curated) byType.set(resource.type, resource);

  return {
    resources: [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)),
    curatedTypes: new Set(curated.map((resource) => resource.type)),
  };
}

export function emitCatalog(
  converted: readonly ResourceSchema[],
  options: EmitCatalogOptions,
): EmitCatalogResult {
  // Inference first, so curated overrides sit on top of it rather than being overwritten.
  const rules = RULES_BY_PROVIDER[options.providerId];
  const inferred = rules ? inferProviderConnections(converted, rules) : undefined;
  const { resources, curatedTypes } = mergeCurated(inferred?.resources ?? converted, options.overrides);

  const providerDir = join(options.outDir, options.providerId);
  const resourceDir = join(providerDir, "r");

  // Wipe first: a resource removed from a newer provider version must not linger.
  rmSync(providerDir, { recursive: true, force: true });
  mkdirSync(resourceDir, { recursive: true });

  let resourceBytes = 0;
  const entries: CatalogIndexEntry[] = [];

  for (const resource of resources) {
    const body = JSON.stringify(resource);
    writeFileSync(join(resourceDir, `${resource.type}.json`), body);
    resourceBytes += body.length;

    entries.push({
      type: resource.type,
      displayName: resource.displayName,
      category: resource.category,
      description: resource.description,
      curated: curatedTypes.has(resource.type),
      slots: resource.slots.length,
    });
  }

  const manifest: CatalogManifest = {
    provider: options.providerId,
    providerVersion: options.providerVersion,
    generatedResources: entries.length,
    entries,
  };
  const indexBody = JSON.stringify(manifest);
  writeFileSync(join(providerDir, "index.json"), indexBody);

  return {
    ...(inferred ? { inference: inferred.stats } : {}),
    total: entries.length,
    curated: curatedTypes.size,
    indexBytes: indexBody.length,
    resourceBytes,
  };
}
