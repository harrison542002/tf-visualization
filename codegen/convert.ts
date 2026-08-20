/**
 * Converts `terraform providers schema -json` into {@link ResourceSchema} data.
 *
 * Deliberately does *not* infer connection slots. Provider schemas are relationship-blind
 * `google_compute_subnetwork.network` is described only as a required string, with nothing
 * naming `google_compute_network` — so every generated resource comes out with `slots: []`.
 * Recovering references is a separate enrichment pass; the diff report quantifies how much of
 * it is actually needed.
 */

import type { BlockNesting, FieldSchema, ResourceSchema } from "@/lib/providers/types";
import { decodeCty, describeCty, type CtyType } from "./cty";
import { recoverEnumOptions } from "./enums";
import { categoryFor, displayNameFor, labelFor } from "./naming";

// --- Shape of the provider schema JSON ---------------------------------------------------

interface RawAttribute {
  readonly type: CtyType;
  readonly description?: string;
  readonly required?: boolean;
  readonly optional?: boolean;
  readonly computed?: boolean;
  readonly deprecated?: boolean;
}

interface RawBlockType {
  readonly nesting_mode: string;
  readonly block?: RawBlock;
  readonly min_items?: number;
  readonly max_items?: number;
}

interface RawBlock {
  readonly attributes?: Record<string, RawAttribute>;
  readonly block_types?: Record<string, RawBlockType>;
  readonly description?: string;
  readonly deprecated?: boolean;
}

interface RawResource {
  readonly block: RawBlock;
}

export interface ProviderSchemaJson {
  readonly provider_schemas: Record<
    string,
    {
      readonly resource_schemas: Record<string, RawResource>;
      readonly data_source_schemas?: Record<string, unknown>;
    }
  >;
}

// --- Options and reporting ---------------------------------------------------------------

export interface ConvertOptions {
  /** Resource type prefix for the provider, e.g. `google_`. */
  readonly providerPrefix: string;
  /** Restricts which resource types are emitted. Defaults to all. */
  readonly include?: (resourceType: string) => boolean;
  /** Drops deprecated attributes and resources. Defaults to true. */
  readonly skipDeprecated?: boolean;
  /** Caps how deep nested blocks are followed, guarding against self-referential schemas. */
  readonly maxDepth?: number;
  /**
   * Caps how many fields one resource may expand to.
   *
   * A few schemas are recursive in practice — `aws_wafv2_web_acl_rule` nests AND/OR/NOT
   * statements and expands to 42290 fields on its own, and ten AWS resources account for 81%
   * of the provider's entire field count. Without a budget those few make the catalog an order
   * of magnitude larger than everything else combined.
   */
  readonly maxFieldsPerResource?: number;
}

export interface ConvertStats {
  readonly resourcesInSchema: number;
  readonly resourcesEmitted: number;
  readonly fieldsEmitted: number;
  /** Read-only attributes, which are outputs and must never reach the properties panel. */
  readonly computedSkipped: number;
  readonly deprecatedSkipped: number;
  readonly depthTruncated: number;
  /** Nested blocks dropped because their resource hit the field budget. */
  readonly budgetTruncated: number;
  /** Resources that hit the field budget, named so the truncation is never silent. */
  readonly budgetTruncatedResources: readonly string[];
  /** String attributes promoted to enums by parsing their description. */
  readonly enumsRecovered: number;
  /** cty types the editor cannot render yet, counted by shape. */
  readonly unsupportedTypes: Record<string, number>;
}

export interface ConvertResult {
  readonly resources: readonly ResourceSchema[];
  readonly stats: ConvertStats;
}

interface Counters {
  fieldsEmitted: number;
  /** Reset per resource, so the budget applies to one resource at a time. */
  fieldsInResource: number;
  budgetTruncated: number;
  budgetTruncatedResources: string[];
  computedSkipped: number;
  deprecatedSkipped: number;
  depthTruncated: number;
  enumsRecovered: number;
  unsupportedTypes: Record<string, number>;
}

const NESTING: Record<string, BlockNesting> = {
  single: "single",
  group: "single",
  list: "list",
  set: "set",
  map: "map",
};

/** Provider descriptions run to paragraphs; the panel wants one line. */
function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length === 0) return undefined;

  const stop = flattened.indexOf(". ");
  const sentence = stop === -1 ? flattened : flattened.slice(0, stop + 1);
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
}

