/**
 * Structural checks over the whole catalog.
 *
 * These are deliberately generic: they run against every provider and every resource, so a
 * contributor adding a schema gets told about a dangling slot or a default that is not one of
 * the declared options without having to write a test for their new file.
 */

import { describe, expect, it } from "vitest";

import { findResourceSchema, getProvider, getResourceSchema, providers } from "./registry";
import type { FieldSchema, ProviderDefinition } from "./types";

const implemented = providers.filter((provider) => provider.available);

const describeField = (providerId: string, resourceType: string, field: FieldSchema): string =>
  `${providerId}.${resourceType}.${field.key}`;

describe("registry lookups", () => {
  it("returns a provider by id", () => {
    expect(getProvider("gcp").displayName).toBe("Google Cloud");
  });

  it("throws for an unknown provider", () => {
    // @ts-expect-error -- exercising the runtime guard with an id outside ProviderId.
    expect(() => getProvider("digitalocean")).toThrow(/Unknown provider/);
  });

  it("returns undefined rather than throwing for an unknown resource type", () => {
    expect(findResourceSchema("gcp", "google_nonexistent")).toBeUndefined();
    expect(() => getResourceSchema("gcp", "google_nonexistent")).toThrow(/Unknown resource type/);
  });

  it("lists gcp as available and aws and azure as coming soon", () => {
    expect(getProvider("gcp").available).toBe(true);
    expect(getProvider("aws").available).toBe(false);
    expect(getProvider("azure").available).toBe(false);
  });
});

describe("catalog integrity", () => {
  it("has at least one implemented provider", () => {
    expect(implemented.length).toBeGreaterThan(0);
  });

  it("gives every provider a unique id", () => {
    const ids = providers.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(implemented.map((provider): [string, ProviderDefinition] => [provider.id, provider]))(
    "%s",
    (providerId, provider) => {
      it("declares unique resource types", () => {
        const types = provider.resources.map((resource) => resource.type);
        expect(new Set(types).size).toBe(types.length);
      });

      it("uses valid Terraform resource type names", () => {
        for (const resource of provider.resources) {
          expect(resource.type).toMatch(/^[a-z][a-z0-9_]*$/);
        }
      });

      it("points every slot at a resource type the provider defines", () => {
        for (const resource of provider.resources) {
          for (const slot of resource.slots) {
            expect(
              findResourceSchema(provider.id, slot.targetType),
              `${providerId}.${resource.type} slot "${slot.id}" targets unknown type "${slot.targetType}"`,
            ).toBeDefined();
          }
        }
      });

      it("keeps field keys and slot ids unique within a resource", () => {
        for (const resource of provider.resources) {
          const fieldKeys = resource.fields.map((field) => field.key);
          const slotIds = resource.slots.map((slot) => slot.id);
          expect(new Set(fieldKeys).size, `duplicate field key in ${resource.type}`).toBe(
            fieldKeys.length,
          );
          expect(new Set(slotIds).size, `duplicate slot id in ${resource.type}`).toBe(
            slotIds.length,
          );
          // Both become attribute keys, so a collision would silently drop one.
          const overlap = fieldKeys.filter((key) => slotIds.includes(key));
          expect(overlap, `${resource.type} has a field and slot sharing a key`).toEqual([]);
        }
      });

      it("gives every enum field options that include its default", () => {
        for (const resource of provider.resources) {
          for (const field of resource.fields) {
            const label = describeField(providerId, resource.type, field);
            if (field.type === "enum") {
              expect(field.options, `${label} is an enum with no options`).toBeDefined();
              expect(field.options?.length ?? 0).toBeGreaterThan(0);
              if (field.defaultValue !== undefined) {
                expect(field.options, `${label} default is not one of its options`).toContain(
                  field.defaultValue,
                );
              }
            } else {
              expect(field.options, `${label} is not an enum but declares options`).toBeUndefined();
            }
          }
        }
      });

      it("gives every default a value matching its declared type", () => {
        for (const resource of provider.resources) {
          for (const field of [...resource.fields, ...provider.providerFields]) {
            if (field.defaultValue === undefined) continue;
            const label = describeField(providerId, resource.type, field);

            switch (field.type) {
              case "string":
              case "enum":
                expect(typeof field.defaultValue, label).toBe("string");
                break;
              case "number":
                expect(typeof field.defaultValue, label).toBe("number");
                break;
              case "bool":
                expect(typeof field.defaultValue, label).toBe("boolean");
                break;
              case "stringList":
                expect(Array.isArray(field.defaultValue), label).toBe(true);
                break;
            }
          }
        }
      });

      it("marks required fields on every resource so output is never half-formed", () => {
        for (const resource of provider.resources) {
          expect(
            resource.fields.some((field) => field.required),
            `${resource.type} has no required fields`,
          ).toBe(true);
        }
      });
    },
  );
});
