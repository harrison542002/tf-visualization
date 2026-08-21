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
  nestedBlock,
  resourceRef,
  tfBlock,
  tfBool,
  tfList,
  tfNumber,
  tfString,
  tfStringList,
  type TfAttribute,
  type TfBlock,
  type TfDocument,
  type TfNestedBlock,
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

    case "block":
      // Nested blocks are assembled by the recursive builder, never converted as a scalar.
      return undefined;

    case "stringList":
      return Array.isArray(value) && value.every((entry) => typeof entry !== "object")
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

const isBlockValues = (value: FieldValue | undefined): value is FieldValues =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBlockList = (value: FieldValue | undefined): value is readonly FieldValues[] =>
  Array.isArray(value) && value.every(isBlockValues);

/** Blank strings and empty lists mean "cleared", not "set to empty". */
const isBlank = (value: FieldValue): boolean =>
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

const samePath = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index]);

interface BuiltBlock {
  readonly block: TfBlock;
  /**
   * Whether anything here came from the user rather than from a schema default.
   *
   * This is what decides whether an optional nested block is emitted at all. A VM should not
   * grow a `service_account { scopes = [...] }` block just because `scopes` has a default,
   * but it must grow one the moment a service account is actually connected.
   */
  readonly substantive: boolean;
}

interface BuildScope {
  readonly schema: ResourceSchema;
  readonly connections: SlotConnections;
  readonly nodeId: string;
  readonly localName: string;
  readonly diagnostics: Diagnostic[];
}

/**
 * Builds one block — the resource body, or any nested block within it — from schema and values.
 *
 * `path` is where this block sits relative to the resource root, and is how a
 * {@link ConnectionSlot} with a `path` gets its reference written into the right nested block.
 */
function buildBlockFrom(
  fields: readonly FieldSchema[],
  values: FieldValues,
  path: readonly string[],
  scope: BuildScope,
): BuiltBlock {
  const attributes: TfAttribute[] = [];
  const blocks: TfNestedBlock[] = [];
  let substantive = false;

  // Many reference attributes accept either a literal or a reference, so a field and a slot
  // can share a key. A live connection is the more specific intent and wins; the literal is
  // the fallback when nothing is wired up.
  const connectedAtPath = new Set(
    scope.schema.slots
      .filter(
        (slot) =>
          samePath(slot.path ?? [], path) && (scope.connections.get(slot.id)?.length ?? 0) > 0,
      )
      .map((slot) => slot.attribute ?? slot.id),
  );

  // Attributes first, so they precede nested blocks in the rendered output.
  for (const field of fields) {
    if (field.type === "block") continue;
    if (connectedAtPath.has(field.key)) continue;

    const raw = values[field.key];
    const value = effectiveValue(field, raw);

    if (value === undefined) {
      if (field.required) {
        scope.diagnostics.push(
          diagnostic(
            "missing-required-field",
            `${scope.schema.displayName} "${scope.localName}" needs a value for "${field.label}".`,
            { nodeId: scope.nodeId },
          ),
        );
      }
      continue;
    }

    if (raw !== undefined && !isBlank(raw)) substantive = true;

    const tfValue = toTfValue(field, value);
    if (tfValue === undefined) {
      scope.diagnostics.push(
        diagnostic(
          "invalid-field-value",
          `${scope.schema.displayName}: "${field.label}" is not a valid ${field.type}.`,
          { nodeId: scope.nodeId },
        ),
      );
      continue;
    }
    attributes.push(attr(field.key, tfValue));
  }

  for (const slot of scope.schema.slots) {
    if (!samePath(slot.path ?? [], path)) continue;
    const refs = scope.connections.get(slot.id) ?? [];
    if (refs.length === 0) continue;

    substantive = true;
    const key = slot.attribute ?? slot.id;
    if (slot.cardinality === "many") {
      attributes.push(attr(key, tfList(refs)));
    } else {
      const [first] = refs;
      if (first) attributes.push(attr(key, first));
    }
  }

  for (const field of fields) {
    if (field.type !== "block") continue;

    const children = field.fields ?? [];
    const childPath = [...path, field.key];
    const raw = values[field.key];
    const nesting = field.nesting ?? "single";

    /**
     * Builds a candidate child. Its diagnostics are held aside until we know the block is
     * kept — a required field inside a block that never gets emitted is not a problem.
     */
    const candidate = (childValues: FieldValues) => {
      const held: Diagnostic[] = [];
      const built = buildBlockFrom(children, childValues, childPath, {
        ...scope,
        diagnostics: held,
      });
      return { built, held };
    };

    const keep = (built: BuiltBlock, held: readonly Diagnostic[]) => {
      scope.diagnostics.push(...held);
      blocks.push(nestedBlock(field.key, built.block));
      substantive = substantive || built.substantive;
    };

    if (nesting === "list" || nesting === "set") {
      const entries = isBlockList(raw) ? raw : [];
      for (const entry of entries) {
        const { built, held } = candidate(entry);
        scope.diagnostics.push(...held);
        blocks.push(nestedBlock(field.key, built.block));
        // An entry the user added is itself the intent, even if every value is a default.
        substantive = true;
      }

      // A repeated block with no user entries can still be needed by a connected slot:
      // `network_interface` on a VM exists purely to carry the subnetwork reference.
      if (entries.length === 0) {
        const { built, held } = candidate({});
        if (field.required || built.substantive) keep(built, held);
      }
      continue;
    }

    const { built, held } = candidate(isBlockValues(raw) ? raw : {});
    if (field.required || built.substantive) keep(built, held);
  }

  return { block: tfBlock(attributes, blocks), substantive };
}

