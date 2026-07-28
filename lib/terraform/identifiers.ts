/**
 * Rules for Terraform local names — the `main` in `resource "google_compute_network" "main"`.
 */

/** Terraform identifiers start with a letter or underscore, then allow digits and hyphens. */
export const LOCAL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isValidLocalName(name: string): boolean {
  return LOCAL_NAME_PATTERN.test(name);
}

/**
 * Coerces arbitrary text into a legal local name.
 *
 * Used when a node is dropped on the canvas, so the user starts from something valid and
 * editable rather than from an error.
 */
export function sanitizeLocalName(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (cleaned.length === 0) return "resource";
  // A leading digit is the one case cleaning cannot fix by removal alone.
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

/**
 * Appends a numeric suffix until the name is unused, e.g. `web`, `web_2`, `web_3`.
 *
 * Uniqueness in Terraform is per resource type, so `taken` should hold only the names already
 * used by the same type.
 */
export function uniqueLocalName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const sanitized = sanitizeLocalName(base);
  if (!used.has(sanitized)) return sanitized;

  let suffix = 2;
  while (used.has(`${sanitized}_${suffix}`)) suffix += 1;
  return `${sanitized}_${suffix}`;
}
