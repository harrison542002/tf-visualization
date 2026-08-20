import { describe, expect, it } from "vitest";

import type { FieldSchema, ResourceSchema } from "@/lib/providers/types";
import { convertProviderSchema } from "@/codegen/convert";
import { decodeCty, describeCty } from "@/codegen/cty";
import { diffCatalogs, flattenFields } from "@/codegen/diff";
import { emitResourceModule } from "@/codegen/emit";
import { recoverEnumOptions } from "@/codegen/enums";
import { fixtureSchema } from "@/codegen/fixtures/provider-schema";
import { categoryFor, displayNameFor, labelFor } from "@/codegen/naming";

const converted = convertProviderSchema(fixtureSchema, { providerPrefix: "google_" });

const resource = (type: string): ResourceSchema => {
  const found = converted.resources.find((entry) => entry.type === type);
  if (!found) throw new Error(`fixture did not produce ${type}`);
  return found;
};

const field = (type: string, path: string): FieldSchema | undefined => {
  const segments = path.split(".");
  let fields: readonly FieldSchema[] = resource(type).fields;
  let match: FieldSchema | undefined;

  for (const segment of segments) {
    match = fields.find((entry) => entry.key === segment);
    if (!match) return undefined;
    fields = match.fields ?? [];
  }
  return match;
};

describe("decodeCty", () => {
  it("accepts the scalar types the editor can render", () => {
    expect(decodeCty("string")).toEqual({ ok: true, type: "string" });
    expect(decodeCty("number")).toEqual({ ok: true, type: "number" });
    expect(decodeCty("bool")).toEqual({ ok: true, type: "bool" });
  });

  it("treats a list or set of strings as a string list", () => {
    expect(decodeCty(["list", "string"])).toEqual({ ok: true, type: "stringList" });
    expect(decodeCty(["set", "string"])).toEqual({ ok: true, type: "stringList" });
  });

  it("rejects shapes it cannot represent, naming them for the skip report", () => {
    expect(decodeCty(["map", "string"])).toEqual({ ok: false, reason: "map(string)" });
    expect(decodeCty(["list", "number"])).toEqual({ ok: false, reason: "list(number)" });
    expect(decodeCty(["object", {}])).toMatchObject({ ok: false });
  });

  it("describes nested shapes readably", () => {
    expect(describeCty(["set", ["object", {}]])).toBe("set(object)");
  });
});

describe("recoverEnumOptions", () => {
  it("parses the bracketed form, which is how the Google provider writes constraints", () => {
    expect(recoverEnumOptions('Mode. Possible values: ["REGIONAL", "GLOBAL"]')).toEqual([
      "REGIONAL",
      "GLOBAL",
    ]);
  });

  it("parses prose lists", () => {
    expect(recoverEnumOptions("Possible values are: 'PENDING', 'ACCEPTED'")).toEqual([
      "PENDING",
      "ACCEPTED",
    ]);
    expect(recoverEnumOptions("Supported values include: STANDARD, NEARLINE, ARCHIVE.")).toEqual([
      "STANDARD",
      "NEARLINE",
      "ARCHIVE",
    ]);
  });

  it("returns nothing when there is no constraint to find", () => {
    expect(recoverEnumOptions("The name of the resource.")).toBeUndefined();
    expect(recoverEnumOptions(undefined)).toBeUndefined();
  });

  it("rejects a single value, which is prose mentioning a default rather than an enum", () => {
    expect(recoverEnumOptions('Possible values: ["ONLY"]')).toBeUndefined();
  });

  it("rejects sentence fragments that merely look like a list", () => {
    expect(
      recoverEnumOptions("Possible values are: whatever the user decides to type here"),
    ).toBeUndefined();
  });
});

describe("naming", () => {
  it("drops the product segment so names read naturally", () => {
    expect(displayNameFor("google_compute_subnetwork", "google_")).toBe("Subnetwork");
    expect(displayNameFor("aws_s3_bucket", "aws_")).toBe("Bucket");
  });

  it("preserves acronyms", () => {
    expect(labelFor("ip_cidr_range")).toBe("IP Cidr Range");
    expect(labelFor("vpc_id")).toBe("VPC ID");
  });

  it("classifies networking before compute, since network resources sit under compute", () => {
    expect(categoryFor("google_compute_firewall")).toBe("network");
    expect(categoryFor("google_compute_instance")).toBe("compute");
    expect(categoryFor("google_storage_bucket")).toBe("storage");
    expect(categoryFor("google_service_account")).toBe("iam");
    expect(categoryFor("google_project_service")).toBe("project");
  });
});