function buildResourceBlock(
  schema: ResourceSchema,
  values: FieldValues,
  connections: SlotConnections,
  nodeId: string,
  localName: string,
  diagnostics: Diagnostic[],
): TfBlock {
  const built = buildBlockFrom(schema.fields, values, [], {
    schema,
    connections,
    nodeId,
    localName,
    diagnostics,
  });

  if (!schema.build) return built.block;

  // Escape hatch, kept for resources the declarative form genuinely cannot express. Nothing
  // in the catalog uses it — nested blocks are data now.
  const context: BuildContext = {
    field: makeFieldAccessor(resolveFields(schema, values)),
    ref: (slotId) => (connections.get(slotId) ?? [])[0],
    refs: (slotId) => connections.get(slotId) ?? [],
    defaultAttributes: built.block.attributes,
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

  // 4. Build every resource body. This doubles as validation: required fields and
  //    unrepresentable values are reported while walking the schema, including inside nested
  //    blocks, and the result is cached so emitting later is just a lookup.
  const blocksByNode = new Map<string, TfBlock>();
  for (const { node, schema } of resolvedNodes.values()) {
    const connections = connectionsByNode.get(node.id) ?? new Map<string, TfValue[]>();
    blocksByNode.set(
      node.id,
      buildResourceBlock(
        schema,
        node.data.fields,
        connections,
        node.id,
        node.data.localName,
        diagnostics,
      ),
    );

    for (const slot of schema.slots) {
      if (slot.required && (connections.get(slot.id)?.length ?? 0) === 0) {
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
    if (field.type === "block") continue;
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
    .map(({ node, schema }): TfResource => ({
      type: schema.type,
      name: node.data.localName,
      block: blocksByNode.get(node.id) ?? tfBlock(),
    }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  // Built with the same recursion as resources, so a provider can declare nested blocks —
  // azurerm requires a `features {}` block that has no attributes at all.
  const providerBlock = buildBlockFrom(
    provider.providerFields,
    input.providerSettings,
    [],
    {
      schema: {
        type: provider.terraformName,
        displayName: provider.displayName,
        category: "project",
        description: "",
        fields: provider.providerFields,
        slots: [],
      },
      connections: new Map<string, TfValue[]>(),
      nodeId: "",
      localName: provider.terraformName,
      diagnostics: [],
    },
  ).block;

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
          block: providerBlock,
        },
      ],
      resources,
    },
  };
}
