import { describe, expect, it } from "vitest";

import { escapeHclString, serializeHcl } from "@/lib/terraform/hcl";
import {
  attr,
  nestedBlock,
  resourceRef,
  tfBlock,
  tfBool,
  tfMap,
  tfNumber,
  tfString,
  tfStringList,
  type TfDocument,
} from "@/lib/terraform/ir";

const emptyDocument: TfDocument = {
  requiredProviders: [],
  providers: [],
  resources: [],
};

/** Wraps a block in a minimal document so tests can assert on rendered resource bodies. */
const resourceOnly = (document: Partial<TfDocument>): TfDocument => ({
  ...emptyDocument,
  ...document,
});

describe("escapeHclString", () => {
  it("escapes backslashes before other sequences", () => {
    expect(escapeHclString("a\\b")).toBe("a\\\\b");
  });

  it("escapes quotes, newlines and tabs", () => {
    expect(escapeHclString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeHclString("line1\nline2")).toBe("line1\\nline2");
    expect(escapeHclString("a\tb")).toBe("a\\tb");
  });

  it("doubles interpolation markers so literals are not evaluated", () => {
    expect(escapeHclString("cost is ${var.price}")).toBe("cost is $${var.price}");
  });

  it("doubles template directive markers", () => {
    expect(escapeHclString("%{ if true }x%{ endif }")).toBe("%%{ if true }x%%{ endif }");
  });
});

describe("serializeHcl", () => {
  it("returns an empty string for an empty document", () => {
    expect(serializeHcl(emptyDocument)).toBe("");
  });

  it("aligns equals signs across consecutive attributes, as terraform fmt does", () => {
    const output = serializeHcl(
      resourceOnly({
        resources: [
          {
            type: "google_compute_network",
            name: "main",
            block: tfBlock([
              attr("name", tfString("main")),
              attr("auto_create_subnetworks", tfBool(false)),
              attr("mtu", tfNumber(1460)),
            ]),
          },
        ],
      }),
    );

    expect(output).toBe(
      `resource "google_compute_network" "main" {
  name                    = "main"
  auto_create_subnetworks = false
  mtu                     = 1460
}
`,
    );
  });

  it("renders references as bare expressions rather than quoted strings", () => {
    const output = serializeHcl(
      resourceOnly({
        resources: [
          {
            type: "google_compute_subnetwork",
            name: "web",
            block: tfBlock([
              attr("network", resourceRef("google_compute_network", "main", "id")),
            ]),
          },
        ],
      }),
    );

    expect(output).toContain("network = google_compute_network.main.id");
    expect(output).not.toContain('"google_compute_network.main.id"');
  });

  it("renders lists inline and empty lists as []", () => {
    const output = serializeHcl(
      resourceOnly({
        resources: [
          {
            type: "google_compute_firewall",
            name: "allow",
            block: tfBlock([
              attr("source_ranges", tfStringList(["0.0.0.0/0"])),
              attr("target_tags", tfStringList(["web", "ssh"])),
              attr("source_tags", tfStringList([])),
            ]),
          },
        ],
      }),
    );

    expect(output).toContain(`source_ranges = ["0.0.0.0/0"]`);
    expect(output).toContain(`target_tags   = ["web", "ssh"]`);
    expect(output).toContain("source_tags   = []");
  });

  it("renders maps across multiple lines with their own alignment", () => {
    const output = serializeHcl(
      resourceOnly({
        resources: [
          {
            type: "google_storage_bucket",
            name: "assets",
            block: tfBlock([
              attr("name", tfString("assets")),
              attr(
                "labels",
                tfMap([
                  { key: "env", value: tfString("prod") },
                  { key: "team", value: tfString("infra") },
                ]),
              ),
            ]),
          },
        ],
      }),
    );

    expect(output).toBe(
      `resource "google_storage_bucket" "assets" {
  name = "assets"
  labels = {
    env  = "prod"
    team = "infra"
  }
}
`,
    );
  });

  it("renders nested blocks separated by a blank line", () => {
    const output = serializeHcl(
      resourceOnly({
        resources: [
          {
            type: "google_compute_instance",
            name: "web",
            block: tfBlock(
              [attr("name", tfString("web"))],
              [
                nestedBlock(
                  "boot_disk",
                  tfBlock(
                    [],
                    [
                      nestedBlock(
                        "initialize_params",
                        tfBlock([attr("image", tfString("debian-cloud/debian-12"))]),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          },
        ],
      }),
    );

    expect(output).toBe(
      `resource "google_compute_instance" "web" {
  name = "web"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }
}
`,
    );
  });

  it("renders a block with no content as {}", () => {
    const output = serializeHcl(
      resourceOnly({
        providers: [{ name: "google", block: tfBlock() }],
      }),
    );

    expect(output).toBe('provider "google" {}\n');
  });

  it("renders a full document with terraform, provider and resource blocks", () => {
    const output = serializeHcl({
      requiredProviders: [
        { localName: "google", source: "hashicorp/google", version: "~> 6.0" },
      ],
      providers: [
        {
          name: "google",
          block: tfBlock([
            attr("project", tfString("my-project")),
            attr("region", tfString("us-central1")),
          ]),
        },
      ],
      resources: [
        {
          type: "google_compute_network",
          name: "main",
          block: tfBlock([attr("name", tfString("main"))]),
        },
      ],
    });

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
}

resource "google_compute_network" "main" {
  name = "main"
}
`,
    );
  });

  it("throws on non-finite numbers rather than emitting invalid HCL", () => {
    expect(() =>
      serializeHcl(
        resourceOnly({
          resources: [
            {
              type: "google_compute_disk",
              name: "data",
              block: tfBlock([attr("size", tfNumber(Number.NaN))]),
            },
          ],
        }),
      ),
    ).toThrow(/non-finite/);
  });
});
