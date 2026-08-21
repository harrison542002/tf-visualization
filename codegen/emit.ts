/**
 * Renders {@link ResourceSchema} data as TypeScript source.
 *
 * Emitting `.ts` rather than JSON keeps the generated catalog type-checked by the same compiler
 * as the hand-written one: if a change to `ResourceSchema` makes generated output invalid,
 * `tsc` says so at build time instead of the app failing at runtime.
 */

import type { ConnectionSlot, FieldSchema, ResourceSchema } from "@/lib/providers/types";

const INDENT = "  ";

/** Identifiers that can appear unquoted as object keys. */
const BARE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const quote = (value: string): string => JSON.stringify(value);

const key = (name: string): string => (BARE_KEY.test(name) ? name : quote(name));

function renderStringArray(values: readonly string[], depth: number): string {
  if (values.length === 0) return "[]";
  const inline = `[${values.map(quote).join(", ")}]`;
  if (inline.length <= 80) return inline;

  const pad = INDENT.repeat(depth + 1);
  return `[\n${values.map((value) => `${pad}${quote(value)}`).join(",\n")}\n${INDENT.repeat(depth)}]`;
}

function renderField(field: FieldSchema, depth: number): string {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const lines: string[] = [];

  lines.push(`${inner}${key("key")}: ${quote(field.key)},`);
  lines.push(`${inner}${key("label")}: ${quote(field.label)},`);
  lines.push(`${inner}${key("type")}: ${quote(field.type)},`);
  lines.push(`${inner}${key("required")}: ${field.required},`);

  if (field.nesting !== undefined) {
    lines.push(`${inner}${key("nesting")}: ${quote(field.nesting)},`);
  }
  if (field.maxItems !== undefined) {
    lines.push(`${inner}${key("maxItems")}: ${field.maxItems},`);
  }
  if (field.options !== undefined) {
    lines.push(`${inner}${key("options")}: ${renderStringArray(field.options, depth + 1)},`);
  }
  if (field.defaultValue !== undefined) {
    lines.push(`${inner}${key("defaultValue")}: ${JSON.stringify(field.defaultValue)},`);
  }
  if (field.placeholder !== undefined) {
    lines.push(`${inner}${key("placeholder")}: ${quote(field.placeholder)},`);
  }
  if (field.help !== undefined) {
    lines.push(`${inner}${key("help")}: ${quote(field.help)},`);
  }
  if (field.fields !== undefined) {
    lines.push(`${inner}${key("fields")}: ${renderFields(field.fields, depth + 1)},`);
  }

  return `{\n${lines.join("\n")}\n${pad}}`;
}

function renderFields(fields: readonly FieldSchema[], depth: number): string {
  if (fields.length === 0) return "[]";
  const pad = INDENT.repeat(depth + 1);
  const rendered = fields.map((field) => `${pad}${renderField(field, depth + 1)}`);
  return `[\n${rendered.join(",\n")}\n${INDENT.repeat(depth)}]`;
}

function renderSlot(slot: ConnectionSlot, depth: number): string {
  const pad = INDENT.repeat(depth);
  const inner = INDENT.repeat(depth + 1);
  const lines: string[] = [
    `${inner}id: ${quote(slot.id)},`,
    `${inner}label: ${quote(slot.label)},`,
    `${inner}targetType: ${quote(slot.targetType)},`,
    `${inner}targetAttribute: ${quote(slot.targetAttribute)},`,
    `${inner}cardinality: ${quote(slot.cardinality)},`,
    `${inner}required: ${slot.required},`,
  ];
  if (slot.attribute !== undefined) {
    lines.push(`${inner}attribute: ${quote(slot.attribute)},`);
  }
  if (slot.path !== undefined) {
    lines.push(`${inner}path: ${renderStringArray(slot.path, depth + 1)},`);
  }
  return `{\n${lines.join("\n")}\n${pad}}`;
}

function renderSlots(slots: readonly ConnectionSlot[], depth: number): string {
  if (slots.length === 0) return "[]";
  const pad = INDENT.repeat(depth + 1);
  const rendered = slots.map((slot) => `${pad}${renderSlot(slot, depth + 1)}`);
  return `[\n${rendered.join(",\n")}\n${INDENT.repeat(depth)}]`;
}

function renderResource(resource: ResourceSchema): string {
  const lines: string[] = [];
  lines.push(`${INDENT}{`);
  lines.push(`${INDENT.repeat(2)}type: ${quote(resource.type)},`);
  lines.push(`${INDENT.repeat(2)}displayName: ${quote(resource.displayName)},`);
  lines.push(`${INDENT.repeat(2)}category: ${quote(resource.category)},`);
  lines.push(`${INDENT.repeat(2)}description: ${quote(resource.description)},`);
  lines.push(`${INDENT.repeat(2)}fields: ${renderFields(resource.fields, 2)},`);
  lines.push(`${INDENT.repeat(2)}slots: ${renderSlots(resource.slots, 2)},`);
  lines.push(`${INDENT}}`);
  return lines.join("\n");
}

export interface EmitOptions {
  /** Provider display name, used in the file header. */
  readonly providerName: string;
  /** Provider version the schema was dumped from, so the output records its provenance. */
  readonly providerVersion: string;
  /** Import specifier for the schema types. */
  readonly typesImport?: string;
  /** Name of the exported array. */
  readonly exportName?: string;
  /** Whether curated overrides were applied, which changes what the header should claim. */
  readonly curated?: boolean;
  /**
   * Size of the provider's full catalog. Emitted as a constant beside the resource array, which
   * for a `--tier1` run holds only the curated subset of that catalog.
   */
  readonly catalogSize?: number;
  /** Name of the exported catalog-size constant. */
  readonly catalogSizeExportName?: string;
}

/** Renders a complete TypeScript module. */
export function emitResourceModule(
  resources: readonly ResourceSchema[],
  options: EmitOptions,
): string {
  const typesImport = options.typesImport ?? "@/lib/providers/types";
  const exportName = options.exportName ?? "generatedResources";
  const sizeExportName = options.catalogSizeExportName ?? "catalogSize";
  const slotCount = resources.reduce((sum, resource) => sum + resource.slots.length, 0);

  const provenance = options.curated
    ? `// Fields come from the provider schema. The ${slotCount} connection slots, display names
// and defaults come from the curated overrides — provider schemas carry no reference
// information, so those cannot be derived.`
    : `// \`slots\` is empty on every resource: provider schemas carry no reference information,
// so connections cannot be derived from them. They are added by the curation pass.`;

  const catalogSizeSource =
    options.catalogSize === undefined
      ? ""
      : `
/** Resources in the provider's full catalog, of which the array above is the bundled part. */
export const ${sizeExportName} = ${options.catalogSize};
`;

  return `// Generated by \`npm run codegen\` — do not edit by hand.
//
// Source: ${options.providerName} provider ${options.providerVersion}
// Resources: ${resources.length}
//
${provenance}

import type { ResourceSchema } from "${typesImport}";

export const ${exportName}: readonly ResourceSchema[] = [
${resources.map(renderResource).join(",\n")},
];
${catalogSizeSource}`;
}
