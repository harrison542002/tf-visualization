import { describe, expect, it } from "vitest";

import { gcpProvider } from "@/lib/providers/gcp";
import { filterResources } from "@/lib/providers/search";

const resources = gcpProvider.resources;
const typesFor = (query: string) =>
  filterResources(resources, query).map((resource) => resource.type);

describe("filterResources", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(filterResources(resources, "")).toHaveLength(resources.length);
    expect(filterResources(resources, "   ")).toHaveLength(resources.length);
  });

  it("matches on display name, case-insensitively", () => {
    expect(typesFor("subnetwork")).toContain("google_compute_subnetwork");
    expect(typesFor("SUBNETWORK")).toContain("google_compute_subnetwork");
  });

  it("matches on the Terraform type, which is how provider users search", () => {
    expect(typesFor("google_storage_bucket")).toEqual(["google_storage_bucket"]);
  });

  it("matches on the description", () => {
    expect(typesFor("virtual machine")).toContain("google_compute_instance");
  });

  it("matches on category", () => {
    const networking = typesFor("network");
    expect(networking).toContain("google_compute_firewall");
  });

  it("requires every term to match, so extra words narrow the list", () => {
    const broad = typesFor("compute");
    const narrow = typesFor("compute disk");

    expect(narrow.length).toBeLessThan(broad.length);
    expect(narrow).toContain("google_compute_disk");
  });

  it("returns nothing when there is no match", () => {
    expect(typesFor("kubernetes cluster mesh")).toEqual([]);
  });
});
