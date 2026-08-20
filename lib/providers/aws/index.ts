import type { ProviderDefinition } from "../types";
import { awsCatalogSize, awsGeneratedResources } from "./generated";

/**
 * Amazon Web Services.
 *
 * Resources come from `npm run codegen -- --provider aws --tier1`, which converts the provider
 * schema and applies the curated overrides in `codegen/overrides/aws.ts`. Nothing here is
 * hand-written except the provider-level settings below.
 */
export const awsProvider: ProviderDefinition = {
  id: "aws",
  displayName: "Amazon Web Services",
  terraformName: "aws",
  available: true,
  requirement: { source: "hashicorp/aws", version: "~> 6.0" },
  providerFields: [
    {
      key: "region",
      label: "Region",
      type: "string",
      required: true,
      defaultValue: "us-east-1",
      placeholder: "us-east-1",
    },
    {
      key: "profile",
      label: "Shared config profile",
      type: "string",
      required: false,
      help: "Named profile from ~/.aws/config. Leave blank to use the default chain.",
    },
  ],
  resources: awsGeneratedResources,
  catalogSize: awsCatalogSize,
};
