import type { ResourceSchema } from "../types";

export const serviceAccount: ResourceSchema = {
  type: "google_service_account",
  displayName: "Service Account",
  category: "iam",
  description: "Identity that workloads run as.",
  fields: [
    {
      key: "account_id",
      label: "Account ID",
      type: "string",
      required: true,
      placeholder: "web-runner",
      help: "6 to 30 lowercase letters, digits and hyphens. Becomes the email prefix.",
    },
    { key: "display_name", label: "Display name", type: "string", required: false },
    { key: "description", label: "Description", type: "string", required: false },
  ],
  slots: [],
};

export const projectService: ResourceSchema = {
  type: "google_project_service",
  displayName: "Enabled API",
  category: "project",
  description: "Enables a Google Cloud API on the project.",
  fields: [
    {
      key: "service",
      label: "Service",
      type: "enum",
      required: true,
      options: [
        "compute.googleapis.com",
        "storage.googleapis.com",
        "iam.googleapis.com",
        "run.googleapis.com",
        "sqladmin.googleapis.com",
        "container.googleapis.com",
      ],
      defaultValue: "compute.googleapis.com",
    },
    {
      key: "disable_on_destroy",
      label: "Disable on destroy",
      type: "bool",
      required: false,
      defaultValue: false,
      help: "Leaving this off avoids disabling an API other stacks may depend on.",
    },
  ],
  slots: [],
};

export const projectResources: readonly ResourceSchema[] = [serviceAccount, projectService];
