import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGraphStore } from "@/lib/graph/store";
import { resetCatalogCache } from "@/lib/providers/catalog";
import { Palette } from "@/components/canvas/Palette";

/** Leaves the palette on its curated fallback; the real index is megabytes. */
const stubIndexUnavailable = () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
};

const panel = () => document.getElementById("resource-palette");

beforeEach(() => {
  resetCatalogCache();
  stubIndexUnavailable();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useGraphStore.setState({ providerId: "gcp", nodes: [], edges: [], selectedNodeId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Palette", () => {
  it("lists the curated resources by category", () => {
    render(<Palette />);

    expect(screen.getByRole("heading", { name: "Resources" })).toBeInTheDocument();
    expect(screen.getByText("google_compute_network")).toBeInTheDocument();
  });

  it("filters as the query is typed", async () => {
    const user = userEvent.setup();
    render(<Palette />);

    await user.type(screen.getByRole("searchbox", { name: "Search resources" }), "subnet");

    expect(screen.getByText("google_compute_subnetwork")).toBeInTheDocument();
    expect(screen.queryByText("google_storage_bucket")).not.toBeInTheDocument();
  });

  it("opens expanded", () => {
    render(<Palette />);

    expect(screen.getByRole("button", { name: "Hide resources" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // `inert` is what actually takes the hidden panel out of the tab order and the a11y tree.
    expect(panel()).not.toHaveAttribute("inert");
  });

  it("collapses to a rail and comes back", async () => {
    const user = userEvent.setup();
    render(<Palette />);

    await user.click(screen.getByRole("button", { name: "Hide resources" }));

    expect(panel()).toHaveAttribute("inert");
    const reopen = screen.getByRole("button", { name: "Show resources" });
    expect(reopen).toHaveAttribute("aria-expanded", "false");

    await user.click(reopen);

    expect(panel()).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Hide resources" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
