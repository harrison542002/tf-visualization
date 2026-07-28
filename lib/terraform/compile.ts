/**
 * Compiles a canvas graph into a {@link TfDocument}.
 *
 * This is the only place that knows how nodes and edges become Terraform. It never throws for
 * user-caused problems: everything wrong with the graph comes back as a {@link Diagnostic} so
 * the UI can list the issues next to a disabled export button.
 */

import type { CompileEdge, CompileNode } from "@/lib/graph/types";
import { findResourceSchema, getProvider } from "@/lib/providers/registry";
import type {
  BuildContext,
  ConnectionSlot,
  FieldAccessor,
  FieldSchema,
  FieldValue,
  FieldValues,
  ProviderId,
  ResourceSchema,
} from "@/lib/providers/types";
import { isValidLocalName } from "./identifiers";
import {
  attr,
  resourceRef,
  tfBlock,
  tfBool,
  tfList,
  tfNumber,
  tfString,
  tfStringList,
  type TfAttribute,
  type TfDocument,
  type TfResource,
  type TfValue,
} from "./ir";

export type DiagnosticCode =
  | "unknown-resource-type"
  | "invalid-local-name"
  | "duplicate-local-name"
  | "missing-required-field"
  | "invalid-field-value"
  | "unknown-slot"
  | "slot-type-mismatch"
  | "slot-cardinality-exceeded"
  | "missing-required-connection"
  | "dependency-cycle"
  | "missing-provider-setting";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Node the problem belongs to, so the canvas can highlight it. */
  readonly nodeId?: string;
  readonly edgeId?: string;
}

export interface CompileInput {
  readonly providerId: ProviderId;
  /** Provider-level settings such as project and region, keyed by `FieldSchema.key`. */
  readonly providerSettings: FieldValues;
  readonly nodes: readonly CompileNode[];
  readonly edges: readonly CompileEdge[];
}

export type CompileResult =
  | { readonly ok: true; readonly document: TfDocument }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

const diagnostic = (
  code: DiagnosticCode,
  message: string,
  location: { nodeId?: string; edgeId?: string } = {},
): Diagnostic => ({ code, message, ...location });

// --- Field resolution -------------------------------------------------------------------

/**
 * Applies the schema default when a field was never set.
 *
 * Blank strings and empty lists count as absent: clearing an input in the panel is how a user
 * removes an optional attribute, and reviving the default there would be surprising.
 */
function effectiveValue(field: FieldSchema, raw: FieldValue | undefined): FieldValue | undefined {
  const value = raw ?? field.defaultValue;
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  return value;
}

function resolveFields(
  schema: ResourceSchema,
  values: FieldValues,
): ReadonlyMap<string, FieldValue> {
  const resolved = new Map<string, FieldValue>();
  for (const field of schema.fields) {
    const value = effectiveValue(field, values[field.key]);
    if (value !== undefined) resolved.set(field.key, value);
  }
  return resolved;
}

/**
 * Converts a resolved field value into a Terraform value, coercing where the UI stores text.
 * Returns `undefined` when the value cannot be represented, which the caller reports.
 */
function toTfValue(field: FieldSchema, value: FieldValue): TfValue | undefined {
  switch (field.type) {
    case "string":
    case "enum":
      return tfString(String(value));

    case "number": {
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isFinite(parsed) ? tfNumber(parsed) : undefined;
    }

    case "bool":
      return tfBool(typeof value === "boolean" ? value : value === "true");

    case "stringList":
      return Array.isArray(value)
        ? tfStringList(value.map(String))
        : tfStringList(
            String(value)
              .split(",")
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0),
          );
  }
}

function makeFieldAccessor(resolved: ReadonlyMap<string, FieldValue>): FieldAccessor {
  return {
    string: (key) => {
      const value = resolved.get(key);
      return value === undefined ? undefined : String(value);
    },
    number: (key) => {
      const value = resolved.get(key);
      if (value === undefined) return undefined;
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    },
    bool: (key) => {
      const value = resolved.get(key);
      if (value === undefined) return undefined;
      return typeof value === "boolean" ? value : value === "true";
    },
    stringList: (key) => {
      const value = resolved.get(key);
      if (value === undefined) return [];
      return Array.isArray(value) ? value.map(String) : [String(value)];
    },
  };
}

// --- Graph analysis ---------------------------------------------------------------------

