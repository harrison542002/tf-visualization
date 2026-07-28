import { describe, expect, it } from "vitest";

import { isConnectionAllowed } from "./connection";
import type { CompileEdge, CompileNode } from "./types";

const node = (id: string, resourceType: string, localName: string): CompileNode => ({
  id,
  data: { resourceType, localName, fields: {} },
});

const nodes = [
  node("vpc", "google_compute_network", "main"),
  node("subnet", "google_compute_subnetwork", "web"),
  node("vpc2", "google_compute_network", "other"),
  node("bucket", "google_storage_bucket", "assets"),
];

const allowed = (edges: readonly CompileEdge[], candidate: Parameters<typeof isConnectionAllowed>[3]) =>
  isConnectionAllowed("gcp", nodes, edges, candidate);

describe("isConnectionAllowed", () => {
  it("allows a VPC into a subnetwork's network slot", () => {
    expect(allowed([], { source: "vpc", target: "subnet", targetHandle: "network" })).toBe(true);
  });

  it("rejects a source of the wrong resource type", () => {
    expect(allowed([], { source: "bucket", target: "subnet", targetHandle: "network" })).toBe(
      false,
    );
  });

  it("rejects a handle the target does not declare", () => {
    expect(allowed([], { source: "vpc", target: "subnet", targetHandle: "nope" })).toBe(false);
  });

  it("rejects connecting a node to itself", () => {
    expect(allowed([], { source: "vpc", target: "vpc", targetHandle: "network" })).toBe(false);
  });

  it("rejects an incomplete candidate", () => {
    expect(allowed([], { source: null, target: "subnet", targetHandle: "network" })).toBe(false);
    expect(allowed([], { source: "vpc", target: "subnet", targetHandle: null })).toBe(false);
  });

  it("rejects a second edge into a single-value slot", () => {
    const existing: CompileEdge[] = [
      { id: "e1", source: "vpc", target: "subnet", targetHandle: "network" },
    ];
    expect(allowed(existing, { source: "vpc2", target: "subnet", targetHandle: "network" })).toBe(
      false,
    );
  });

  it("rejects an exact duplicate of an existing edge", () => {
    const existing: CompileEdge[] = [
      { id: "e1", source: "vpc", target: "subnet", targetHandle: "network" },
    ];
    expect(allowed(existing, { source: "vpc", target: "subnet", targetHandle: "network" })).toBe(
      false,
    );
  });

  it("rejects nodes that are not on the canvas", () => {
    expect(allowed([], { source: "ghost", target: "subnet", targetHandle: "network" })).toBe(false);
  });
});
