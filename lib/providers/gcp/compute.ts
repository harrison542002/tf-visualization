import { attr, nestedBlock, tfBlock, tfString, tfStringList } from "@/lib/terraform/ir";
import { omitAttributes } from "../helpers";
import type { ResourceSchema } from "../types";

/** Scopes granted when an instance runs as a service account. */
const DEFAULT_SERVICE_ACCOUNT_SCOPES = ["cloud-platform"] as const;

/**
 * Compute Engine VM.
 *
 * The most structurally involved resource in the catalog: `boot_disk`, `network_interface`
 * and `service_account` are all nested blocks in Terraform, so this schema supplies a `build`
 * override. Everything else in the catalog maps flat.
 */
export const computeInstance: ResourceSchema = {
  type: "google_compute_instance",
  displayName: "VM Instance",
  category: "compute",
  description: "Compute Engine virtual machine.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "web-1" },
    {
      key: "machine_type",
      label: "Machine type",
      type: "string",
      required: true,
      defaultValue: "e2-medium",
    },
    { key: "zone", label: "Zone", type: "string", required: true, defaultValue: "us-central1-a" },
    {
      key: "image",
      label: "Boot image",
      type: "string",
      required: true,
      defaultValue: "debian-cloud/debian-12",
    },
    {
      key: "assign_public_ip",
      label: "Assign public IP",
      type: "bool",
      required: false,
      defaultValue: false,
      help: "Adds an empty access_config block, which GCP fills with an ephemeral IP.",
    },
    {
      key: "tags",
      label: "Network tags",
      type: "stringList",
      required: false,
      help: "Firewall rules match instances by these tags.",
    },
  ],
  slots: [
    {
      id: "subnetwork",
      label: "Subnetwork",
      targetType: "google_compute_subnetwork",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    },
    {
      id: "service_account",
      label: "Service account",
      targetType: "google_service_account",
      targetAttribute: "email",
      cardinality: "one",
      required: false,
    },
  ],
  build: ({ field, ref, defaultAttributes }) => {
    const blocks = [
      nestedBlock(
        "boot_disk",
        tfBlock(
          [],
          [
            nestedBlock(
              "initialize_params",
              tfBlock([attr("image", tfString(field.string("image") ?? "debian-cloud/debian-12"))]),
            ),
          ],
        ),
      ),
    ];

    const subnetwork = ref("subnetwork");
    const networkInterface = tfBlock(
      subnetwork ? [attr("subnetwork", subnetwork)] : [],
      // An empty access_config is how GCP is asked for an ephemeral external IP.
      field.bool("assign_public_ip") ? [nestedBlock("access_config", tfBlock())] : [],
    );
    blocks.push(nestedBlock("network_interface", networkInterface));

    const serviceAccount = ref("service_account");
    if (serviceAccount) {
      blocks.push(
        nestedBlock(
          "service_account",
          tfBlock([
            attr("email", serviceAccount),
            attr("scopes", tfStringList(DEFAULT_SERVICE_ACCOUNT_SCOPES)),
          ]),
        ),
      );
    }

    return tfBlock(
      omitAttributes(defaultAttributes, [
        "image",
        "assign_public_ip",
        "subnetwork",
        "service_account",
      ]),
      blocks,
    );
  },
};

export const computeAddress: ResourceSchema = {
  type: "google_compute_address",
  displayName: "Static IP Address",
  category: "compute",
  description: "Reserved internal or external IP address.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "web-ip" },
    {
      key: "address_type",
      label: "Address type",
      type: "enum",
      required: false,
      options: ["INTERNAL", "EXTERNAL"],
      defaultValue: "EXTERNAL",
    },
    {
      key: "region",
      label: "Region",
      type: "string",
      required: true,
      defaultValue: "us-central1",
    },
    { key: "description", label: "Description", type: "string", required: false },
  ],
  slots: [],
};

export const computeDisk: ResourceSchema = {
  type: "google_compute_disk",
  displayName: "Persistent Disk",
  category: "compute",
  description: "Block storage volume attachable to a VM.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "data" },
    { key: "zone", label: "Zone", type: "string", required: true, defaultValue: "us-central1-a" },
    {
      key: "type",
      label: "Disk type",
      type: "enum",
      required: false,
      options: ["pd-standard", "pd-balanced", "pd-ssd", "hyperdisk-balanced"],
      defaultValue: "pd-balanced",
    },
    {
      key: "size",
      label: "Size (GB)",
      type: "number",
      required: false,
      defaultValue: 10,
    },
  ],
  slots: [],
};

export const computeResources: readonly ResourceSchema[] = [
  computeInstance,
  computeAddress,
  computeDisk,
];
