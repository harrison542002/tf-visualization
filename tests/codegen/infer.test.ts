import { describe, expect, it } from "vitest";

import {
  AWS_RULES,
  AZURE_RULES,
  GCP_RULES,
  inferConnections,
  inferProviderConnections,
} from "@/codegen/infer";
import type { FieldSchema, ResourceSchema } from "@/lib/providers/types";

const field = (key: string, type: FieldSchema["type"] = "string", required = false): FieldSchema => ({
  key,
  label: key,
  type,
  required,
});

const resource = (type: string, fields: readonly FieldSchema[]): ResourceSchema => ({
  type,
  displayName: type,
  category: "compute",
  description: "",
  fields,
  slots: [],
});

/** Runs inference against a fixed universe of resource types. */
const infer = (
  target: ResourceSchema,
  known: readonly string[],
  rules: Parameters<typeof inferConnections>[2],
) => inferConnections(target, new Set(known), rules);

describe("AWS inference", () => {
  it("reads an _id suffix as a reference to that resource", () => {
    const { slots } = infer(
      resource("aws_subnet", [field("vpc_id", "string", true)]),
      ["aws_subnet", "aws_vpc"],
      AWS_RULES,
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      id: "vpc_id",
      targetType: "aws_vpc",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    });
  });

  it("reads _arn as a reference that carries the arn", () => {
    const { slots } = infer(
      resource("aws_lambda_function", [field("role")]),
      ["aws_lambda_function", "aws_iam_role"],
      AWS_RULES,
    );
    expect(slots[0]).toMatchObject({ targetType: "aws_iam_role" });
  });

  it("treats a plural name as a many-cardinality slot", () => {
    const { slots } = infer(
      resource("aws_instance", [field("vpc_security_group_ids", "stringList")]),
      ["aws_instance", "aws_security_group"],
      AWS_RULES,
    );
    expect(slots[0]).toMatchObject({ targetType: "aws_security_group", cardinality: "many" });
  });

  it("emits nothing when the target type does not exist", () => {
    // The safety rail. `aws_widget` is not a real type, so no slot is invented.
    const { slots } = infer(
      resource("aws_thing", [field("widget_id")]),
      ["aws_thing"],
      AWS_RULES,
    );
    expect(slots).toEqual([]);
  });

  it("ignores denied names even when a matching type exists", () => {
    const { slots } = infer(
      resource("aws_instance", [field("key_name"), field("owner_id"), field("region")]),
      ["aws_instance", "aws_key", "aws_owner", "aws_region"],
      AWS_RULES,
    );
    expect(slots).toEqual([]);
  });

  it("never points a resource at itself", () => {
    const { slots } = infer(
      resource("aws_vpc", [field("vpc_id")]),
      ["aws_vpc"],
      AWS_RULES,
    );
    expect(slots).toEqual([]);
  });
});

describe("Azure inference", () => {
  it("maps _name references, which Azure uses for resource groups", () => {
    const { slots } = infer(
      resource("azurerm_subnet", [
        field("resource_group_name", "string", true),
        field("virtual_network_name", "string", true),
      ]),
      ["azurerm_subnet", "azurerm_resource_group", "azurerm_virtual_network"],
      AZURE_RULES,
    );

    expect(slots.map((slot) => [slot.targetType, slot.targetAttribute])).toEqual([
      ["azurerm_resource_group", "name"],
      ["azurerm_virtual_network", "name"],
    ]);
  });
});

describe("GCP inference", () => {
  it("resolves a bare name inside the owning product", () => {
    const { slots } = infer(
      resource("google_compute_subnetwork", [field("network", "string", true)]),
      ["google_compute_subnetwork", "google_compute_network", "google_network"],
      GCP_RULES,
    );
    // The product-scoped candidate wins over the bare one.
    expect(slots[0]?.targetType).toBe("google_compute_network");
  });

  it("does not treat project, region or zone as nodes", () => {
    const { slots } = infer(
      resource("google_compute_instance", [field("project"), field("region"), field("zone")]),
      ["google_compute_instance", "google_project", "google_region", "google_zone"],
      GCP_RULES,
    );
    expect(slots).toEqual([]);
  });
});

