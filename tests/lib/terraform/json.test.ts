import { describe, expect, it } from "vitest";

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
import { escapeJsonTemplate, serializeJson, toJsonDocument } from "@/lib/terraform/json";

const emptyDocument: TfDocument = {
  requiredProviders: [],
  providers: [],
  resources: [],
};

describe("escapeJsonTemplate", () => {
  it("doubles interpolation and directive markers", () => {
    expect(escapeJsonTemplate("cost is ${var.price}")).toBe("cost is $${var.price}");
    expect(escapeJsonTemplate("%{ if true }")).toBe("%%{ if true }");
  });

  it("leaves quotes and backslashes to JSON.stringify", () => {
    expect(escapeJsonTemplate('a "b" \\c')).toBe('a "b" \\c');
  });
});

describe("toJsonDocument", () => {
  it("omits sections that have no content", () => {
    expect(toJsonDocument(emptyDocument)).toEqual({});
  });

  it("renders references as interpolation strings", () => {
    const document = toJsonDocument({
      ...emptyDocument,
      resources: [
        {
          type: "google_compute_subnetwork",
          name: "web",
          block: tfBlock([attr("network", resourceRef("google_compute_network", "main", "id"))]),
        },
      ],
    });

    expect(document).toEqual({
      resource: {
        google_compute_subnetwork: {
          web: { network: "${google_compute_network.main.id}" },
        },
      },
    });
  });

  it("nests resources by type then local name", () => {
    const document = toJsonDocument({
      ...emptyDocument,
      resources: [
        {
          type: "google_compute_network",
          name: "a",
          block: tfBlock([attr("name", tfString("a"))]),
        },
        {
          type: "google_compute_network",
          name: "b",
          block: tfBlock([attr("name", tfString("b"))]),
        },
        {
          type: "google_storage_bucket",
          name: "assets",
          block: tfBlock([attr("name", tfString("assets"))]),
        },
      ],
    });

    expect(document).toEqual({
      resource: {
        google_compute_network: { a: { name: "a" }, b: { name: "b" } },
        google_storage_bucket: { assets: { name: "assets" } },
      },
    });
  });

  it("groups repeated nested blocks of the same type into one array", () => {
    const document = toJsonDocument({
      ...emptyDocument,
      resources: [
        {
          type: "google_compute_instance",
          name: "web",
          block: tfBlock(
            [],
            [
              nestedBlock("network_interface", tfBlock([attr("network", tfString("a"))])),
              nestedBlock("network_interface", tfBlock([attr("network", tfString("b"))])),
            ],
          ),
        },
      ],
    });

    expect(document).toEqual({
      resource: {
        google_compute_instance: {
          web: {
            network_interface: [{ network: "a" }, { network: "b" }],
          },
        },
      },
    });
  });

  it("preserves scalar types rather than stringifying them", () => {
    const document = toJsonDocument({
      ...emptyDocument,
      resources: [
        {
          type: "google_compute_network",
          name: "main",
          block: tfBlock([
            attr("mtu", tfNumber(1460)),
            attr("auto_create_subnetworks", tfBool(false)),
            attr("tags", tfStringList(["web"])),
            attr("labels", tfMap([{ key: "env", value: tfString("prod") }])),
          ]),
        },
      ],
    });

    expect(document).toEqual({
      resource: {
        google_compute_network: {
          main: {
            mtu: 1460,
            auto_create_subnetworks: false,
            tags: ["web"],
            labels: { env: "prod" },
          },
        },
      },
    });
  });
});

describe("serializeJson", () => {
  it("renders a full document as formatted .tf.json", () => {
    const output = serializeJson({
      requiredProviders: [
        { localName: "google", source: "hashicorp/google", version: "~> 6.0" },
      ],
      providers: [{ name: "google", block: tfBlock([attr("project", tfString("my-project"))]) }],
      resources: [
        {
          type: "google_compute_network",
          name: "main",
          block: tfBlock([attr("name", tfString("main"))]),
        },
      ],
    });

    expect(output).toBe(
      `{
  "terraform": {
    "required_providers": {
      "google": {
        "source": "hashicorp/google",
        "version": "~> 6.0"
      }
    }
  },
  "provider": {
    "google": {
      "project": "my-project"
    }
  },
  "resource": {
    "google_compute_network": {
      "main": {
        "name": "main"
      }
    }
  }
}
`,
    );
  });

  it("throws on non-finite numbers rather than emitting null", () => {
    expect(() =>
      serializeJson({
        ...emptyDocument,
        resources: [
          {
            type: "google_compute_disk",
            name: "data",
            block: tfBlock([attr("size", tfNumber(Number.POSITIVE_INFINITY))]),
          },
        ],
      }),
    ).toThrow(/non-finite/);
  });
});
