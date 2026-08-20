import { describe, expect, it } from "vitest";

import type { CompileEdge, CompileNode } from "@/lib/graph/types";
import type { FieldValues } from "@/lib/providers/types";
import { compileGraph, type CompileInput, type CompileResult, type DiagnosticCode } from "@/lib/terraform/compile";
import { serializeHcl } from "@/lib/terraform/hcl";

const node = (
  id: string,
  resourceType: string,
  localName: string,
  fields: FieldValues = {},
): CompileNode => ({ id, data: { resourceType, localName, fields } });

const edge = (
  id: string,
  source: string,
  target: string,
  targetHandle: string,
): CompileEdge => ({ id, source, target, targetHandle });

const input = (
  nodes: readonly CompileNode[],
  edges: readonly CompileEdge[] = [],
  providerSettings: FieldValues = { project: "my-project" },
): CompileInput => ({ providerId: "gcp", providerSettings, nodes, edges });

/** Diagnostic codes from a failed compile, for concise assertions. */
const codesOf = (result: CompileResult): readonly DiagnosticCode[] =>
  result.ok ? [] : result.diagnostics.map((entry) => entry.code);

const expectOk = (result: CompileResult) => {
  if (!result.ok) {
    throw new Error(`Expected compile to succeed, got: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.document;
};

// A valid three-tier graph reused across several tests.
const vpc = node("n1", "google_compute_network", "main", { name: "main" });
const subnet = node("n2", "google_compute_subnetwork", "web", {
  name: "web",
  ip_cidr_range: "10.0.1.0/24",
});
const linkSubnetToVpc = edge("e1", "n1", "n2", "network");

describe("compileGraph", () => {
  it("compiles a single resource with its defaults applied", () => {
    const document = expectOk(compileGraph(input([vpc])));

    expect(document.resources).toHaveLength(1);
    expect(serializeHcl(document)).toContain(`resource "google_compute_network" "main" {`);
    // auto_create_subnetworks defaults to false in the catalog, so it is emitted explicitly.
    expect(serializeHcl(document)).toContain("auto_create_subnetworks = false");
  });

  it("emits the terraform and provider blocks so output is runnable", () => {
    const output = serializeHcl(expectOk(compileGraph(input([vpc]))));

    expect(output).toContain('source  = "hashicorp/google"');
    expect(output).toContain('provider "google" {');
    expect(output).toContain('project = "my-project"');
  });

  it("turns a connection into a real attribute reference", () => {
    const output = serializeHcl(
      expectOk(compileGraph(input([vpc, subnet], [linkSubnetToVpc]))),
    );

    // Padding varies with `=` alignment, so match the reference rather than exact spacing.
    expect(output).toMatch(/network\s+= google_compute_network\.main\.id/);
  });

  it("orders resources by type then name so output is stable", () => {
    const shuffled = [
      node("n3", "google_storage_bucket", "zeta", { name: "zeta" }),
      node("n4", "google_compute_network", "beta", { name: "beta" }),
      node("n5", "google_compute_network", "alpha", { name: "alpha" }),
    ];
    const document = expectOk(compileGraph(input(shuffled)));

    expect(document.resources.map((resource) => `${resource.type}.${resource.name}`)).toEqual([
      "google_compute_network.alpha",
      "google_compute_network.beta",
      "google_storage_bucket.zeta",
    ]);
  });

  it("omits optional fields the user left blank", () => {
    const output = serializeHcl(expectOk(compileGraph(input([vpc]))));
    expect(output).not.toContain("description");
  });

  it("treats a cleared field as absent rather than reviving its default", () => {
    const cleared = node("n1", "google_compute_subnetwork", "web", {
      name: "web",
      ip_cidr_range: "10.0.1.0/24",
      region: "",
    });
    const result = compileGraph(input([vpc, cleared], [edge("e1", "n1", "n1", "network")]));

    // region is required, so clearing it is an error rather than a silent fallback.
    expect(codesOf(result)).toContain("missing-required-field");
  });
});

describe("compileGraph validation", () => {
  it("reports a missing required field", () => {
    const result = compileGraph(input([node("n1", "google_compute_network", "main")]));
    expect(codesOf(result)).toContain("missing-required-field");
  });

  it("reports an unknown resource type", () => {
    const result = compileGraph(input([node("n1", "google_nonexistent", "x")]));
    expect(codesOf(result)).toContain("unknown-resource-type");
  });

  it("reports an invalid local name", () => {
    const result = compileGraph(input([node("n1", "google_compute_network", "1-bad", { name: "a" })]));
    expect(codesOf(result)).toContain("invalid-local-name");
  });

  it("reports two resources of the same type sharing a name", () => {
    const result = compileGraph(
      input([
        node("n1", "google_compute_network", "main", { name: "a" }),
        node("n2", "google_compute_network", "main", { name: "b" }),
      ]),
    );
    expect(codesOf(result)).toContain("duplicate-local-name");
  });

  it("allows the same name across different resource types", () => {
    const result = compileGraph(
      input([
        node("n1", "google_compute_network", "main", { name: "a" }),
        node("n2", "google_storage_bucket", "main", { name: "b" }),
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it("reports a connection whose source is the wrong resource type", () => {
    const bucket = node("n9", "google_storage_bucket", "assets", { name: "assets" });
    const result = compileGraph(input([bucket, subnet], [edge("e1", "n9", "n2", "network")]));
    expect(codesOf(result)).toContain("slot-type-mismatch");
  });

  it("reports a second connection into a single-value slot", () => {
    const otherVpc = node("n8", "google_compute_network", "other", { name: "other" });
    const result = compileGraph(
      input([vpc, otherVpc, subnet], [linkSubnetToVpc, edge("e2", "n8", "n2", "network")]),
    );
    expect(codesOf(result)).toContain("slot-cardinality-exceeded");
  });

  it("reports an edge landing on a slot the resource does not have", () => {
    const result = compileGraph(input([vpc, subnet], [edge("e1", "n1", "n2", "not_a_slot")]));
    expect(codesOf(result)).toContain("unknown-slot");
  });

  it("reports a required connection that was never made", () => {
    const result = compileGraph(input([subnet]));
    expect(codesOf(result)).toContain("missing-required-connection");
  });

  it("reports a missing provider setting", () => {
    const result = compileGraph(input([vpc], [], {}));
    expect(codesOf(result)).toContain("missing-provider-setting");
  });

  it("reports a reference cycle", () => {
    // The reverse edge is also an invalid slot, which is unavoidable: the catalog has no pair
    // of resources that can legally reference each other. Both diagnostics are expected.
    const result = compileGraph(
      input([vpc, subnet], [linkSubnetToVpc, edge("e2", "n2", "n1", "network")]),
    );
    expect(codesOf(result)).toContain("dependency-cycle");
  });

  it("reports a number field that cannot be parsed", () => {
    const result = compileGraph(
      input([node("n1", "google_compute_network", "main", { name: "main", mtu: "not-a-number" })]),
    );
    expect(codesOf(result)).toContain("invalid-field-value");
  });

  it("collects every problem in one pass rather than stopping at the first", () => {
    const result = compileGraph(input([node("n1", "google_compute_subnetwork", "1-bad", {})]));
    expect(codesOf(result).length).toBeGreaterThan(1);
  });
});

describe("compileGraph with nested blocks", () => {
  it("nests firewall protocol and ports inside an allow block", () => {
    const firewall = node("n3", "google_compute_firewall", "allow_ssh", {
      name: "allow-ssh",
      allow: [{ ports: ["22"] }],
      source_ranges: ["0.0.0.0/0"],
    });
    const output = serializeHcl(
      expectOk(compileGraph(input([vpc, firewall], [edge("e1", "n1", "n3", "network")]))),
    );

    expect(output).toContain(`resource "google_compute_firewall" "allow_ssh" {`);
    expect(output).toMatch(/network\s+= google_compute_network\.main\.id/);
    expect(output).toContain(`  allow {
    protocol = "tcp"
    ports    = ["22"]
  }`);
    // protocol and ports must not also appear as top-level attributes.
    expect(output).not.toMatch(/^\s{2}protocol\s+=/m);
  });

  it("takes nested values from the repeated block they belong to", () => {
    const firewall = node("n3", "google_compute_firewall", "allow_ping", {
      name: "allow-ping",
      allow: [{ protocol: "icmp" }],
    });
    const output = serializeHcl(
      expectOk(compileGraph(input([vpc, firewall], [edge("e1", "n1", "n3", "network")]))),
    );

    expect(output).toContain('protocol = "icmp"');
    expect(output).not.toContain("ports");
  });

  it("emits a required block from its defaults even when the user set nothing", () => {
    const firewall = node("n3", "google_compute_firewall", "bare", { name: "bare" });
    const output = serializeHcl(
      expectOk(compileGraph(input([vpc, firewall], [edge("e1", "n1", "n3", "network")]))),
    );

    expect(output).toContain(`  allow {
    protocol = "tcp"
  }`);
  });

  it("builds the nested blocks of a VM instance", () => {
    const instance = node("n3", "google_compute_instance", "web", { name: "web" });
    const output = serializeHcl(
      expectOk(
        compileGraph(
          input([vpc, subnet, instance], [linkSubnetToVpc, edge("e2", "n2", "n3", "subnetwork")]),
        ),
      ),
    );

    expect(output).toContain(`boot_disk {
    initialize_params {`);
    expect(output).toContain('image = "debian-cloud/debian-12"');
    expect(output).toContain("subnetwork = google_compute_subnetwork.web.id");
    // Optional blocks stay out until something puts content in them, so a VM with no service
    // account connected does not grow one just because `scopes` has a default.
    expect(output).not.toContain("service_account {");
    expect(output).not.toContain("access_config");
  });

  it("emits an access_config block when the user adds one", () => {
    const instance = node("n3", "google_compute_instance", "web", {
      name: "web",
      network_interface: [{ access_config: [{}] }],
    });
    const output = serializeHcl(
      expectOk(
        compileGraph(
          input([vpc, subnet, instance], [linkSubnetToVpc, edge("e2", "n2", "n3", "subnetwork")]),
        ),
      ),
    );

    expect(output).toContain("access_config {}");
    // The slot still lands inside the interface the user created.
    expect(output).toContain("subnetwork = google_compute_subnetwork.web.id");
  });

  it("wires a service account into the instance when connected", () => {
    const account = node("n4", "google_service_account", "runner", { account_id: "web-runner" });
    const instance = node("n3", "google_compute_instance", "web", { name: "web" });
    const output = serializeHcl(
      expectOk(
        compileGraph(
          input(
            [vpc, subnet, instance, account],
            [
              linkSubnetToVpc,
              edge("e2", "n2", "n3", "subnetwork"),
              // The slot id is the attribute it writes, which inside service_account is email.
              edge("e3", "n4", "n3", "email"),
            ],
          ),
        ),
      ),
    );

    expect(output).toContain("service_account {");
    expect(output).toContain("email  = google_service_account.runner.email");
    expect(output).toContain('scopes = ["cloud-platform"]');
  });
});

describe("compileGraph end to end", () => {
  it("produces a complete, apply-able configuration for a small VPC", () => {
    const instance = node("n3", "google_compute_instance", "web", { name: "web" });
    const output = serializeHcl(
      expectOk(
        compileGraph(
          input([vpc, subnet, instance], [linkSubnetToVpc, edge("e2", "n2", "n3", "subnetwork")]),
        ),
      ),
    );

    expect(output).toBe(
      `terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "my-project"
  region  = "us-central1"
  zone    = "us-central1-a"
}

resource "google_compute_instance" "web" {
  name         = "web"
  machine_type = "e2-medium"
  zone         = "us-central1-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.web.id
  }
}

resource "google_compute_network" "main" {
  name                    = "main"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "web" {
  name                     = "web"
  ip_cidr_range            = "10.0.1.0/24"
  region                   = "us-central1"
  private_ip_google_access = false
  network                  = google_compute_network.main.id
}
`,
    );
  });
});
