import type { ProviderDefinition } from "../types";
import { azureCatalogSize, azureGeneratedResources } from "./generated";

/**
 * Microsoft Azure.
 *
 * Resources come from `npm run codegen -- --provider azure --tier1`, applying the curated
 * overrides in `codegen/overrides/azure.ts`.
 */
export const azureProvider: ProviderDefinition = {
  id: "azure",
  displayName: "Microsoft Azure",
  terraformName: "azurerm",
  available: true,
  requirement: { source: "hashicorp/azurerm", version: "~> 4.0" },
  providerFields: [
    {
      key: "subscription_id",
      label: "Subscription ID",
      type: "string",
      required: true,
      placeholder: "00000000-0000-0000-0000-000000000000",
    },
    {
      // azurerm refuses to initialise without this block, even though it is usually empty.
      key: "features",
      label: "Provider features",
      type: "block",
      nesting: "single",
      required: true,
      fields: [],
      help: "Required by the provider. Emitted as an empty features block.",
    },
  ],
  resources: azureGeneratedResources,
  catalogSize: azureCatalogSize,
};
