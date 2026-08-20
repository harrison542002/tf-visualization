import { beforeEach, describe, expect, it } from "vitest";

import { useGraphStore } from "./store";

const reset = () =>
  useGraphStore.setState({
    providerId: null,
    providerSettings: {},
    nodes: [],
    edges: [],
    selectedNodeId: null,
    past: [],
    future: [],
    historyTag: null,
  });

const store = () => useGraphStore.getState();

/** Adds a resource and returns the node that was created. */
async function addResource(type: string) {
  await store().addResource(type, { x: 0, y: 0 });
  const nodes = store().nodes;
  const node = nodes[nodes.length - 1];
  if (!node) throw new Error(`addResource did not create a node for ${type}`);
  return node;
}

beforeEach(() => {
  reset();
  useGraphStore.getState().selectProvider("gcp");
});

describe("addResource", () => {
  it("names nodes uniquely within a resource type", async () => {
    const first = await addResource("google_compute_network");
    const second = await addResource("google_compute_network");

    expect(first.data.localName).toBe("vpc_network");
    expect(second.data.localName).toBe("vpc_network_2");
  });

  it("seeds fields from the schema defaults", async () => {
    const node = await addResource("google_compute_network");
    expect(node.data.fields["auto_create_subnetworks"]).toBe(false);
  });

  it("selects the new node", async () => {
    const node = await addResource("google_storage_bucket");
    expect(store().selectedNodeId).toBe(node.id);
  });
});

describe("duplicateNode", () => {
  it("copies fields but gives the copy its own name and id", async () => {
    const original = await addResource("google_storage_bucket");
    store().setNodeField(original.id, "name", "assets");
    store().duplicateNode(original.id);

    const [first, second] = store().nodes;
    expect(store().nodes).toHaveLength(2);
    expect(second?.id).not.toBe(first?.id);
    expect(second?.data.fields["name"]).toBe("assets");
    expect(second?.data.localName).not.toBe(first?.data.localName);
  });

  it("does not carry over connections", async () => {
    const vpc = await addResource("google_compute_network");
    const subnet = await addResource("google_compute_subnetwork");
    store().onConnect({
      source: vpc.id,
      target: subnet.id,
      sourceHandle: null,
      targetHandle: "network",
    });
    expect(store().edges).toHaveLength(1);

    store().duplicateNode(subnet.id);
    expect(store().edges).toHaveLength(1);
  });

  it("ignores an unknown node", async () => {
    store().duplicateNode("nope");
    expect(store().nodes).toHaveLength(0);
  });
});

describe("removeNode", () => {
  it("removes the edges attached to it", async () => {
    const vpc = await addResource("google_compute_network");
    const subnet = await addResource("google_compute_subnetwork");
    store().onConnect({
      source: vpc.id,
      target: subnet.id,
      sourceHandle: null,
      targetHandle: "network",
    });

    store().removeNode(vpc.id);

    expect(store().nodes).toHaveLength(1);
    expect(store().edges).toHaveLength(0);
  });

  it("clears the selection when the selected node goes", async () => {
    const node = await addResource("google_compute_network");
    store().removeNode(node.id);
    expect(store().selectedNodeId).toBeNull();
  });
});

describe("onConnect", () => {
  it("rejects a connection the schema does not allow", async () => {
    const bucket = await addResource("google_storage_bucket");
    const subnet = await addResource("google_compute_subnetwork");

    store().onConnect({
      source: bucket.id,
      target: subnet.id,
      sourceHandle: null,
      targetHandle: "network",
    });

    expect(store().edges).toHaveLength(0);
  });
});

describe("undo and redo", () => {
  it("starts with nothing to undo", async () => {
    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
  });

  it("undoes adding a node, and redoes it", async () => {
    await addResource("google_compute_network");
    expect(store().nodes).toHaveLength(1);

    store().undo();
    expect(store().nodes).toHaveLength(0);

    store().redo();
    expect(store().nodes).toHaveLength(1);
  });

  it("does nothing when there is no history", async () => {
    store().undo();
    store().redo();
    expect(store().nodes).toHaveLength(0);
  });

  it("collapses a run of edits to one field into a single step", async () => {
    const node = await addResource("google_storage_bucket");
    const before = store().past.length;

    store().setNodeField(node.id, "name", "a");
    store().setNodeField(node.id, "name", "as");
    store().setNodeField(node.id, "name", "ass");
    store().setNodeField(node.id, "name", "assets");

    // Typing four characters is one undo step, not four.
    expect(store().past.length).toBe(before + 1);

    store().undo();
    expect(store().nodes[0]?.data.fields["name"]).toBeUndefined();
  });

  it("starts a new step when the edit moves to another field", async () => {
    const node = await addResource("google_storage_bucket");
    const before = store().past.length;

    store().setNodeField(node.id, "name", "assets");
    store().setNodeField(node.id, "location", "EU");

    expect(store().past.length).toBe(before + 2);

    store().undo();
    expect(store().nodes[0]?.data.fields["location"]).toBe("US");
    expect(store().nodes[0]?.data.fields["name"]).toBe("assets");
  });

  it("restores connections", async () => {
    const vpc = await addResource("google_compute_network");
    const subnet = await addResource("google_compute_subnetwork");
    store().onConnect({
      source: vpc.id,
      target: subnet.id,
      sourceHandle: null,
      targetHandle: "network",
    });

    store().undo();
    expect(store().edges).toHaveLength(0);

    store().redo();
    expect(store().edges).toHaveLength(1);
  });

  it("drops the redo stack once a new change is made", async () => {
    await addResource("google_compute_network");
    store().undo();
    expect(store().future).toHaveLength(1);

    await addResource("google_storage_bucket");
    expect(store().future).toHaveLength(0);
  });

  it("undoes a clear", async () => {
    await addResource("google_compute_network");
    await addResource("google_storage_bucket");
    store().clearGraph();
    expect(store().nodes).toHaveLength(0);

    store().undo();
    expect(store().nodes).toHaveLength(2);
  });

  it("clears history when the provider changes", async () => {
    await addResource("google_compute_network");
    expect(store().past.length).toBeGreaterThan(0);

    store().selectProvider("gcp");
    expect(store().past).toHaveLength(0);
    expect(store().nodes).toHaveLength(0);
  });

  it("does not leave the selection pointing at a node that no longer exists", async () => {
    const node = await addResource("google_compute_network");
    expect(store().selectedNodeId).toBe(node.id);

    store().undo();
    expect(store().selectedNodeId).toBeNull();
  });
});

describe("autoLayout", () => {
  it("moves dependants to the right of what they reference", async () => {
    const vpc = await addResource("google_compute_network");
    const subnet = await addResource("google_compute_subnetwork");
    store().onConnect({
      source: vpc.id,
      target: subnet.id,
      sourceHandle: null,
      targetHandle: "network",
    });

    store().autoLayout();

    const positioned = new Map(store().nodes.map((node) => [node.id, node.position]));
    expect(positioned.get(subnet.id)?.x).toBeGreaterThan(positioned.get(vpc.id)?.x ?? 0);
  });

  it("is undoable", async () => {
    const node = await addResource("google_compute_network");
    const original = { ...node.position };

    store().autoLayout();
    store().undo();

    expect(store().nodes[0]?.position).toEqual(original);
  });
});