function convertAttributes(
  attributes: Record<string, RawAttribute>,
  options: ConvertOptions,
  counters: Counters,
): FieldSchema[] {
  const fields: FieldSchema[] = [];

  for (const [key, attribute] of Object.entries(attributes)) {
    if (options.skipDeprecated !== false && attribute.deprecated) {
      counters.deprecatedSkipped += 1;
      continue;
    }

    // `computed` with neither `optional` nor `required` is a value the provider fills in —
    // an output, not an input, and it must never reach the properties panel.
    if (attribute.computed && !attribute.optional && !attribute.required) {
      counters.computedSkipped += 1;
      continue;
    }

    const decoded = decodeCty(attribute.type);
    if (!decoded.ok) {
      const shape = describeCty(attribute.type);
      counters.unsupportedTypes[shape] = (counters.unsupportedTypes[shape] ?? 0) + 1;
      continue;
    }

    const help = firstSentence(attribute.description);
    // Schemas have no enum concept, but descriptions often spell the constraint out. A string
    // with recoverable options becomes a dropdown rather than a free-text box.
    const enumOptions =
      decoded.type === "string" ? recoverEnumOptions(attribute.description) : undefined;
    if (enumOptions) counters.enumsRecovered += 1;

    fields.push({
      key,
      label: labelFor(key),
      type: enumOptions ? "enum" : decoded.type,
      required: attribute.required === true,
      ...(enumOptions ? { options: enumOptions } : {}),
      ...(help ? { help } : {}),
    });
    counters.fieldsEmitted += 1;
    counters.fieldsInResource += 1;
  }

  return fields;
}

function convertBlock(
  block: RawBlock,
  options: ConvertOptions,
  counters: Counters,
  depth: number,
): FieldSchema[] {
  const fields = convertAttributes(block.attributes ?? {}, options, counters);
  // Measured maximums: aws 14, google 10, azurerm 5. The cap exists only to stop a
  // self-referential schema recursing forever, so it sits above the deepest real nesting.
  const maxDepth = options.maxDepth ?? 16;

  for (const [key, blockType] of Object.entries(block.block_types ?? {})) {
    if (options.skipDeprecated !== false && blockType.block?.deprecated) {
      counters.deprecatedSkipped += 1;
      continue;
    }

    // Some schemas nest very deeply, and a few are self-referential. Stop rather than explode.
    if (depth >= maxDepth) {
      counters.depthTruncated += 1;
      continue;
    }

    if (counters.fieldsInResource >= (options.maxFieldsPerResource ?? 2000)) {
      counters.budgetTruncated += 1;
      continue;
    }

    const nesting = NESTING[blockType.nesting_mode] ?? "single";
    const children = blockType.block
      ? convertBlock(blockType.block, options, counters, depth + 1)
      : [];
    const help = firstSentence(blockType.block?.description);

    fields.push({
      key,
      label: labelFor(key),
      type: "block",
      nesting,
      // Terraform expresses "this block must appear" as a minimum repetition count.
      required: (blockType.min_items ?? 0) > 0,
      fields: children,
      ...(blockType.max_items !== undefined ? { maxItems: blockType.max_items } : {}),
      ...(help ? { help } : {}),
    });
    counters.fieldsEmitted += 1;
    counters.fieldsInResource += 1;
  }

  return fields;
}

/** Picks the single provider entry out of a schema dump. */
export function selectProviderSchema(schema: ProviderSchemaJson) {
  const keys = Object.keys(schema.provider_schemas);
  const [key] = keys;
  if (!key) throw new Error("schema.json contains no provider_schemas");
  if (keys.length > 1) {
    throw new Error(`expected one provider, found ${keys.length}: ${keys.join(", ")}`);
  }

  const entry = schema.provider_schemas[key];
  if (!entry) throw new Error(`provider_schemas has no entry for ${key}`);
  return { key, entry };
}

export function convertProviderSchema(
  schema: ProviderSchemaJson,
  options: ConvertOptions,
): ConvertResult {
  const { entry } = selectProviderSchema(schema);
  const counters: Counters = {
    fieldsEmitted: 0,
    fieldsInResource: 0,
    budgetTruncated: 0,
    budgetTruncatedResources: [],
    computedSkipped: 0,
    deprecatedSkipped: 0,
    depthTruncated: 0,
    enumsRecovered: 0,
    unsupportedTypes: {},
  };

  const all = Object.entries(entry.resource_schemas);
  const resources: ResourceSchema[] = [];

  for (const [type, resource] of all) {
    if (options.include && !options.include(type)) continue;
    if (options.skipDeprecated !== false && resource.block.deprecated) {
      counters.deprecatedSkipped += 1;
      continue;
    }

    counters.fieldsInResource = 0;
    const budgetBefore = counters.budgetTruncated;

    const description = firstSentence(resource.block.description);
    resources.push({
      type,
      displayName: displayNameFor(type, options.providerPrefix),
      category: categoryFor(type),
      description: description ?? "",
      fields: convertBlock(resource.block, options, counters, 0),
      // Provider schemas carry no reference information; enrichment fills these in later.
      slots: [],
    });

    if (counters.budgetTruncated > budgetBefore) counters.budgetTruncatedResources.push(type);
  }

  // Stable ordering, so regenerating against a new provider version diffs readably.
  resources.sort((a, b) => a.type.localeCompare(b.type));

  return {
    resources,
    stats: {
      resourcesInSchema: all.length,
      resourcesEmitted: resources.length,
      fieldsEmitted: counters.fieldsEmitted,
      computedSkipped: counters.computedSkipped,
      deprecatedSkipped: counters.deprecatedSkipped,
      depthTruncated: counters.depthTruncated,
      budgetTruncated: counters.budgetTruncated,
      budgetTruncatedResources: counters.budgetTruncatedResources,
      enumsRecovered: counters.enumsRecovered,
      unsupportedTypes: counters.unsupportedTypes,
    },
  };
}
