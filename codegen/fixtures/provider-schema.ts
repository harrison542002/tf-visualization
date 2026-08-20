import type { ProviderSchemaJson } from "../convert";

/**
 * A hand-trimmed slice of a real `terraform providers schema -json` dump.
 *
 * Pinned as a fixture rather than read from a live dump so the tests are fast, hermetic, and
 * do not need a provider downloaded. Every shape here was copied from the Google provider:
 * a required string, an optional+computed string, a read-only computed attribute, an enum
 * spelled out in prose, a string list, an unsupported map, and both single and list nesting.
 */
export const fixtureSchema: ProviderSchemaJson = {
  provider_schemas: {
    "registry.opentofu.org/hashicorp/google": {
      resource_schemas: {
        google_compute_subnetwork: {
          block: {
            attributes: {
              name: { type: "string", description: "The name of the resource.", required: true },
              network: {
                type: "string",
                description: "The network this subnet belongs to.",
                required: true,
              },
              ip_cidr_range: {
                type: "string",
                description: "The range of internal addresses.",
                optional: true,
                computed: true,
              },
              purpose: {
                type: "string",
                description: 'The purpose of the subnet. Possible values: ["PRIVATE", "REGIONAL_MANAGED_PROXY"]',
                optional: true,
              },
              // Read-only: an output, so conversion must drop it.
              gateway_address: {
                type: "string",
                description: "The gateway address.",
                computed: true,
              },
              deprecated_field: {
                type: "string",
                description: "Old.",
                optional: true,
                deprecated: true,
              },
              labels: { type: ["map", "string"], description: "Labels.", optional: true },
            },
            block_types: {
              log_config: {
                nesting_mode: "list",
                max_items: 1,
                block: {
                  attributes: {
                    aggregation_interval: {
                      type: "string",
                      description: 'Interval. Possible values: ["INTERVAL_5_SEC", "INTERVAL_1_MIN"]',
                      optional: true,
                    },
                  },
                },
              },
              secondary_ip_range: {
                nesting_mode: "set",
                min_items: 1,
                block: {
                  attributes: {
                    range_name: { type: "string", description: "Name.", required: true },
                  },
                },
              },
            },
          },
        },
        google_storage_bucket: {
          block: {
            attributes: {
              name: { type: "string", description: "The bucket name.", required: true },
              force_destroy: { type: "bool", description: "Delete with objects.", optional: true },
              tags: { type: ["set", "string"], description: "Tags.", optional: true },
              retention_days: { type: "number", description: "Days.", optional: true },
            },
          },
        },
      },
      data_source_schemas: {},
    },
  },
};
