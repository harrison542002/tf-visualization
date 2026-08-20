/**
 * Decodes Terraform's cty type JSON into a {@link FieldType}.
 *
 * Provider schemas encode attribute types as either a bare string (`"string"`) or a nested
 * array (`["list","string"]`, `["object",{...}]`). Only the shapes the editor can actually
 * render are accepted; everything else is reported so the caller can count what was skipped
 * rather than silently dropping it.
 */

import type { FieldType } from "@/lib/providers/types";

/** A cty type as it appears in `terraform providers schema -json`. */
export type CtyType = unknown;

export type CtyDecision =
  | { readonly ok: true; readonly type: FieldType }
  | { readonly ok: false; readonly reason: string };

/** Human-readable name for a cty type, used for skip statistics. */
export function describeCty(type: CtyType): string {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const [kind, inner] = type as readonly unknown[];
    if (typeof kind !== "string") return "unknown";
    if (inner === undefined) return kind;
    // The second element of an object or tuple is a field map, not a type, so recursing into
    // it would produce noise rather than a name.
    if (kind === "object" || kind === "tuple") return kind;
    return `${kind}(${describeCty(inner)})`;
  }
  return "unknown";
}

export function decodeCty(type: CtyType): CtyDecision {
  if (type === "string") return { ok: true, type: "string" };
  if (type === "number") return { ok: true, type: "number" };
  if (type === "bool") return { ok: true, type: "bool" };

  if (Array.isArray(type)) {
    const [kind, inner] = type as readonly unknown[];
    // A list or set of plain strings is the one collection the panel can edit today.
    if ((kind === "list" || kind === "set") && inner === "string") {
      return { ok: true, type: "stringList" };
    }
  }

  return { ok: false, reason: describeCty(type) };
}
