import { beforeEach, describe, expect, it } from "vitest";

import { importTerraform } from "@/lib/graph/import";
import { primeCache, resetCatalogCache } from "@/lib/providers/catalog";
import type { ResourceSchema } from "@/lib/providers/types";

const vpc: ResourceSchema = {
  type: "aws_vpc",
  displayName: "VPC",
  category: "network",
  description: "",
  fields: [
    { key: "cidr_block", label: "CIDR", type: "string", required: true },
    { key: "enable_dns_support", label: "DNS", type: "bool", required: false },
  ],
  slots: [],
};

const subnet: ResourceSchema = {
  type: "aws_subnet",
  displayName: "Subnet",
  category: "network",
  description: "",
  fields: [
    { key: "cidr_block", label: "CIDR", type: "string", required: true },
    { key: "vpc_id", label: "VPC", type: "string", required: true },
  ],
  slots: [
    {
      id: "vpc_id",
      label: "VPC",
      targetType: "aws_vpc",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    },
  ],
};

const instance: ResourceSchema = {
  type: "aws_instance",
  displayName: "Instance",
  category: "compute",
  description: "",
  fields: [
    { key: "ami", label: "AMI", type: "string", required: true },
    { key: "tags", label: "Tags", type: "stringList", required: false },
    {
      key: "network_interface",
      label: "Network interface",
      type: "block",
      nesting: "list",
      required: false,
      fields: [{ key: "subnet_id", label: "Subnet", type: "string", required: false }],
    },
  ],
  slots: [
    {
      id: "subnet_id",
      label: "Subnet",
      targetType: "aws_subnet",
      targetAttribute: "id",
      cardinality: "one",
      required: false,
      path: ["network_interface"],
    },
  ],
};

const run = (source: string) => importTerraform({ providerId: "aws", source });

beforeEach(() => {
  resetCatalogCache();
  primeCache("aws", [vpc, subnet, instance]);
});