interface ResolvedNode {
  readonly node: CompileNode;
  readonly schema: ResourceSchema;
}

/** Connections landing on one node, grouped by the slot they fill. */
type SlotConnections = ReadonlyMap<string, readonly TfValue[]>;

/**
 * Detects a cycle among the edges.
 *
 * Terraform rejects circular references at plan time, and a cycle would also make the emitted
 * graph impossible to apply, so it is caught here with a plain iterative depth-first search.
 */
function findCycle(nodeIds: readonly string[], edges: readonly CompileEdge[]): string[] | undefined {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): string[] | undefined => {
    if (visited.has(id)) return undefined;
    if (visiting.has(id)) return [...stack.slice(stack.indexOf(id)), id];

    visiting.add(id);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return undefined;
  };

  for (const id of nodeIds) {
    const cycle = walk(id);
    if (cycle) return cycle;
  }
  return undefined;
}

// --- Compilation ------------------------------------------------------------------------

function buildResourceBlock(
  schema: ResourceSchema,
  resolved: ReadonlyMap<string, FieldValue>,
  connections: SlotConnections,
  nodeId: string,
  diagnostics: Diagnostic[],
) {
  const attributes: TfAttribute[] = [];

  for (const field of schema.fields) {
    const value = resolved.get(field.key);
    if (value === undefined) continue;

    const tfValue = toTfValue(field, value);
    if (tfValue === undefined) {
      diagnostics.push(
        diagnostic(
          "invalid-field-value",
          `${schema.displayName}: "${field.label}" is not a valid ${field.type}.`,
          { nodeId },
        ),
      );
      continue;
    }
    attributes.push(attr(field.key, tfValue));
  }

  for (const slot of schema.slots) {
    const refs = connections.get(slot.id) ?? [];
    if (refs.length === 0) continue;

    if (slot.cardinality === "many") {
      attributes.push(attr(slot.id, tfList(refs)));
    } else {
      const [first] = refs;
      if (first) attributes.push(attr(slot.id, first));
    }
  }

  if (!schema.build) return tfBlock(attributes);

  const context: BuildContext = {
    field: makeFieldAccessor(resolved),
    ref: (slotId) => (connections.get(slotId) ?? [])[0],
    refs: (slotId) => connections.get(slotId) ?? [],
    defaultAttributes: attributes,
  };
  return schema.build(context);
}

