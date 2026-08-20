/**
 * Canvas state.
 *
 * Zustand rather than React Flow's local `useNodesState` hooks because the palette, the
 * properties panel and the export dialog all sit outside the canvas and need to read or
 * mutate the same graph.
 */

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { create } from "zustand";

import { loadResourceSchema } from "@/lib/providers/catalog";
import { getProvider } from "@/lib/providers/registry";
import type { FieldValue, FieldValues, ProviderId } from "@/lib/providers/types";
import { uniqueLocalName } from "@/lib/terraform/identifiers";
import { isConnectionAllowed } from "./connection";
import { layeredPositions } from "./layout";
import type { ResourceNodeData } from "./types";

/** Every node on the canvas is a resource; the union exists for React Flow's generics. */
export type ResourceNode = Node<ResourceNodeData, "resource">;

/** How many steps of history to keep. Snapshots are small, but not free. */
const HISTORY_LIMIT = 50;

/** The part of the state that undo restores. */
interface GraphSnapshot {
  readonly nodes: readonly ResourceNode[];
  readonly edges: readonly Edge[];
  readonly providerSettings: FieldValues;
}

export interface GraphState extends GraphSnapshot {
  /** `null` until the provider step is completed. */
  readonly providerId: ProviderId | null;
  readonly selectedNodeId: string | null;

  readonly past: readonly GraphSnapshot[];
  readonly future: readonly GraphSnapshot[];
  /**
   * Identifies the edit run the last history entry belongs to.
   *
   * Typing into a field fires a change per keystroke; without this every character would
   * become its own undo step.
   */
  readonly historyTag: string | null;

  readonly selectProvider: (providerId: ProviderId) => void;
  readonly setProviderSetting: (key: string, value: FieldValue) => void;

  /**
   * Adds a resource, fetching its schema first when it is not one of the bundled tier-1 set.
   *
   * Async so the node is only created once the schema is cached — every synchronous consumer
   * downstream (node renderer, panel, compiler) can then assume it is there.
   */
  readonly addResource: (resourceType: string, position: XYPosition) => Promise<void>;
  /** Resource types currently being fetched, so the palette can show progress. */
  readonly loadingTypes: readonly string[];
  readonly duplicateNode: (nodeId: string) => void;
  readonly removeNode: (nodeId: string) => void;
  readonly removeEdge: (edgeId: string) => void;
  readonly selectNode: (nodeId: string | null) => void;
  readonly renameNode: (nodeId: string, localName: string) => void;
  readonly setNodeField: (nodeId: string, key: string, value: FieldValue) => void;

  readonly clearGraph: () => void;
  readonly autoLayout: () => void;

  readonly undo: () => void;
  readonly redo: () => void;
  /** Records the current graph before an externally-driven change, such as a node drag. */
  readonly checkpoint: (tag?: string) => void;

  readonly onNodesChange: (changes: NodeChange<ResourceNode>[]) => void;
  readonly onEdgesChange: (changes: EdgeChange[]) => void;
  readonly onConnect: (connection: Connection) => void;
  readonly isValidConnection: (connection: Connection | Edge) => boolean;
}

/** Seeds a settings object from the schema defaults so forms open pre-filled. */
function defaultsFor(fields: readonly { key: string; defaultValue?: FieldValue }[]): FieldValues {
  const values: Record<string, FieldValue> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) values[field.key] = field.defaultValue;
  }
  return values;
}

const snapshotOf = (state: GraphSnapshot): GraphSnapshot => ({
  nodes: state.nodes,
  edges: state.edges,
  providerSettings: state.providerSettings,
});

/**
 * History entry for the state as it stands before a mutation.
 *
 * Passing the same `tag` as the previous commit coalesces: the snapshot already taken is the
 * right thing to undo back to, so a run of keystrokes collapses into one step.
 */
function commit(state: GraphState, tag: string | null = null): Partial<GraphState> {
  if (tag !== null && tag === state.historyTag) return { future: [] };
  return {
    past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
    future: [],
    historyTag: tag,
  };
}

