/** The minimum a row needs to be searchable — satisfied by both a full schema and an index entry. */
export interface SearchableResource {
  readonly type: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
}

/**
 * Filters the palette.
 *
 * Every whitespace-separated term must match somewhere, which makes narrowing feel natural
 * ("compute net" finds the VPC network). Matching the Terraform type as well as the display
 * name matters: people who know the provider tend to search for `google_compute_subnetwork`
 * rather than "Subnetwork".
 */
export function filterResources<T extends SearchableResource>(
  resources: readonly T[],
  query: string,
): readonly T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return resources;

  return resources.filter((resource) => {
    const haystack =
      `${resource.displayName} ${resource.type} ${resource.description} ${resource.category}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** A row that can be ordered as well as matched. Index entries and curated schemas both fit. */
export interface RankableResource extends SearchableResource {
  /** Curated resources have connection slots, which makes them the more useful answer. */
  readonly curated: boolean;
}

/**
 * Filters and orders results for a resource picker.
 *
 * Curated resources come first because they can be connected to things; the rest fall back to
 * type order so the list is stable between keystrokes.
 */
export function searchResources<T extends RankableResource>(
  entries: readonly T[],
  query: string,
): readonly T[] {
  return [...filterResources(entries, query)].sort(
    (a, b) => Number(b.curated) - Number(a.curated) || a.type.localeCompare(b.type),
  );
}