describe("convertProviderSchema", () => {
  it("emits every resource in the schema, sorted for a readable diff", () => {
    expect(converted.resources.map((entry) => entry.type)).toEqual([
      "google_compute_subnetwork",
      "google_storage_bucket",
    ]);
  });

  it("carries required through from the schema", () => {
    expect(field("google_compute_subnetwork", "name")?.required).toBe(true);
  });

  it("treats optional+computed as an input, not an output", () => {
    // The provider can fill this in, but the user may also set it, so it must be editable.
    expect(field("google_compute_subnetwork", "ip_cidr_range")).toBeDefined();
    expect(field("google_compute_subnetwork", "ip_cidr_range")?.required).toBe(false);
  });

  it("drops read-only attributes, which are outputs", () => {
    expect(field("google_compute_subnetwork", "gateway_address")).toBeUndefined();
    expect(converted.stats.computedSkipped).toBe(1);
  });

  it("drops deprecated attributes", () => {
    expect(field("google_compute_subnetwork", "deprecated_field")).toBeUndefined();
    expect(converted.stats.deprecatedSkipped).toBe(1);
  });

  it("promotes a string to an enum when the description declares the values", () => {
    const purpose = field("google_compute_subnetwork", "purpose");
    expect(purpose?.type).toBe("enum");
    expect(purpose?.options).toEqual(["PRIVATE", "REGIONAL_MANAGED_PROXY"]);
    expect(converted.stats.enumsRecovered).toBe(2);
  });

  it("maps nested block types to block fields, preserving nesting mode", () => {
    const logConfig = field("google_compute_subnetwork", "log_config");
    expect(logConfig?.type).toBe("block");
    expect(logConfig?.nesting).toBe("list");
    expect(logConfig?.maxItems).toBe(1);
    expect(field("google_compute_subnetwork", "log_config.aggregation_interval")?.type).toBe("enum");
  });

  it("treats a minimum repetition count as required", () => {
    expect(field("google_compute_subnetwork", "secondary_ip_range")?.required).toBe(true);
    expect(field("google_compute_subnetwork", "log_config")?.required).toBe(false);
  });

  it("records unsupported types rather than silently dropping them", () => {
    expect(field("google_compute_subnetwork", "labels")).toBeUndefined();
    expect(converted.stats.unsupportedTypes).toEqual({ "map(string)": 1 });
  });

  it("never infers slots — provider schemas carry no reference information", () => {
    for (const entry of converted.resources) expect(entry.slots).toEqual([]);
  });

  it("honours the include filter", () => {
    const filtered = convertProviderSchema(fixtureSchema, {
      providerPrefix: "google_",
      include: (type) => type === "google_storage_bucket",
    });
    expect(filtered.resources).toHaveLength(1);
    expect(filtered.stats.resourcesInSchema).toBe(2);
  });
});

describe("emitResourceModule", () => {
  const source = emitResourceModule(converted.resources, {
    providerName: "Google Cloud",
    providerVersion: "test",
  });

  it("emits a module that imports the shared type", () => {
    expect(source).toContain('import type { ResourceSchema } from "@/lib/providers/types";');
    expect(source).toContain("export const generatedResources: readonly ResourceSchema[] = [");
  });

  it("marks the file as generated", () => {
    expect(source).toContain("do not edit by hand");
  });

  it("renders nested block fields", () => {
    expect(source).toContain('key: "log_config"');
    expect(source).toContain('nesting: "list"');
    expect(source).toContain('key: "aggregation_interval"');
  });

  it("quotes keys that are not bare identifiers", () => {
    expect(source).not.toContain('"key":');
  });
});

describe("diffCatalogs", () => {
  it("flattens nested fields to dotted paths", () => {
    const paths = flattenFields(resource("google_compute_subnetwork").fields).map(
      (entry) => entry.path,
    );
    expect(paths).toContain("log_config");
    expect(paths).toContain("log_config.aggregation_interval");
  });

  it("reports slots as lost, since conversion cannot produce them", () => {
    const handWritten: ResourceSchema = {
      ...resource("google_storage_bucket"),
      slots: [
        {
          id: "project",
          label: "Project",
          targetType: "google_project",
          targetAttribute: "id",
          cardinality: "one",
          required: false,
        },
      ],
    };

    const summary = diffCatalogs([handWritten], converted.resources);
    expect(summary.totals.slotsLost).toBe(1);
    expect(summary.diffs[0]?.slotsLost).toEqual(["project -> google_project.id"]);
  });

  it("reports defaults and enum options as lost metadata", () => {
    const handWritten: ResourceSchema = {
      ...resource("google_storage_bucket"),
      fields: [
        {
          key: "force_destroy",
          label: "Force destroy",
          type: "bool",
          required: false,
          defaultValue: false,
        },
      ],
    };

    const summary = diffCatalogs([handWritten], converted.resources);
    expect(summary.totals.defaultsLost).toBe(1);
  });

  it("flags a resource the generator did not produce", () => {
    const handWritten: ResourceSchema = {
      type: "google_nonexistent",
      displayName: "Nope",
      category: "project",
      description: "",
      fields: [],
      slots: [],
    };

    const summary = diffCatalogs([handWritten], converted.resources);
    expect(summary.missingFromGenerated).toEqual(["google_nonexistent"]);
  });
});

describe("field budget", () => {
  /** A schema that nests one block inside another for `depth` levels. */
  const deepSchema = (depth: number) => {
    let block: Record<string, unknown> = {
      attributes: { leaf: { type: "string", description: "Leaf.", optional: true } },
    };
    for (let level = 0; level < depth; level += 1) {
      block = {
        attributes: {
          a: { type: "string", optional: true },
          b: { type: "string", optional: true },
        },
        block_types: { nested: { nesting_mode: "list", block } },
      };
    }
    return {
      provider_schemas: {
        test: { resource_schemas: { google_deep: { block } }, data_source_schemas: {} },
      },
    } as never;
  };

  it("stops expanding once a resource exceeds its budget, and names it", () => {
    const result = convertProviderSchema(deepSchema(12), {
      providerPrefix: "google_",
      maxFieldsPerResource: 10,
    });

    expect(result.stats.budgetTruncated).toBeGreaterThan(0);
    expect(result.stats.budgetTruncatedResources).toEqual(["google_deep"]);
  });

  it("leaves ordinary resources untouched", () => {
    const result = convertProviderSchema(fixtureSchema, {
      providerPrefix: "google_",
      maxFieldsPerResource: 2000,
    });

    expect(result.stats.budgetTruncated).toBe(0);
    expect(result.stats.budgetTruncatedResources).toEqual([]);
  });

  it("applies the budget per resource rather than across the whole run", () => {
    const result = convertProviderSchema(fixtureSchema, {
      providerPrefix: "google_",
      maxFieldsPerResource: 6,
    });

    // Both resources are still emitted; only their nested expansion is capped.
    expect(result.resources).toHaveLength(2);
  });
});
