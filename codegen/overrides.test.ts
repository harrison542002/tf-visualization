import { describe, expect, it } from "vitest";

import type { FieldSchema, ResourceSchema } from "@/lib/providers/types";
import { emitResourceModule } from "./emit";
import { applyOverrides, type ProviderOverrides } from "./overrides";
import { awsOverrides } from "./overrides/aws";
import { azureOverrides } from "./overrides/azure";

/** Stands in for conversion output: fields present, slots always empty. */
const generated: readonly ResourceSchema[] = [
  {
    type: "aws_vpc",
    displayName: "Vpc",
    category: "project",
    description: "",
    fields: [
      { key: "cidr_block", label: "Cidr Block", type: "string", required: false },
      { key: "instance_tenancy", label: "Instance Tenancy", type: "string", required: false },
      { key: "enable_dns_support", label: "Enable Dns Support", type: "bool", required: false },
    ],
    slots: [],
  },
  {
    type: "aws_subnet",
    displayName: "Subnet",
    category: "project",
    description: "",
    fields: [
      { key: "cidr_block", label: "Cidr Block", type: "string", required: false },
      {
        key: "ip_configuration",
        label: "Ip Configuration",
        type: "block",
        nesting: "list",
        required: false,
        fields: [
          { key: "name", label: "Name", type: "string", required: false },
          { key: "primary", label: "Primary", type: "bool", required: false },
        ],
      },
    ],
    slots: [],
  },
];

const find = (resources: readonly ResourceSchema[], type: string): ResourceSchema => {
  const match = resources.find((entry) => entry.type === type);
  if (!match) throw new Error(`expected ${type}`);
  return match;
};

const pathsOf = (fields: readonly FieldSchema[], prefix = ""): string[] =>
  fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    return [path, ...(field.fields ? pathsOf(field.fields, path) : [])];
  });

describe("applyOverrides", () => {
  it("narrows to tier-1 and keeps that order, since palette order is a curation decision", () => {
    const result = applyOverrides(generated, { tier1: ["aws_subnet", "aws_vpc"] });
    expect(result.resources.map((entry) => entry.type)).toEqual(["aws_subnet", "aws_vpc"]);
  });

  it("reports a tier-1 entry the schema does not contain rather than dropping it silently", () => {
    const result = applyOverrides(generated, { tier1: ["aws_vpc", "aws_typo"] });
    expect(result.missing).toEqual(["aws_typo"]);
    expect(result.resources).toHaveLength(1);
  });

  it("adds the slots that conversion cannot produce", () => {
    const overrides: ProviderOverrides = {
      tier1: ["aws_subnet"],
      resources: {
        aws_subnet: {
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
        },
      },
    };

    const subnet = find(applyOverrides(generated, overrides).resources, "aws_subnet");
    expect(subnet.slots).toHaveLength(1);
    expect(subnet.slots[0]?.targetType).toBe("aws_vpc");
  });

  it("narrows fields to keepFields, in that order", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_vpc"],
      resources: { aws_vpc: { keepFields: ["enable_dns_support", "cidr_block"] } },
    });

    expect(pathsOf(find(result.resources, "aws_vpc").fields)).toEqual([
      "enable_dns_support",
      "cidr_block",
    ]);
  });

  it("keeps nothing when keepFields is empty, for resources that are only connections", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_vpc"],
      resources: { aws_vpc: { keepFields: [] } },
    });
    expect(find(result.resources, "aws_vpc").fields).toEqual([]);
  });

  it("follows nested paths, keeping only the named children of a block", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_subnet"],
      resources: { aws_subnet: { keepFields: ["ip_configuration", "ip_configuration.name"] } },
    });

    expect(pathsOf(find(result.resources, "aws_subnet").fields)).toEqual([
      "ip_configuration",
      "ip_configuration.name",
    ]);
  });

  it("keeps a whole block when it is listed without any children", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_subnet"],
      resources: { aws_subnet: { keepFields: ["ip_configuration"] } },
    });

    expect(pathsOf(find(result.resources, "aws_subnet").fields)).toEqual([
      "ip_configuration",
      "ip_configuration.name",
      "ip_configuration.primary",
    ]);
  });

  it("applies defaults, requiredness and display metadata", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_vpc"],
      resources: {
        aws_vpc: {
          displayName: "VPC",
          category: "network",
          description: "Isolated network.",
          fields: { cidr_block: { required: true, defaultValue: "10.0.0.0/16" } },
        },
      },
    });

    const vpc = find(result.resources, "aws_vpc");
    expect(vpc.displayName).toBe("VPC");
    expect(vpc.category).toBe("network");
    expect(vpc.description).toBe("Isolated network.");
    expect(vpc.fields[0]).toMatchObject({ required: true, defaultValue: "10.0.0.0/16" });
  });

  it("promotes a string to an enum when options are supplied", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_vpc"],
      resources: {
        aws_vpc: { fields: { instance_tenancy: { options: ["default", "dedicated"] } } },
      },
    });

    const field = find(result.resources, "aws_vpc").fields.find(
      (entry) => entry.key === "instance_tenancy",
    );
    expect(field?.type).toBe("enum");
    expect(field?.options).toEqual(["default", "dedicated"]);
  });

  it("reaches overrides into nested block fields by path", () => {
    const result = applyOverrides(generated, {
      tier1: ["aws_subnet"],
      resources: {
        aws_subnet: { fields: { "ip_configuration.name": { defaultValue: "internal" } } },
      },
    });

    const block = find(result.resources, "aws_subnet").fields.find(
      (entry) => entry.key === "ip_configuration",
    );
    const name = block?.fields?.find((entry) => entry.key === "name");
    expect(name?.defaultValue).toBe("internal");
  });
});

