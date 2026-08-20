import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachedSchema,
  loadCatalogIndex,
  loadResourceSchema,
  primeCache,
  resetCatalogCache,
} from "./catalog";
import type { ResourceSchema } from "./types";

const schema = (type: string): ResourceSchema => ({
  type,
  displayName: type,
  category: "compute",
  description: "",
  fields: [],
  slots: [],
});

const jsonResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

const notFound = (): Response => ({ ok: false, status: 404, json: async () => ({}) }) as Response;

const failure = (status: number): Response =>
  ({ ok: false, status, json: async () => ({}) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetCatalogCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadResourceSchema", () => {
  it("fetches from the provider's catalog directory", async () => {
    fetchMock.mockResolvedValue(jsonResponse(schema("aws_lambda_function")));

    const result = await loadResourceSchema("aws", "aws_lambda_function");

    expect(fetchMock).toHaveBeenCalledWith("/catalog/aws/r/aws_lambda_function.json");
    expect(result?.type).toBe("aws_lambda_function");
  });

  it("caches, so the same resource is fetched once", async () => {
    fetchMock.mockResolvedValue(jsonResponse(schema("aws_vpc")));

    await loadResourceSchema("aws", "aws_vpc");
    await loadResourceSchema("aws", "aws_vpc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between concurrent callers", async () => {
    // Dropping several of the same resource at once must not fire several requests.
    fetchMock.mockResolvedValue(jsonResponse(schema("aws_subnet")));

    await Promise.all([
      loadResourceSchema("aws", "aws_subnet"),
      loadResourceSchema("aws", "aws_subnet"),
      loadResourceSchema("aws", "aws_subnet"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves undefined for a resource the provider does not have", async () => {
    fetchMock.mockResolvedValue(notFound());
    await expect(loadResourceSchema("aws", "aws_nope")).resolves.toBeUndefined();
  });

  it("throws on a real transport failure, which is not the same as a missing resource", async () => {
    fetchMock.mockResolvedValue(failure(500));
    await expect(loadResourceSchema("aws", "aws_vpc")).rejects.toThrow(/500/);
  });

  it("does not leave a failed request pending, so a retry can succeed", async () => {
    fetchMock.mockResolvedValueOnce(failure(500));
    await expect(loadResourceSchema("aws", "aws_vpc")).rejects.toThrow();

    fetchMock.mockResolvedValueOnce(jsonResponse(schema("aws_vpc")));
    await expect(loadResourceSchema("aws", "aws_vpc")).resolves.toMatchObject({ type: "aws_vpc" });
  });

  it("keeps providers separate, so the same type name cannot collide", async () => {
    primeCache("gcp", [schema("shared_name")]);
    fetchMock.mockResolvedValue(jsonResponse({ ...schema("shared_name"), displayName: "AWS one" }));

    const fromAws = await loadResourceSchema("aws", "shared_name");

    expect(fromAws?.displayName).toBe("AWS one");
    expect(getCachedSchema("gcp", "shared_name")?.displayName).toBe("shared_name");
  });
});

describe("primeCache", () => {
  it("makes bundled resources available without any request", async () => {
    primeCache("aws", [schema("aws_vpc")]);

    expect(getCachedSchema("aws", "aws_vpc")).toBeDefined();
    await loadResourceSchema("aws", "aws_vpc");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadCatalogIndex", () => {
  it("returns the entries and caches them", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        provider: "aws",
        providerVersion: "test",
        generatedResources: 1,
        entries: [
          {
            type: "aws_vpc",
            displayName: "VPC",
            category: "network",
            description: "",
            curated: true,
          },
        ],
      }),
    );

    const first = await loadCatalogIndex("aws");
    const second = await loadCatalogIndex("aws");

    expect(first).toHaveLength(1);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the index is missing, since search depends on it", async () => {
    fetchMock.mockResolvedValue(failure(404));
    await expect(loadCatalogIndex("aws")).rejects.toThrow(/404/);
  });
});