export function compileGraph(input: CompileInput): CompileResult {
  const provider = getProvider(input.providerId);
  const diagnostics: Diagnostic[] = [];

  // 1. Resolve every node against the catalog.
  const resolvedNodes = new Map<string, ResolvedNode>();
  for (const node of input.nodes) {
    const schema = findResourceSchema(input.providerId, node.data.resourceType);
    if (!schema) {
      diagnostics.push(
        diagnostic(
          "unknown-resource-type",
          `"${node.data.resourceType}" is not a known ${provider.displayName} resource.`,
          { nodeId: node.id },
        ),
      );
      continue;
    }
    resolvedNodes.set(node.id, { node, schema });
  }

  // 2. Local names must be legal Terraform identifiers, and unique within a resource type.
  const namesByType = new Map<string, Set<string>>();
  for (const { node, schema } of resolvedNodes.values()) {
    const name = node.data.localName;
    if (!isValidLocalName(name)) {
      diagnostics.push(
        diagnostic(
          "invalid-local-name",
          `"${name || "(empty)"}" is not a valid Terraform name. Use letters, digits, underscores and hyphens, starting with a letter or underscore.`,
          { nodeId: node.id },
        ),
      );
      continue;
    }

    const taken = namesByType.get(schema.type) ?? new Set<string>();
    if (taken.has(name)) {
      diagnostics.push(
        diagnostic(
          "duplicate-local-name",
          `Two ${schema.displayName} nodes are both named "${name}".`,
          { nodeId: node.id },
        ),
      );
    }
    taken.add(name);
    namesByType.set(schema.type, taken);
  }

  // 3. Resolve edges into per-node slot connections.
  const connectionsByNode = new Map<string, Map<string, TfValue[]>>();
  for (const edge of input.edges) {
    const target = resolvedNodes.get(edge.target);
    const source = resolvedNodes.get(edge.source);
    if (!target || !source) continue; // Already reported as an unknown resource type.

    const slot: ConnectionSlot | undefined = target.schema.slots.find(
      (candidate) => candidate.id === edge.targetHandle,
    );
    if (!slot) {
      diagnostics.push(
        diagnostic(
          "unknown-slot",
          `${target.schema.displayName} has no connection point "${edge.targetHandle ?? "(none)"}".`,
          { edgeId: edge.id, nodeId: edge.target },
        ),
      );
      continue;
    }

    if (source.schema.type !== slot.targetType) {
      diagnostics.push(
        diagnostic(
          "slot-type-mismatch",
          `${target.schema.displayName} "${slot.label}" expects a ${slot.targetType}, but is connected to a ${source.schema.type}.`,
          { edgeId: edge.id, nodeId: edge.target },
        ),
      );
      continue;
    }

    const slots = connectionsByNode.get(edge.target) ?? new Map<string, TfValue[]>();
    const existing = slots.get(slot.id) ?? [];

    if (slot.cardinality === "one" && existing.length > 0) {
      diagnostics.push(
        diagnostic(
          "slot-cardinality-exceeded",
          `${target.schema.displayName} "${slot.label}" accepts a single connection.`,
          { edgeId: edge.id, nodeId: edge.target },
        ),
      );
      continue;
    }

    existing.push(resourceRef(source.schema.type, source.node.data.localName, slot.targetAttribute));
    slots.set(slot.id, existing);
    connectionsByNode.set(edge.target, slots);
  }

  // 4. Required fields and required connections.
  for (const { node, schema } of resolvedNodes.values()) {
    const resolved = resolveFields(schema, node.data.fields);

    for (const field of schema.fields) {
      if (field.required && !resolved.has(field.key)) {
        diagnostics.push(
          diagnostic(
            "missing-required-field",
            `${schema.displayName} "${node.data.localName}" needs a value for "${field.label}".`,
            { nodeId: node.id },
          ),
        );
      }
    }

    const connections = connectionsByNode.get(node.id);
    for (const slot of schema.slots) {
      if (slot.required && (connections?.get(slot.id)?.length ?? 0) === 0) {
        diagnostics.push(
          diagnostic(
            "missing-required-connection",
            `${schema.displayName} "${node.data.localName}" must be connected to a ${slot.label}.`,
            { nodeId: node.id },
          ),
        );
      }
    }
  }

  // 5. Provider-level settings.
  for (const field of provider.providerFields) {
    if (field.required && effectiveValue(field, input.providerSettings[field.key]) === undefined) {
      diagnostics.push(
        diagnostic(
          "missing-provider-setting",
          `${provider.displayName} needs a value for "${field.label}".`,
        ),
      );
    }
  }

  // 6. Cycles.
  const cycle = findCycle([...resolvedNodes.keys()], input.edges);
  if (cycle) {
    const names = cycle
      .map((id) => resolvedNodes.get(id)?.node.data.localName ?? id)
      .join(" -> ");
    const [head] = cycle;
    diagnostics.push(
      diagnostic(
        "dependency-cycle",
        `Resources reference each other in a loop: ${names}.`,
        head ? { nodeId: head } : {},
      ),
    );
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  // 7. Emit. Sorting by type then name keeps output stable across canvas reordering.
  const resources: TfResource[] = [...resolvedNodes.values()]
    .map(({ node, schema }): TfResource => {
      const resolved = resolveFields(schema, node.data.fields);
      const connections = connectionsByNode.get(node.id) ?? new Map<string, TfValue[]>();
      return {
        type: schema.type,
        name: node.data.localName,
        block: buildResourceBlock(schema, resolved, connections, node.id, diagnostics),
      };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  // Building can surface value problems the earlier passes could not see.
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const providerAttributes: TfAttribute[] = [];
  for (const field of provider.providerFields) {
    const value = effectiveValue(field, input.providerSettings[field.key]);
    if (value === undefined) continue;
    const tfValue = toTfValue(field, value);
    if (tfValue) providerAttributes.push(attr(field.key, tfValue));
  }

  return {
    ok: true,
    document: {
      requiredProviders: [
        {
          localName: provider.terraformName,
          source: provider.requirement.source,
          version: provider.requirement.version,
        },
      ],
      providers: [
        {
          name: provider.terraformName,
          block: tfBlock(providerAttributes),
        },
      ],
      resources,
    },
  };
}
