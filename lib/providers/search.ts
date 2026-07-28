import type { ResourceSchema } from "./types";

/**
 * Filters the palette.
 *
 * Every whitespace-separated term must match somewhere, which makes narrowing feel natural
 * ("compute net" finds the VPC network). Matching the Terraform type as well as the display
 * name matters: people who know the provider tend to search for `google_compute_subnetwork`
 * rather than "Subnetwork".
 */
export function filterResources(
  resources: readonly ResourceSchema[],
  query: string,
): readonly ResourceSchema[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return resources;

  return resources.filter((resource) => {
    const haystack =
      `${resource.displayName} ${resource.type} ${resource.description} ${resource.category}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
