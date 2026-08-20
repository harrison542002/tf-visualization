import type { ProviderDefinition } from "../types";
import { gcpCatalogSize, gcpGeneratedResources } from "./generated";

/**
 * Google Cloud.
 *
 * Resources come from `npm run codegen -- --provider gcp --tier1`, which converts the provider
 * schema and applies the curated overrides in `codegen/overrides/gcp.ts`. Nothing here is
 * hand-written except the provider-level settings below.
 */
export const gcpProvider: ProviderDefinition = {
  id: "gcp",
  displayName: "Google Cloud",
  terraformName: "google",
  available: true,
  requirement: { source: "hashicorp/google", version: "~> 6.0" },
  providerFields: [
    {
      key: "project",
      label: "Project ID",
      type: "string",
      required: true,
      placeholder: "my-project-id",
    },
    {
      key: "region",
      label: "Default region",
      type: "string",
      required: false,
      defaultValue: "us-central1",
    },
    {
      key: "zone",
      label: "Default zone",
      type: "string",
      required: false,
      defaultValue: "us-central1-a",
    },
  ],
  resources: gcpGeneratedResources,
  catalogSize: gcpCatalogSize,
};
