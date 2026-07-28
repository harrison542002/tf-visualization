/**
 * Central lookup for provider catalogs.
 *
 * AWS and Azure are listed with `available: false` so the wizard can show them as coming soon
 * rather than pretending they do not exist. Implementing one means writing its resource
 * schemas and flipping the flag — no changes to the canvas, compiler or serializers.
 */

import { gcpProvider } from "./gcp";
import type { ProviderDefinition, ProviderId, ResourceSchema } from "./types";

const comingSoon = (
  id: ProviderId,
  displayName: string,
  terraformName: string,
  source: string,
): ProviderDefinition => ({
  id,
  displayName,
  terraformName,
  available: false,
  requirement: { source, version: "~> 1.0" },
  providerFields: [],
  resources: [],
});

export const providers: readonly ProviderDefinition[] = [
  gcpProvider,
  comingSoon("aws", "Amazon Web Services", "aws", "hashicorp/aws"),
  comingSoon("azure", "Microsoft Azure", "azurerm", "hashicorp/azurerm"),
];

export function getProvider(id: ProviderId): ProviderDefinition {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return provider;
}

/** Returns the schema for a resource type, or `undefined` if the provider does not define it. */
export function findResourceSchema(
  providerId: ProviderId,
  resourceType: string,
): ResourceSchema | undefined {
  return getProvider(providerId).resources.find((schema) => schema.type === resourceType);
}

/** Same as {@link findResourceSchema}, but throws — for call sites where absence is a bug. */
export function getResourceSchema(
  providerId: ProviderId,
  resourceType: string,
): ResourceSchema {
  const schema = findResourceSchema(providerId, resourceType);
  if (!schema) {
    throw new Error(`Unknown resource type for provider ${providerId}: ${resourceType}`);
  }
  return schema;
}