export const useGraphStore = create<GraphState>((set, get) => ({
  providerId: null,
  providerSettings: {},
  nodes: [],
  edges: [],
  selectedNodeId: null,
  loadingTypes: [],
  past: [],
  future: [],
  historyTag: null,

  selectProvider: (providerId) =>
    set({
      providerId,
      providerSettings: defaultsFor(getProvider(providerId).providerFields),
      nodes: [],
      edges: [],
      selectedNodeId: null,
      loadingTypes: [],
      past: [],
      future: [],
      historyTag: null,
    }),

  setProviderSetting: (key, value) =>
    set((state) => ({
      ...commit(state, `provider-setting:${key}`),
      providerSettings: { ...state.providerSettings, [key]: value },
    })),

  addResource: async (resourceType, position) => {
    const providerId = get().providerId;
    if (!providerId) return;

    set((state) => ({ loadingTypes: [...state.loadingTypes, resourceType] }));
    let schema;
    try {
      schema = await loadResourceSchema(providerId, resourceType);
    } finally {
      set((state) => ({
        loadingTypes: state.loadingTypes.filter((entry) => entry !== resourceType),
      }));
    }
    if (!schema) return;

    // Re-read: the fetch above yielded, so the graph may have moved on.
    const state = get();
    if (state.providerId !== providerId) return;

    // Terraform names must be unique per type, so only same-type names are contended.
    const taken = state.nodes
      .filter((node) => node.data.resourceType === resourceType)
      .map((node) => node.data.localName);

    const node: ResourceNode = {
      id: crypto.randomUUID(),
      type: "resource",
      position,
      data: {
        resourceType,
        localName: uniqueLocalName(schema.displayName, taken),
        fields: defaultsFor(schema.fields),
      },
    };

    set({ ...commit(state), nodes: [...state.nodes, node], selectedNodeId: node.id });
  },
  duplicateNode: (nodeId) => {
    const state = get();
    const source = state.nodes.find((node) => node.id === nodeId);
    if (!source) return;

    const taken = state.nodes
      .filter((node) => node.data.resourceType === source.data.resourceType)
      .map((node) => node.data.localName);

    const copy: ResourceNode = {
      ...source,
      id: crypto.randomUUID(),
      position: { x: source.position.x + 40, y: source.position.y + 40 },
      selected: false,
      data: {
        ...source.data,
        localName: uniqueLocalName(source.data.localName, taken),
        fields: { ...source.data.fields },
      },
    };

    // Connections are deliberately not copied: the duplicate's required slots show as
    // unconnected, which is the honest state rather than a silently shared reference.
    set({ ...commit(state), nodes: [...state.nodes, copy], selectedNodeId: copy.id });
  },

  removeNode: (nodeId) =>
    set((state) => ({
      ...commit(state),
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      // Edges pointing at a deleted node would otherwise linger as invisible references.
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      ...commit(state),
      edges: state.edges.filter((edge) => edge.id !== edgeId),
    })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  renameNode: (nodeId, localName) =>
    set((state) => ({
      ...commit(state, `rename:${nodeId}`),
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, localName } } : node,
      ),
    })),

  setNodeField: (nodeId, key, value) =>
    set((state) => ({
      ...commit(state, `field:${nodeId}:${key}`),
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, fields: { ...node.data.fields, [key]: value } } }
          : node,
      ),
    })),

  clearGraph: () =>
    set((state) => ({ ...commit(state), nodes: [], edges: [], selectedNodeId: null })),

  autoLayout: () =>
    set((state) => {
      const positions = layeredPositions(state.nodes, state.edges);
      return {
        ...commit(state),
        nodes: state.nodes.map((node) => {
          const position = positions.get(node.id);
          return position ? { ...node, position } : node;
        }),
      };
    }),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous) return {};
      return {
        ...previous,
        past: state.past.slice(0, -1),
        future: [snapshotOf(state), ...state.future],
        historyTag: null,
        // The selection may point at a node that is about to come back or disappear.
        selectedNodeId: previous.nodes.some((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : null,
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next) return {};
      return {
        ...next,
        past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
        future: rest,
        historyTag: null,
        selectedNodeId: next.nodes.some((node) => node.id === state.selectedNodeId)
          ? state.selectedNodeId
          : null,
      };
    }),

  checkpoint: (tag) => set((state) => commit(state, tag ?? null)),

  onNodesChange: (changes) =>
    set((state) => {
      // Removals arrive here when React Flow handles the Delete key, and are worth undoing.
      // Drags are checkpointed separately on drag start, and selection is not history at all.
      const removals = changes.some((change) => change.type === "remove");
      return {
        ...(removals ? commit(state) : {}),
        nodes: applyNodeChanges(changes, [...state.nodes]),
      };
    }),

  onEdgesChange: (changes) =>
    set((state) => {
      const removals = changes.some((change) => change.type === "remove");
      return {
        ...(removals ? commit(state) : {}),
        edges: applyEdgeChanges(changes, [...state.edges]),
      };
    }),

  onConnect: (connection) => {
    const state = get();
    if (!state.isValidConnection(connection)) return;
    set({ ...commit(state), edges: addEdge(connection, [...state.edges]) });
  },

  isValidConnection: (connection) => {
    const { providerId, nodes, edges } = get();
    if (!providerId) return false;
    return isConnectionAllowed(providerId, nodes, edges, connection);
  },
}));