describe("importTerraform", () => {
  it("creates a node per resource block", async () => {
    const result = await run(`
      resource "aws_vpc" "main" {
        cidr_block = "10.0.0.0/16"
      }
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.main.id
      }
    `);

    expect(result.imported).toBe(2);
    expect(result.nodes.map((node) => node.data.localName)).toEqual(["main", "web"]);
    expect(result.nodes[0]?.data.fields["cidr_block"]).toBe("10.0.0.0/16");
  });

  it("turns a reference into an edge on the matching slot", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.main.id
      }
    `);

    expect(result.edges).toHaveLength(1);
    const [edge] = result.edges;
    const byName = new Map(result.nodes.map((node) => [node.data.localName, node.id]));
    expect(edge?.source).toBe(byName.get("main"));
    expect(edge?.target).toBe(byName.get("web"));
    expect(edge?.targetHandle).toBe("vpc_id");
  });

  it("does not also keep the reference as a literal field value", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.main.id
      }
    `);

    const web = result.nodes.find((node) => node.data.localName === "web");
    expect(web?.data.fields["vpc_id"]).toBeUndefined();
  });

  it("reads a reference inside a nested block onto a pathed slot", async () => {
    const result = await run(`
      resource "aws_subnet" "web" { cidr_block = "10.0.1.0/24" }
      resource "aws_instance" "app" {
        ami = "ami-123"
        network_interface {
          subnet_id = aws_subnet.web.id
        }
      }
    `);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]?.targetHandle).toBe("subnet_id");
  });

  it("maps a repeated block to a list of entries", async () => {
    const result = await run(`
      resource "aws_instance" "app" {
        ami = "ami-123"
        network_interface {}
        network_interface {}
      }
    `);

    const app = result.nodes[0];
    expect(Array.isArray(app?.data.fields["network_interface"])).toBe(true);
    expect((app?.data.fields["network_interface"] as unknown[]).length).toBe(2);
  });

  it("lays the graph out instead of stacking everything at the origin", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.main.id
      }
    `);

    const positions = result.nodes.map((node) => node.position.x);
    expect(new Set(positions).size).toBe(2);
  });

  it("recovers provider settings", async () => {
    const result = await run(`
      provider "aws" { region = "eu-west-1" }
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
    `);
    expect(result.providerSettings["region"]).toBe("eu-west-1");
  });

  it("reads Terraform JSON syntax as well as HCL", async () => {
    const result = await run(
      JSON.stringify({
        resource: {
          aws_vpc: { main: { cidr_block: "10.0.0.0/16" } },
          aws_subnet: { web: { cidr_block: "10.0.1.0/24", vpc_id: "${aws_vpc.main.id}" } },
        },
      }),
    );

    expect(result.imported).toBe(2);
    expect(result.edges).toHaveLength(1);
  });
});

describe("import diagnostics", () => {
  it("reports a resource type the catalog does not have, and keeps going", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
      resource "aws_unicorn" "sparkle" { magic = true }
    `);

    expect(result.imported).toBe(1);
    expect(result.issues.some((issue) => issue.kind === "unknown-resource-type")).toBe(true);
  });

  it("reports an expression it cannot evaluate rather than inventing a literal", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = var.cidr }
    `);

    const issue = result.issues.find((entry) => entry.kind === "unsupported-value");
    expect(issue?.message).toContain("cidr_block");
    expect(result.nodes[0]?.data.fields["cidr_block"]).toBeUndefined();
  });

  it("reports a reference with no matching connection point", async () => {
    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = aws_vpc.other.id }
    `);
    expect(result.issues.some((issue) => issue.kind === "unmatched-reference")).toBe(true);
  });

  it("reports a reference to a resource that was not imported", async () => {
    const result = await run(`
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.missing.id
      }
    `);

    expect(result.edges).toEqual([]);
    expect(result.issues.some((issue) => issue.message.includes("aws_vpc.missing"))).toBe(true);
  });

  it("reports an attribute the schema does not declare", async () => {
    const result = await run(`
      resource "aws_vpc" "main" {
        cidr_block   = "10.0.0.0/16"
        made_up_flag = true
      }
    `);
    expect(result.issues.some((issue) => issue.kind === "unknown-attribute")).toBe(true);
  });

  it("does not complain about terraform, variable or output blocks", async () => {
    const result = await run(`
      terraform { required_version = ">= 1.0" }
      variable "region" { type = string }
      output "vpc_id" { value = aws_vpc.main.id }
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
    `);

    expect(result.issues.some((issue) => issue.kind === "skipped-block")).toBe(false);
    expect(result.imported).toBe(1);
  });

  it("reports a syntax error instead of throwing", async () => {
    const result = await run(`resource "aws_vpc" "main" {`);
    expect(result.issues.some((issue) => issue.kind === "syntax")).toBe(true);
  });

  it("reports invalid JSON clearly", async () => {
    const result = await run(`{ "resource": `);
    expect(result.issues[0]?.kind).toBe("syntax");
    expect(result.imported).toBe(0);
  });
});

describe("slot-backed attributes", () => {
  it("does not report a slot-backed attribute as missing from the schema", async () => {
    // Curated resources drop the attribute from `fields` because the slot carries it, so the
    // unknown-attribute check has to know about slots or it fires on every connection.
    const curatedSubnet: ResourceSchema = {
      ...subnet,
      fields: [{ key: "cidr_block", label: "CIDR", type: "string", required: true }],
    };
    resetCatalogCache();
    primeCache("aws", [vpc, curatedSubnet]);

    const result = await run(`
      resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
      resource "aws_subnet" "web" {
        cidr_block = "10.0.1.0/24"
        vpc_id     = aws_vpc.main.id
      }
    `);

    expect(result.edges).toHaveLength(1);
    expect(result.issues.filter((issue) => issue.kind === "unknown-attribute")).toEqual([]);
  });
});