describe("nested references", () => {
  it("records the path to a reference inside a block", () => {
    const target = resource("azurerm_network_interface", [
      {
        key: "ip_configuration",
        label: "IP configuration",
        type: "block",
        nesting: "list",
        required: true,
        fields: [field("subnet_id")],
      },
    ]);

    const { slots } = infer(target, ["azurerm_network_interface", "azurerm_subnet"], AZURE_RULES);

    expect(slots[0]).toMatchObject({
      id: "subnet_id",
      targetType: "azurerm_subnet",
      path: ["ip_configuration"],
    });
  });
});

describe("fields promoted to slots", () => {
  it("keeps the field, so a literal is still typable", () => {
    // `image` may be a public image name or a reference; removing the field would make the
    // common case impossible to express.
    const { fields, slots } = infer(
      resource("google_compute_instance", [field("image")]),
      ["google_compute_instance", "google_compute_image"],
      GCP_RULES,
    );

    expect(slots).toHaveLength(1);
    expect(fields.map((entry) => entry.key)).toEqual(["image"]);
  });

  it("path-qualifies a colliding id instead of dropping the deeper slot", () => {
    const target = resource("aws_thing", [
      field("subnet_id"),
      {
        key: "config",
        label: "Config",
        type: "block",
        nesting: "single",
        required: false,
        fields: [field("subnet_id")],
      },
    ]);

    const { slots } = infer(target, ["aws_thing", "aws_subnet"], AWS_RULES);

    // Both are real references, so both get a handle. Ids stay unique for React Flow while
    // the Terraform attribute name is preserved separately.
    expect(slots.map((slot) => slot.id)).toEqual(["subnet_id", "config.subnet_id"]);
    expect(slots[0]?.attribute).toBeUndefined();
    expect(slots[1]).toMatchObject({ attribute: "subnet_id", path: ["config"] });
  });
});

describe("inferProviderConnections", () => {
  it("reports coverage and the most-referenced targets", () => {
    const { resources, stats } = inferProviderConnections(
      [
        resource("aws_vpc", [field("cidr_block")]),
        resource("aws_subnet", [field("vpc_id")]),
        resource("aws_instance", [field("subnet_id"), field("vpc_id")]),
      ],
      AWS_RULES,
    );

    expect(stats.resourcesWithSlots).toBe(2);
    expect(stats.slotsInferred).toBe(3);
    expect(stats.topTargets[0]).toEqual(["aws_vpc", 2]);
    expect(resources.find((entry) => entry.type === "aws_vpc")?.slots).toEqual([]);
  });
});

describe("requiredness of nested slots", () => {
  it("does not mark a slot required when an ancestor block is optional", () => {
    // `vpc_config.subnet_ids` is required within vpc_config, but vpc_config is optional, so
    // the resource does not need it and the node must not claim otherwise.
    const target = resource("aws_lambda_function", [
      {
        key: "vpc_config",
        label: "VPC config",
        type: "block",
        nesting: "list",
        required: false,
        fields: [field("subnet_ids", "stringList", true)],
      },
    ]);

    const { slots } = infer(target, ["aws_lambda_function", "aws_subnet"], AWS_RULES);
    expect(slots[0]).toMatchObject({ targetType: "aws_subnet", required: false });
  });

  it("keeps a slot required when every block above it is required", () => {
    const target = resource("azurerm_network_interface", [
      {
        key: "ip_configuration",
        label: "IP configuration",
        type: "block",
        nesting: "list",
        required: true,
        fields: [field("subnet_id", "string", true)],
      },
    ]);

    const { slots } = infer(target, ["azurerm_network_interface", "azurerm_subnet"], AZURE_RULES);
    expect(slots[0]).toMatchObject({ required: true });
  });
});
