import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useGraphStore } from "@/lib/graph/store";
import { providers } from "@/lib/providers/registry";
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

  it("enables every implemented provider", () => {
    render(<ProviderStep />);

    expect(screen.getByRole("button", { name: /Google Cloud/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Amazon Web Services/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Microsoft Azure/ })).toBeEnabled();
  });

  it("counts the whole catalog, not just the bundled tier-1 resources", () => {
    render(<ProviderStep />);

    for (const provider of providers) {
      // `resources` holds only the handful bundled in the JavaScript; the rest of the catalog
      // is fetched on demand, and the card has to speak for all of it.
      expect(provider.catalogSize).toBeGreaterThan(provider.resources.length);
      expect(
        screen.getByText(`${provider.catalogSize.toLocaleString("en-US")} resources`),
      ).toBeInTheDocument();
    }
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

  it("selects AWS, whose catalog is generated rather than hand-written", async () => {
    const user = userEvent.setup();
    render(<ProviderStep />);

    await user.click(screen.getByRole("button", { name: /Amazon Web Services/ }));

    const awsState = useGraphStore.getState();
    expect(awsState.providerId).toBe("aws");
    expect(awsState.providerSettings["region"]).toBe("us-east-1");
  });
});
