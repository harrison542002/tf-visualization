import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useGraphStore } from "@/lib/graph/store";
import { ProviderStep } from "./ProviderStep";

beforeEach(() => {
  useGraphStore.setState({
    providerId: null,
    providerSettings: {},
    nodes: [],
    edges: [],
    selectedNodeId: null,
  });
});

describe("ProviderStep", () => {
  it("lists every provider in the registry", () => {
    render(<ProviderStep />);

    expect(screen.getByRole("button", { name: /Google Cloud/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Amazon Web Services/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Microsoft Azure/ })).toBeInTheDocument();
  });

  it("disables providers that are not implemented yet", () => {
    render(<ProviderStep />);

    expect(screen.getByRole("button", { name: /Google Cloud/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Amazon Web Services/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Microsoft Azure/ })).toBeDisabled();
  });

  it("shows how many resources an available provider offers", () => {
    render(<ProviderStep />);
    expect(screen.getByText(/\d+ resources/)).toBeInTheDocument();
  });

  it("selects the provider and seeds its default settings", async () => {
    const user = userEvent.setup();
    render(<ProviderStep />);

    await user.click(screen.getByRole("button", { name: /Google Cloud/ }));

    const state = useGraphStore.getState();
    expect(state.providerId).toBe("gcp");
    // Defaults come from the catalog, so the settings form opens pre-filled.
    expect(state.providerSettings["region"]).toBe("us-central1");
  });

  it("does nothing when a coming-soon provider is clicked", async () => {
    const user = userEvent.setup();
    render(<ProviderStep />);

    await user.click(screen.getByRole("button", { name: /Amazon Web Services/ }));

    expect(useGraphStore.getState().providerId).toBeNull();
  });
});
