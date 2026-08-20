import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useGraphStore, type ResourceNode } from "@/lib/graph/store";
import { ProviderSwitcher } from "./ProviderSwitcher";

const node = (id: string): ResourceNode => ({
  id,
  type: "resource",
  position: { x: 0, y: 0 },
  data: { resourceType: "google_compute_network", localName: id, fields: {} },
});

/** Puts the store where the editor would: a provider chosen, and `nodes` on the canvas. */
const startOn = (nodes: readonly ResourceNode[]) => {
  useGraphStore.setState({
    providerId: "gcp",
    providerSettings: { region: "us-central1" },
    nodes,
    edges: [],
    selectedNodeId: null,
    past: [],
    future: [],
    historyTag: null,
  });
};

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /Google Cloud/ }));
};

beforeEach(() => {
  startOn([]);
});

describe("ProviderSwitcher", () => {
  it("shows the current provider", () => {
    render(<ProviderSwitcher />);
    expect(screen.getByRole("button", { name: /Google Cloud/ })).toBeInTheDocument();
  });

  it("lists every provider once opened", async () => {
    const user = userEvent.setup();
    render(<ProviderSwitcher />);

    expect(screen.queryByRole("button", { name: /Microsoft Azure/ })).not.toBeInTheDocument();
    await openMenu(user);

    expect(screen.getByRole("button", { name: /Amazon Web Services/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Microsoft Azure/ })).toBeInTheDocument();
  });

  it("switches straight away when the canvas is empty", async () => {
    const user = userEvent.setup();
    render(<ProviderSwitcher />);

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /Amazon Web Services/ }));

    // No warning is worth showing when there is nothing to lose.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useGraphStore.getState().providerId).toBe("aws");
    expect(useGraphStore.getState().providerSettings["region"]).toBe("us-east-1");
  });

  it("warns before discarding a canvas, and keeps it if cancelled", async () => {
    const user = userEvent.setup();
    startOn([node("a"), node("b")]);
    render(<ProviderSwitcher />);

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /Amazon Web Services/ }));

    expect(screen.getByRole("dialog")).toHaveTextContent(/The 2 resources on this canvas come/);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useGraphStore.getState().providerId).toBe("gcp");
    expect(useGraphStore.getState().nodes).toHaveLength(2);
  });

  it("switches and clears the canvas once confirmed", async () => {
    const user = userEvent.setup();
    startOn([node("a")]);
    render(<ProviderSwitcher />);

    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /Amazon Web Services/ }));
    // Singular gets its own clause rather than "The 1 resource ... come from".
    expect(screen.getByRole("dialog")).toHaveTextContent(/The resource on this canvas comes/);

    await user.click(screen.getByRole("button", { name: /Switch and clear/ }));

    expect(useGraphStore.getState().providerId).toBe("aws");
    expect(useGraphStore.getState().nodes).toHaveLength(0);
  });

  it("does not warn or reset when the current provider is re-picked", async () => {
    const user = userEvent.setup();
    startOn([node("a")]);
    render(<ProviderSwitcher />);

    await openMenu(user);
    // Two matches once open: the trigger and the menu entry. The entry is the last of them.
    const entries = screen.getAllByRole("button", { name: /Google Cloud/ });
    await user.click(entries[entries.length - 1]!);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<ProviderSwitcher />);

    await openMenu(user);
    expect(screen.getByRole("button", { name: /Microsoft Azure/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: /Microsoft Azure/ })).not.toBeInTheDocument();
  });
});
