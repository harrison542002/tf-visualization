import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGraphStore } from "@/lib/graph/store";
import { resetCatalogCache } from "@/lib/providers/catalog";
import { ResourceSearch } from "./ResourceSearch";

/**
 * The index fetch is stubbed to fail, which leaves the search on its curated fallback: a real
 * catalog index is megabytes and its contents are not what these tests are about.
 */
const stubIndexUnavailable = () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response));
};

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

describe("ResourceSearch", () => {
  it("lists resources before anything is typed", () => {
    render(<ResourceSearch onSelect={() => {}} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Add a resource" })).toBeInTheDocument();
    expect(screen.getByText("google_compute_network")).toBeInTheDocument();
  });

  it("narrows to matches as the query is typed", async () => {
    const user = userEvent.setup();
    render(<ResourceSearch onSelect={() => {}} onClose={() => {}} />);

    await user.type(screen.getByRole("textbox", { name: "Search resources to add" }), "subnet");

    expect(screen.getByText("google_compute_subnetwork")).toBeInTheDocument();
    expect(screen.queryByText("google_storage_bucket")).not.toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    render(<ResourceSearch onSelect={() => {}} onClose={() => {}} />);

    await user.type(screen.getByRole("textbox", { name: "Search resources to add" }), "kubernetes");

    expect(screen.getByText(/No resources match/)).toBeInTheDocument();
  });

  it("adds the clicked resource and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ResourceSearch onSelect={onSelect} onClose={onClose} />);

    await user.click(screen.getByText("google_compute_network"));

    expect(onSelect).toHaveBeenCalledWith("google_compute_network");
    expect(onClose).toHaveBeenCalled();
  });

  it("adds the highlighted resource on Enter", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ResourceSearch onSelect={onSelect} onClose={() => {}} />);

    const input = screen.getByRole("textbox", { name: "Search resources to add" });
    await user.type(input, "subnet");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("google_compute_subnetwork");
  });

  it("moves the highlight with the arrow keys", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ResourceSearch onSelect={onSelect} onClose={() => {}} />);

    const input = screen.getByRole("textbox", { name: "Search resources to add" });
    await user.click(input);
    await user.keyboard("{ArrowDown}{Enter}");

    // Second row, whichever it is — the point is that Enter followed the highlight down.
    const rows = screen.queryAllByRole("button");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(rows.length).toBeGreaterThan(1);
    expect(onSelect.mock.calls[0]?.[0]).not.toBe("google_compute_network");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResourceSearch onSelect={() => {}} onClose={onClose} />);

    await user.click(screen.getByRole("textbox", { name: "Search resources to add" }));
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
