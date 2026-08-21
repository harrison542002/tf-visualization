import { describe, expect, it } from "vitest";

import { findReferences, parseHcl, type HclBlock } from "@/lib/terraform/parse";

const only = (source: string): HclBlock => {
  const { blocks, errors } = parseHcl(source);
  expect(errors).toEqual([]);
  const [block] = blocks;
  if (!block) throw new Error("expected one block");
  return block;
};

const attr = (block: HclBlock, key: string) =>
  block.attributes.find((entry) => entry.key === key)?.value;

describe("parseHcl", () => {
  it("reads a block with its labels", () => {
    const block = only(`resource "google_compute_network" "main" {}`);
    expect(block.type).toBe("resource");
    expect(block.labels).toEqual(["google_compute_network", "main"]);
  });

  it("reads scalar attributes", () => {
    const block = only(`resource "x" "y" {
      name    = "main"
      mtu     = 1460
      enabled = true
      nothing = null
    }`);

    expect(attr(block, "name")).toEqual({ kind: "string", value: "main" });
    expect(attr(block, "mtu")).toEqual({ kind: "number", value: 1460 });
    expect(attr(block, "enabled")).toEqual({ kind: "bool", value: true });
    expect(attr(block, "nothing")).toEqual({ kind: "null" });
  });

  it("reads lists and objects", () => {
    const block = only(`resource "x" "y" {
      ports  = ["22", "80"]
      labels = { env = "prod", team = "infra" }
    }`);

    expect(attr(block, "ports")).toEqual({
      kind: "list",
      items: [
        { kind: "string", value: "22" },
        { kind: "string", value: "80" },
      ],
    });
    expect(attr(block, "labels")).toMatchObject({ kind: "object" });
  });

  it("reads nested blocks, repeated ones included", () => {
    const block = only(`resource "x" "y" {
      network_interface {
        subnetwork = "a"
      }
      network_interface {
        subnetwork = "b"
      }
    }`);

    expect(block.blocks).toHaveLength(2);
    expect(attr(block.blocks[0]!, "subnetwork")).toEqual({ kind: "string", value: "a" });
  });

  it("keeps an unevaluated expression verbatim rather than guessing", () => {
    const block = only(`resource "x" "y" {
      network = google_compute_network.main.id
      region  = var.region
      name    = join("-", [var.prefix, "web"])
    }`);

    expect(attr(block, "network")).toEqual({
      kind: "expression",
      text: "google_compute_network.main.id",
    });
    expect(attr(block, "region")).toEqual({ kind: "expression", text: "var.region" });
    // The comma inside the function call must not end the expression early.
    expect(attr(block, "name")).toMatchObject({
      kind: "expression",
      text: 'join("-", [var.prefix, "web"])',
    });
  });

  it("treats an interpolated string as an expression, not a literal", () => {
    const block = only(`resource "x" "y" {
      name = "prefix-\${var.env}"
    }`);
    expect(attr(block, "name")).toMatchObject({ kind: "expression" });
  });

  it("keeps an escaped interpolation as a literal string", () => {
    const block = only(`resource "x" "y" {
      description = "costs $\${amount}"
    }`);
    expect(attr(block, "description")).toMatchObject({ kind: "string" });
  });

  it("skips comments in all three syntaxes", () => {
    const block = only(`resource "x" "y" {
      # hash
      // slashes
      /* block
         comment */
      name = "main" # trailing
    }`);
    expect(attr(block, "name")).toEqual({ kind: "string", value: "main" });
  });

  it("reads a heredoc", () => {
    const block = only(`resource "x" "y" {
      policy = <<-EOT
      line one
      line two
      EOT
      name = "after"
    }`);

    expect(attr(block, "policy")).toMatchObject({ kind: "string" });
    // Parsing must resume correctly after the heredoc terminator.
    expect(attr(block, "name")).toEqual({ kind: "string", value: "after" });
  });

  it("unescapes quotes and newlines", () => {
    const block = only(`resource "x" "y" {
      text = "say \\"hi\\"\\nbye"
    }`);
    expect(attr(block, "text")).toEqual({ kind: "string", value: 'say "hi"\nbye' });
  });

  it("parses several top-level blocks", () => {
    const { blocks, errors } = parseHcl(`
      terraform {
        required_providers {
          google = { source = "hashicorp/google" }
        }
      }

      provider "google" {
        project = "my-project"
      }

      resource "google_compute_network" "main" {
        name = "main"
      }
    `);

    expect(errors).toEqual([]);
    expect(blocks.map((block) => block.type)).toEqual(["terraform", "provider", "resource"]);
  });

  it("reports an unterminated block instead of throwing", () => {
    const { errors } = parseHcl(`resource "x" "y" {`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toMatch(/unterminated/);
  });

  it("reports an unterminated string", () => {
    const { errors } = parseHcl(`resource "x" "y" { name = "oops }`);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("findReferences", () => {
  it("finds a resource reference", () => {
    expect(findReferences("google_compute_network.main.id")).toEqual([
      { resourceType: "google_compute_network", localName: "main", attribute: "id" },
    ]);
  });

  it("finds references inside an interpolation", () => {
    expect(findReferences('"${aws_vpc.main.id}"')).toHaveLength(1);
  });

  it("finds several in one expression", () => {
    const found = findReferences("[aws_subnet.a.id, aws_subnet.b.id]");
    expect(found.map((reference) => reference.localName)).toEqual(["a", "b"]);
  });

  it("ignores things that are not resources", () => {
    expect(findReferences("var.region")).toEqual([]);
    expect(findReferences("local.name.value")).toEqual([]);
    expect(findReferences("data.aws_ami.ubuntu.id")).toEqual([]);
    expect(findReferences("each.value.name")).toEqual([]);
  });
});
