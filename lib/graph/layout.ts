/**
 * Layered auto-layout.
 *
 * Resources are placed in columns by how deep they sit in the reference chain: a VPC lands in
 * the first column, the subnetwork that references it in the second, the VM in the third. That
 * matches how the graph reads — left to right, dependency to dependant — and is enough
 * structure to make a hand-dropped mess legible without pulling in a layout library.
 *
 * Pure, so it is tested without a canvas.
 */

export interface LayoutNode {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
}

export interface LayoutEdge {
  readonly source: string;
  readonly target: string;
}

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface LayoutOptions {
  readonly columnGap?: number;
  readonly rowGap?: number;
  readonly originX?: number;
  readonly originY?: number;
}

const DEFAULTS = { columnGap: 320, rowGap: 160, originX: 0, originY: 0 } as const;

/**
 * Longest path from any root, which is what puts a node to the right of everything it
 * references. Cycles are tolerated rather than rejected — the compiler reports those, and a
 * layout that throws would be a poor way to find out.
 */
function computeDepths(
  ids: readonly string[],
  incoming: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const depth = new Map<string, number>();
  const state = new Map<string, "visiting" | "done">();

  const walk = (id: string): number => {
    if (state.get(id) === "done") return depth.get(id) ?? 0;
    // Revisiting a node still on the stack means a cycle; stop descending instead of looping.
    if (state.get(id) === "visiting") return 0;

    state.set(id, "visiting");
    let deepest = 0;
    for (const source of incoming.get(id) ?? []) {
      deepest = Math.max(deepest, walk(source) + 1);
    }
    state.set(id, "done");
    depth.set(id, deepest);
    return deepest;
  };

  for (const id of ids) walk(id);
  return depth;
}

/** Returns a new position for every node, keyed by node id. */
export function layeredPositions(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Position> {
  const { columnGap, rowGap, originX, originY } = { ...DEFAULTS, ...options };

  const ids = nodes.map((node) => node.id);
  const present = new Set(ids);

  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    // Edges can outlive a node briefly; ignore any that no longer resolve.
    if (!present.has(edge.source) || !present.has(edge.target)) continue;
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }

  const depths = computeDepths(ids, incoming);

  const columns = new Map<number, LayoutNode[]>();
  for (const node of nodes) {
    const column = depths.get(node.id) ?? 0;
    const existing = columns.get(column) ?? [];
    existing.push(node);
    columns.set(column, existing);
  }

  const positions = new Map<string, Position>();
  for (const [column, members] of columns) {
    // Keep the reading order the user already sees, so layout feels like tidying rather than
    // reshuffling. Ties fall back to id for determinism.
    const ordered = [...members].sort(
      (a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id),
    );
    ordered.forEach((node, row) => {
      positions.set(node.id, {
        x: originX + column * columnGap,
        y: originY + row * rowGap,
      });
    });
  }

  return positions;
}
