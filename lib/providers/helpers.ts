import type { TfAttribute } from "@/lib/terraform/ir";

/**
 * Drops attributes that a {@link ResourceSchema.build} override is going to place inside a
 * nested block instead.
 *
 * The default builder emits every field and slot as a flat attribute. A resource whose
 * Terraform schema nests some of them — `google_compute_firewall`'s `allow`, say — starts
 * from that flat list and relocates the pieces it owns.
 */
export function omitAttributes(
  attributes: readonly TfAttribute[],
  keys: readonly string[],
): readonly TfAttribute[] {
  const excluded = new Set(keys);
  return attributes.filter((attribute) => !excluded.has(attribute.key));
}