describe("emitted slots", () => {
  // Regression: the emitter once hardcoded `slots: []`, silently discarding every curated
  // connection and leaving the catalog unwirable.
  it("renders curated slots into the generated module", () => {
    const overrides: ProviderOverrides = {
      tier1: ["aws_subnet"],
      resources: {
        aws_subnet: {
          slots: [
            {
              id: "vpc_id",
              label: "VPC",
              targetType: "aws_vpc",
              targetAttribute: "id",
              cardinality: "one",
              required: true,
              path: ["ip_configuration"],
            },
          ],
        },
      },
    };

    const { resources } = applyOverrides(generated, overrides);
    const source = emitResourceModule(resources, {
      providerName: "AWS",
      providerVersion: "test",
      curated: true,
    });

    expect(source).toContain('targetType: "aws_vpc"');
    expect(source).toContain('targetAttribute: "id"');
    expect(source).toContain('path: ["ip_configuration"]');
    expect(source).not.toContain("slots: [],");
  });
});

describe("shipped override files", () => {
  const cases = [
    ["aws", awsOverrides],
    ["azure", azureOverrides],
  ] as const;

  it.each(cases)("%s lists no duplicate tier-1 entries", (_id, overrides) => {
    expect(new Set(overrides.tier1).size).toBe(overrides.tier1.length);
  });

  it.each(cases)("%s only overrides resources it also ships", (_id, overrides) => {
    const tier1 = new Set(overrides.tier1);
    for (const type of Object.keys(overrides.resources ?? {})) {
      expect(tier1.has(type), `${type} is overridden but not in tier1`).toBe(true);
    }
  });

  it.each(cases)("%s points every slot at another tier-1 resource", (_id, overrides) => {
    const tier1 = new Set(overrides.tier1);
    for (const [type, override] of Object.entries(overrides.resources ?? {})) {
      for (const slot of override.slots ?? []) {
        expect(tier1.has(slot.targetType), `${type}.${slot.id} targets ${slot.targetType}`).toBe(
          true,
        );
      }
    }
  });
});
