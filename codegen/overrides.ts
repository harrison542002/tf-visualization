/**
 * The curation layer.
 *
 * Conversion produces everything a provider schema contains, which is fields and nothing else.
 * This is where the things a schema cannot express get added back: connection slots above all,
 * plus defaults, display names and the tier-1 selection.
 *
 * Overrides are hand-written and committed, so regenerating against a new provider version
 * produces a reviewable diff rather than silently changing the catalog.
 */

import type {
  ConnectionSlot,
  FieldSchema,
  ResourceCategory,
  ResourceSchema,
} from "@/lib/providers/types";

/** Metadata for one field, keyed by dotted path (`allow.protocol`) to reach nested blocks. */
export interface FieldOverride {
  readonly label?: string;
  readonly help?: string;
  readonly placeholder?: string;
  readonly defaultValue?: FieldSchema["defaultValue"];
  readonly options?: readonly string[];
  /** Overrides the schema's own answer, for fields the provider marks optional but users must set. */
  readonly required?: boolean;
}

export interface ResourceOverride {
  readonly displayName?: string;
  readonly category?: ResourceCategory;
  readonly description?: string;
  /** Connections, which no provider schema carries. */
  readonly slots?: readonly ConnectionSlot[];
  /** Keyed by dotted field path. */
  readonly fields?: Readonly<Record<string, FieldOverride>>;
  /**
   * Restricts the generated field list to these paths, in this order.
   *
   * Real resources carry far more attributes than anyone wants in a palette — the AWS instance
   * has over a hundred. Listing the useful ones keeps tier-1 usable without hand-writing them.
   */
  readonly keepFields?: readonly string[];
}

export interface ProviderOverrides {
  /** Resource types that ship in the palette, in display order. */
  readonly tier1: readonly string[];
  readonly resources?: Readonly<Record<string, ResourceOverride>>;
}

/** A node in the tree being rebuilt from the requested paths. */
interface KeepNode {
  readonly source: FieldSchema;
  readonly children: Map<string, KeepNode>;
}

/**
 * Picks the fields named in `keepFields`, preserving that order and following nested paths.
 *
 * Listing a block without listing any of its children keeps the whole block, which is usually
 * what is meant. An empty `keepFields` keeps nothing — useful for resources whose only
 * interesting content is their connections.
 */
function selectFields(
  fields: readonly FieldSchema[],
  keep: readonly string[],
): readonly FieldSchema[] {
  const byPath = new Map<string, FieldSchema>();
  const index = (list: readonly FieldSchema[], prefix: string): void => {
    for (const field of list) {
      const path = prefix ? `${prefix}.${field.key}` : field.key;
      byPath.set(path, field);
      if (field.fields) index(field.fields, path);
    }
  };
  index(fields, "");

  const roots = new Map<string, KeepNode>();

  for (const path of keep) {
    let level = roots;
    let prefix = "";

    for (const segment of path.split(".")) {
      prefix = prefix ? `${prefix}.${segment}` : segment;
      const source = byPath.get(prefix);
      if (!source) break;

      let node = level.get(segment);
      if (!node) {
        node = { source, children: new Map() };
        level.set(segment, node);
      }
      level = node.children;
    }
  }

  const materialise = (level: Map<string, KeepNode>): readonly FieldSchema[] =>
    [...level.values()].map((node) =>
      node.children.size === 0
        ? node.source
        : { ...node.source, fields: materialise(node.children) },
    );

  return materialise(roots);
}

/** Applies field-level overrides in place across the tree, matching on dotted path. */
function applyFieldOverrides(
  fields: readonly FieldSchema[],
  overrides: Readonly<Record<string, FieldOverride>>,
  prefix = "",
): readonly FieldSchema[] {
  return fields.map((field) => {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    const override = overrides[path];
    const children = field.fields
      ? applyFieldOverrides(field.fields, overrides, path)
      : undefined;

    return {
      ...field,
      ...(override?.label !== undefined ? { label: override.label } : {}),
      ...(override?.help !== undefined ? { help: override.help } : {}),
      ...(override?.placeholder !== undefined ? { placeholder: override.placeholder } : {}),
      ...(override?.defaultValue !== undefined ? { defaultValue: override.defaultValue } : {}),
      ...(override?.options !== undefined
        ? { options: override.options, type: "enum" as const }
        : {}),
      ...(override?.required !== undefined ? { required: override.required } : {}),
      ...(children ? { fields: children } : {}),
    };
  });
}

export interface ApplyResult {
  readonly resources: readonly ResourceSchema[];
  /** Tier-1 entries the schema did not contain, which means a typo or a renamed resource. */
  readonly missing: readonly string[];
}

/**
 * Merges curated overrides onto generated resources and narrows to the tier-1 set.
 *
 * Output order follows `tier1`, so the palette order is a curation decision rather than
 * alphabetical accident.
 */
export function applyOverrides(
  generated: readonly ResourceSchema[],
  overrides: ProviderOverrides,
): ApplyResult {
  const byType = new Map(generated.map((resource) => [resource.type, resource]));
  const resources: ResourceSchema[] = [];
  const missing: string[] = [];

  for (const type of overrides.tier1) {
    const base = byType.get(type);
    if (!base) {
      missing.push(type);
      continue;
    }

    const override = overrides.resources?.[type] ?? {};
    const kept = override.keepFields ? selectFields(base.fields, override.keepFields) : base.fields;
    const fields = override.fields ? applyFieldOverrides(kept, override.fields) : kept;

    resources.push({
      ...base,
      ...(override.displayName ? { displayName: override.displayName } : {}),
      ...(override.category ? { category: override.category } : {}),
      ...(override.description ? { description: override.description } : {}),
      fields,
      slots: override.slots ?? [],
    });
  }

  return { resources, missing };
}
