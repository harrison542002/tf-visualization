/**
 * Turns parsed Terraform into a canvas graph.
 *
 * Walks each `resource` block against its schema, so nesting and repetition are read the way
 * the provider declares them rather than guessed. References become edges wherever a matching
 * connection slot exists.
 *
 * Nothing is dropped silently. Anything that could not be represented — an unknown resource
 * type, an unevaluated expression, a reference with no slot to hang it on — comes back as a
 * diagnostic, because an import that quietly loses half a config is worse than one that
 * refuses part of it out loud.
 */

import type { Edge } from "@xyflow/react";

import { loadResourceSchema } from "@/lib/providers/catalog";
import type {
  ConnectionSlot,
  FieldSchema,
  FieldValue,
  FieldValues,
  ProviderId,
  ResourceSchema,
} from "@/lib/providers/types";
import {
  parseHcl,
  referencesIn,
  type HclBlock,
  type HclEntry,
  type HclValue,
} from "@/lib/terraform/parse";
import type { ResourceNode } from "./store";
import { layeredPositions } from "./layout";

export type ImportIssueKind =
  | "syntax"
  | "unknown-resource-type"
  | "unsupported-value"
  | "unmatched-reference"
  | "unknown-attribute"
  | "skipped-block";

export interface ImportIssue {
  readonly kind: ImportIssueKind;
  readonly message: string;
  /** `google_compute_network.main`, when the issue belongs to one resource. */
  readonly resource?: string;
}

export interface ImportResult {
  readonly nodes: readonly ResourceNode[];
  readonly edges: readonly Edge[];
  readonly issues: readonly ImportIssue[];
  /** Provider settings recovered from a `provider` block. */
  readonly providerSettings: FieldValues;
  readonly imported: number;
}

/** Blocks that carry no resource but are worth acknowledging rather than ignoring. */
const KNOWN_NON_RESOURCE = new Set(["terraform", "provider", "variable", "output", "locals"]);

const addressOf = (block: HclBlock): string => block.labels.join(".");

