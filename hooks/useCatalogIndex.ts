"use client";

import { useEffect, useState } from "react";

import { loadCatalogIndex, type CatalogIndexEntry } from "@/lib/providers/catalog";
import { getProvider } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/providers/types";

export interface CatalogIndexState {
  /**
   * Everything searchable right now: the provider's full index once it has arrived, and the
   * bundled tier-1 set until then, so a picker is never empty while a fetch is in flight.
   */
  readonly entries: readonly CatalogIndexEntry[];
  /** True once the full index is loaded, so callers can say how much they are searching. */
  readonly complete: boolean;
  /** Set when the index could not be fetched. The curated set still works without it. */
  readonly error: string | null;
}

const NO_ENTRIES: readonly CatalogIndexEntry[] = [];

/**
 * Curated schemas carry more than an index row; this narrows them to the searchable shape.
 *
 * Cached per provider so the array is referentially stable: it feeds the callers' search,
 * and a fresh array on every render would defeat the compiler's memoisation of it.
 */
const curatedEntries = new Map<ProviderId, readonly CatalogIndexEntry[]>();

function asEntries(providerId: ProviderId): readonly CatalogIndexEntry[] {
  const cached = curatedEntries.get(providerId);
  if (cached) return cached;

  const entries = getProvider(providerId).resources.map((resource) => ({
    type: resource.type,
    displayName: resource.displayName,
    category: resource.category,
    description: resource.description,
    curated: true,
  }));
  curatedEntries.set(providerId, entries);
  return entries;
}

/**
 * Loads a provider's catalog index, once per provider per session.
 *
 * Shared by the palette and the canvas resource search so the two search the same rows and
 * degrade the same way when the index cannot be fetched.
 */
export function useCatalogIndex(providerId: ProviderId | null): CatalogIndexState {
  // Held together with the provider it belongs to, and matched below, so switching provider
  // does not need a synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{
    providerId: ProviderId;
    entries: readonly CatalogIndexEntry[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!providerId) return;

    let cancelled = false;
    loadCatalogIndex(providerId)
      .then((entries) => {
        if (!cancelled) setLoaded({ providerId, entries, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded({
            providerId,
            entries: [],
            error: "Full catalog unavailable — showing curated resources only.",
          });
        }
        console.error("catalog index failed to load", cause);
      });

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (!providerId) return { entries: NO_ENTRIES, complete: false, error: null };

  const current = loaded?.providerId === providerId ? loaded : null;
  if (!current || current.entries.length === 0) {
    return {
      entries: asEntries(providerId),
      complete: false,
      error: current?.error ?? null,
    };
  }

  return { entries: current.entries, complete: true, error: null };
}
