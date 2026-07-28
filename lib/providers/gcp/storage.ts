import type { ResourceSchema } from "../types";

export const storageBucket: ResourceSchema = {
  type: "google_storage_bucket",
  displayName: "Storage Bucket",
  category: "storage",
  description: "Cloud Storage bucket for object data.",
  fields: [
    {
      key: "name",
      label: "Name",
      type: "string",
      required: true,
      placeholder: "my-app-assets",
      help: "Must be globally unique across all of Google Cloud.",
    },
    { key: "location", label: "Location", type: "string", required: true, defaultValue: "US" },
    {
      key: "storage_class",
      label: "Storage class",
      type: "enum",
      required: false,
      options: ["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"],
      defaultValue: "STANDARD",
    },
    {
      key: "uniform_bucket_level_access",
      label: "Uniform bucket-level access",
      type: "bool",
      required: false,
      defaultValue: true,
      help: "Disables per-object ACLs in favour of IAM. Recommended.",
    },
    {
      key: "force_destroy",
      label: "Force destroy",
      type: "bool",
      required: false,
      defaultValue: false,
      help: "Allows terraform destroy to delete a bucket that still holds objects.",
    },
  ],
  slots: [],
};

export const storageResources: readonly ResourceSchema[] = [storageBucket];