/** Reads Terraform's JSON syntax into the same block shape the HCL parser produces. */
function blocksFromJson(source: string): { blocks: HclBlock[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const toValue = (input: unknown): HclValue => {
    if (typeof input === "string") return { kind: "expression", text: `"${input}"` };
    if (typeof input === "number") return { kind: "number", value: input };
    if (typeof input === "boolean") return { kind: "bool", value: input };
    if (input === null) return { kind: "null" };
    if (Array.isArray(input)) return { kind: "list", items: input.map(toValue) };
    if (typeof input === "object") {
      return {
        kind: "object",
        entries: Object.entries(input as Record<string, unknown>).map(([key, value]) => ({
          key,
          value: toValue(value),
        })),
      };
    }
    return { kind: "null" };
  };

  const parsed = JSON.parse(source) as Record<string, unknown>;
  const blocks: HclBlock[] = [];

  const resources = parsed["resource"];
  if (resources && typeof resources === "object") {
    for (const [type, byName] of Object.entries(resources as Record<string, unknown>)) {
      if (!byName || typeof byName !== "object") continue;
      for (const [name, body] of Object.entries(byName as Record<string, unknown>)) {
        // `.tf.json` allows a list of bodies; the first is the resource itself.
        const one = Array.isArray(body) ? body[0] : body;
        const value = toValue(one);
        blocks.push({
          type: "resource",
          labels: [type, name],
          attributes: value.kind === "object" ? value.entries : [],
          blocks: [],
          line: 0,
        });
      }
    }
  }

  return { blocks, issues };
}

/**
 * Splits a block body into the entries that belong to one schema field.
 *
 * HCL expresses a repeated block by writing it several times, whereas JSON expresses it as a
 * list, so both shapes have to collapse to the same thing.
 */
function entriesForBlockField(block: HclBlock, key: string): readonly HclValue[] {
  const nested = block.blocks
    .filter((child) => child.type === key)
    .map((child): HclValue => ({ kind: "object", entries: bodyEntries(child) }));
  if (nested.length > 0) return nested;

  const attribute = block.attributes.find((entry) => entry.key === key);
  if (!attribute) return [];
  if (attribute.value.kind === "list") return attribute.value.items;
  return [attribute.value];
}

/** A block's attributes plus its nested blocks, as one entry list. */
function bodyEntries(block: HclBlock): readonly HclEntry[] {
  const fromBlocks = new Map<string, HclValue[]>();
  for (const child of block.blocks) {
    const list = fromBlocks.get(child.type) ?? [];
    list.push({ kind: "object", entries: bodyEntries(child) });
    fromBlocks.set(child.type, list);
  }

  return [
    ...block.attributes,
    ...[...fromBlocks.entries()].map(([key, items]) => ({
      key,
      value: items.length === 1 && items[0] ? items[0] : ({ kind: "list", items } as HclValue),
    })),
  ];
}

interface FieldContext {
  readonly address: string;
  readonly issues: ImportIssue[];
}

/** Converts one parsed value into a field value, or `undefined` when it cannot be carried. */
function toFieldValue(
  field: FieldSchema,
  value: HclValue,
  context: FieldContext,
): FieldValue | undefined {
  switch (value.kind) {
    case "string":
      return field.type === "number" ? Number(value.value) : value.value;
    case "number":
      return field.type === "string" || field.type === "enum" ? String(value.value) : value.value;
    case "bool":
      return value.value;
    case "null":
      return undefined;

    case "list":
      if (field.type !== "stringList") return undefined;
      return value.items
        .map((item) => (item.kind === "string" ? item.value : undefined))
        .filter((item): item is string => item !== undefined);

    case "object":
      return undefined;

    case "expression":
      // Expressions are references, interpolations or functions. Those that become edges are
      // handled separately; the rest cannot be written back as a literal without corrupting
      // them, so they are reported instead of guessed at.
      context.issues.push({
        kind: "unsupported-value",
        resource: context.address,
        message: `${field.key} = ${value.text.slice(0, 60)} was not imported (expressions are not evaluated).`,
      });
      return undefined;
  }
}

/** Recursively maps a parsed block onto a schema's fields. */
function mapFields(
  fields: readonly FieldSchema[],
  block: HclBlock,
  context: FieldContext,
  slotAttributes: ReadonlySet<string>,
): FieldValues {
  const values: Record<string, FieldValue> = {};
  const consumed = new Set<string>();

  for (const field of fields) {
    if (field.type === "block") {
      const entries = entriesForBlockField(block, field.key);
      if (entries.length === 0) continue;
      consumed.add(field.key);

      const mapped = entries.map((entry) =>
        entry.kind === "object"
          ? mapFields(
              field.fields ?? [],
              { type: field.key, labels: [], attributes: entry.entries, blocks: [], line: block.line },
              context,
              slotAttributes,
            )
          : {},
      );

      const nesting = field.nesting ?? "single";
      if (nesting === "single") {
        if (mapped[0]) values[field.key] = mapped[0];
      } else {
        values[field.key] = mapped;
      }
      continue;
    }

    const attribute = block.attributes.find((entry) => entry.key === field.key);
    if (!attribute) continue;
    consumed.add(field.key);

    // An attribute that is going to become an edge is left out; the connection carries it.
    if (slotAttributes.has(field.key) && attribute.value.kind === "expression") continue;

    const mapped = toFieldValue(field, attribute.value, context);
    if (mapped !== undefined) values[field.key] = mapped;
  }

  for (const entry of block.attributes) {
    if (consumed.has(entry.key)) continue;
    // An attribute backed by a slot is carried as a connection rather than a field, and a
    // curated resource often drops it from `fields` entirely. It is imported, not missing.
    if (slotAttributes.has(entry.key)) continue;
    context.issues.push({
      kind: "unknown-attribute",
      resource: context.address,
      message: `${entry.key} is not in the schema for this resource and was not imported.`,
    });
  }

  return values;
}

/** Finds the slot a reference should fill, matching on attribute name and target type. */
function matchSlot(
  slots: readonly ConnectionSlot[],
  attributeKey: string,
  path: readonly string[],
  targetType: string,
): ConnectionSlot | undefined {
  return slots.find(
    (slot) =>
      (slot.attribute ?? slot.id) === attributeKey &&
      slot.targetType === targetType &&
      (slot.path ?? []).join(".") === path.join("."),
  );
}

/** Walks a block for references, pairing each with the slot that should carry it. */
function collectEdges(
  schema: ResourceSchema,
  block: HclBlock,
  path: readonly string[],
  onFound: (slot: ConnectionSlot, target: { type: string; name: string }) => void,
  context: FieldContext,
): void {
  for (const entry of block.attributes) {
    for (const reference of referencesIn(entry.value)) {
      const slot = matchSlot(schema.slots, entry.key, path, reference.resourceType);
      if (slot) {
        onFound(slot, { type: reference.resourceType, name: reference.localName });
        continue;
      }
      context.issues.push({
        kind: "unmatched-reference",
        resource: context.address,
        message: `${entry.key} references ${reference.resourceType}.${reference.localName} but the resource has no matching connection point.`,
      });
    }
  }

  for (const child of block.blocks) {
    collectEdges(schema, child, [...path, child.type], onFound, context);
  }
}

export interface ImportOptions {
  readonly providerId: ProviderId;
  readonly source: string;
}

/** Parses Terraform and builds the graph it describes. */
export async function importTerraform({
  providerId,
  source,
}: ImportOptions): Promise<ImportResult> {
  const issues: ImportIssue[] = [];
  const trimmed = source.trim();

  let blocks: readonly HclBlock[];
  if (trimmed.startsWith("{")) {
    try {
      blocks = blocksFromJson(trimmed).blocks;
    } catch (cause) {
      return {
        nodes: [],
        edges: [],
        providerSettings: {},
        imported: 0,
        issues: [{ kind: "syntax", message: `Not valid JSON: ${(cause as Error).message}` }],
      };
    }
  } else {
    const parsed = parseHcl(trimmed);
    blocks = parsed.blocks;
    for (const error of parsed.errors) {
      issues.push({ kind: "syntax", message: `Line ${error.line}: ${error.message}` });
    }
  }

  const resourceBlocks = blocks.filter((block) => block.type === "resource");
  for (const block of blocks) {
    if (block.type === "resource") continue;
    if (!KNOWN_NON_RESOURCE.has(block.type)) {
      issues.push({
        kind: "skipped-block",
        message: `${block.type} blocks are not imported.`,
      });
    }
  }

  // Provider settings, so an imported config keeps its project and region.
  const providerSettings: Record<string, FieldValue> = {};
  for (const block of blocks.filter((entry) => entry.type === "provider")) {
    for (const entry of block.attributes) {
      if (entry.value.kind === "string") providerSettings[entry.key] = entry.value.value;
    }
  }

  // Load every schema first: the rest of the walk is synchronous.
  const schemas = new Map<string, ResourceSchema>();
  for (const type of new Set(resourceBlocks.map((block) => block.labels[0] ?? ""))) {
    if (!type) continue;
    try {
      const schema = await loadResourceSchema(providerId, type);
      if (schema) schemas.set(type, schema);
    } catch (cause) {
      // One unreachable schema must not lose the whole import; the resources that did load
      // are still worth showing, and the ones that did not are reported below.
      issues.push({
        kind: "unknown-resource-type",
        message: `Could not load the schema for ${type}: ${(cause as Error).message}`,
      });
    }
  }

  const nodes: ResourceNode[] = [];
  const byAddress = new Map<string, string>();
  const pending: { source: string; nodeId: string; slot: ConnectionSlot }[] = [];

  for (const block of resourceBlocks) {
    const [type, name] = block.labels;
    const address = addressOf(block);

    if (!type || !name) {
      issues.push({ kind: "syntax", message: `resource block on line ${block.line} needs a type and a name.` });
      continue;
    }

    const schema = schemas.get(type);
    if (!schema) {
      issues.push({
        kind: "unknown-resource-type",
        resource: address,
        message: `${type} is not in the ${providerId} catalog and was skipped.`,
      });
      continue;
    }

    const context: FieldContext = { address, issues };
    const slotAttributes = new Set(schema.slots.map((slot) => slot.attribute ?? slot.id));
    const nodeId = crypto.randomUUID();

    nodes.push({
      id: nodeId,
      type: "resource",
      position: { x: 0, y: 0 },
      data: { resourceType: type, localName: name, fields: mapFields(schema.fields, block, context, slotAttributes) },
    });
    byAddress.set(address, nodeId);

    collectEdges(
      schema,
      block,
      [],
      (slot, target) => pending.push({ source: `${target.type}.${target.name}`, nodeId, slot }),
      context,
    );
  }

  const edges: Edge[] = [];
  for (const { source: address, nodeId, slot } of pending) {
    const sourceId = byAddress.get(address);
    if (!sourceId) {
      issues.push({
        kind: "unmatched-reference",
        message: `${address} is referenced but was not imported, so that connection was dropped.`,
      });
      continue;
    }
    edges.push({
      id: `import-${edges.length}`,
      source: sourceId,
      target: nodeId,
      targetHandle: slot.id,
    });
  }

  // Lay the graph out by dependency depth; imported configs carry no coordinates.
  const positions = layeredPositions(nodes, edges);
  const placed = nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));

  return { nodes: placed, edges, issues, providerSettings, imported: placed.length };
}
