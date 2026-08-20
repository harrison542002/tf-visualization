import { describe, expect, it } from "vitest";

import { layeredPositions, type LayoutNode } from "@/lib/graph/layout";

const node = (id: string, x = 0, y = 0): LayoutNode => ({ id, position: { x, y } });

describe("layeredPositions", () => {
  it("returns an empty map for an empty graph", () => {
    expect(layeredPositions([], []).size).toBe(0);
  });

  it("puts a dependant to the right of what it references", () => {
    const positions = layeredPositions(
      [node("vpc"), node("subnet"), node("vm")],
      [
        { source: "vpc", target: "subnet" },
        { source: "subnet", target: "vm" },
      ],
    );

    const x = (id: string) => positions.get(id)?.x ?? 0;
    expect(x("vpc")).toBeLessThan(x("subnet"));
    expect(x("subnet")).toBeLessThan(x("vm"));
  });

  it("stacks unconnected resources in a single column", () => {
    const positions = layeredPositions([node("a"), node("b"), node("c")], []);

    const xs = [...positions.values()].map((position) => position.x);
    expect(new Set(xs).size).toBe(1);
    const ys = [...positions.values()].map((position) => position.y);
    expect(new Set(ys).size).toBe(3);
  });

  it("places a node by its longest path, not its shortest", () => {
    // d is reachable as a -> d and as a -> b -> c -> d; the longer chain wins.
    const positions = layeredPositions(
      [node("a"), node("b"), node("c"), node("d")],
      [
        { source: "a", target: "d" },
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "d" },
      ],
    );

    expect(positions.get("d")?.x).toBeGreaterThan(positions.get("c")?.x ?? 0);
  });

  it("keeps existing vertical order within a column", () => {
    const positions = layeredPositions([node("lower", 0, 500), node("upper", 0, 100)], []);
    expect(positions.get("upper")?.y).toBeLessThan(positions.get("lower")?.y ?? 0);
  });

  it("positions every node exactly once", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const positions = layeredPositions(nodes, [{ source: "a", target: "b" }]);
    expect(positions.size).toBe(nodes.length);
  });

  it("terminates on a cycle rather than recursing forever", () => {
    const positions = layeredPositions(
      [node("a"), node("b")],
      [
        { source: "a", target: "b" },
        { source: "b", target: "a" },
      ],
    );
    expect(positions.size).toBe(2);
  });

  it("ignores edges referring to nodes that are no longer present", () => {
    const positions = layeredPositions([node("a")], [{ source: "ghost", target: "a" }]);
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
  });

  it("honours custom spacing", () => {
    const positions = layeredPositions(
      [node("a"), node("b")],
      [{ source: "a", target: "b" }],
      { columnGap: 100, originX: 50 },
    );

    expect(positions.get("a")?.x).toBe(50);
    expect(positions.get("b")?.x).toBe(150);
  });
});
