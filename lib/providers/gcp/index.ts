import type { ProviderDefinition } from "../types";
import { computeResources } from "./compute";
import { networkResources } from "./network";
import { projectResources } from "./project";
import { storageResources } from "./storage";

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
  resources: [
    ...networkResources,
    ...computeResources,
    ...storageResources,
    ...projectResources,
  ],
};
