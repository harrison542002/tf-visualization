import type { ProviderOverrides } from "../overrides";

/**
 * Curated Google Cloud catalog.
 *
 * This reproduces what used to be hand-written under `lib/providers/gcp/`, so the generated
 * catalog is a drop-in replacement rather than a change in behaviour.
 *
 * Two rules worth knowing when editing:
 *
 * - **An attribute backed by a slot must not appear in `keepFields`.** `network` on a subnetwork
 *   is a required string in the schema, but here it is a connection. Listing it in both places
 *   would emit the key twice.
 * - **`required` often needs overriding upward.** The provider marks `region`, `zone` and
 *   `ip_cidr_range` optional because it can infer them; a user drawing a diagram should still
 *   be told to set them.
 */
const networkSlot = {
  id: "network",
  label: "Network",
  targetType: "google_compute_network",
  targetAttribute: "id",
  cardinality: "one",
  required: true,
} as const;

export const gcpOverrides: ProviderOverrides = {
  tier1: [
    "google_compute_network",
    "google_compute_subnetwork",
    "google_compute_firewall",
    "google_compute_router",
    "google_compute_instance",
    "google_compute_address",
    "google_compute_disk",
    "google_storage_bucket",
    "google_service_account",
    "google_project_service",
  ],

  resources: {
    google_compute_network: {
      displayName: "VPC Network",
      category: "network",
      description: "Virtual private cloud network.",
      keepFields: ["name", "auto_create_subnetworks", "routing_mode", "mtu", "description"],
      fields: {
        name: { placeholder: "main" },
        auto_create_subnetworks: {
          defaultValue: false,
          help: "Leave off when defining subnetworks explicitly on the canvas.",
        },
        routing_mode: { defaultValue: "REGIONAL" },
        mtu: { help: "Between 1300 and 8896. Left unset, GCP uses 1460." },
      },
    },

    google_compute_subnetwork: {
      displayName: "Subnetwork",
      category: "network",
      description: "IP range carved out of a VPC within one region.",
      keepFields: [
        "name",
        "ip_cidr_range",
        "region",
        "private_ip_google_access",
        "description",
      ],
      fields: {
        name: { placeholder: "web" },
        ip_cidr_range: { required: true, placeholder: "10.0.1.0/24" },
        region: { required: true, defaultValue: "us-central1" },
        private_ip_google_access: {
          defaultValue: false,
          help: "Lets instances without external IPs reach Google APIs.",
        },
      },
      slots: [networkSlot],
    },

    google_compute_firewall: {
      displayName: "Firewall Rule",
      category: "network",
      description: "Allows traffic into or out of a VPC.",
      keepFields: [
        "name",
        "direction",
        "priority",
        "source_ranges",
        "target_tags",
        "allow",
        "allow.protocol",
        "allow.ports",
      ],
      fields: {
        name: { placeholder: "allow-ssh" },
        direction: { defaultValue: "INGRESS" },
        priority: { defaultValue: 1000, help: "Lower numbers win. Range 0 to 65535." },
        source_ranges: { placeholder: "0.0.0.0/0" },
        // Required so the block is always emitted: a rule that permits nothing is rejected.
        allow: { required: true, label: "Allowed traffic" },
        "allow.protocol": {
          required: true,
          defaultValue: "tcp",
          options: ["tcp", "udp", "icmp", "all"],
        },
        "allow.ports": {
          placeholder: "22, 80, 443",
          help: "Leave empty for all ports. Not valid when protocol is icmp.",
        },
      },
      slots: [networkSlot],
    },

    google_compute_router: {
      displayName: "Cloud Router",
      category: "network",
      description: "Dynamic routing for a VPC, required by Cloud NAT and VPN.",
      keepFields: ["name", "region", "description"],
      fields: {
        name: { placeholder: "main-router" },
        region: { required: true, defaultValue: "us-central1" },
      },
      slots: [networkSlot],
    },

    google_compute_instance: {
      displayName: "VM Instance",
      category: "compute",
      description: "Compute Engine virtual machine.",
      keepFields: [
        "name",
        "machine_type",
        "zone",
        "tags",
        "boot_disk",
        "boot_disk.initialize_params",
        "boot_disk.initialize_params.image",
        "network_interface",
        "network_interface.access_config",
        "service_account",
        "service_account.scopes",
      ],
      fields: {
        name: { placeholder: "web-1" },
        machine_type: { defaultValue: "e2-medium" },
        zone: { required: true, defaultValue: "us-central1-a" },
        tags: { label: "Network tags", help: "Firewall rules match instances by these tags." },
        "boot_disk.initialize_params": { required: true, label: "Image" },
        "boot_disk.initialize_params.image": {
          required: true,
          defaultValue: "debian-cloud/debian-12",
          label: "Boot image",
        },
        "network_interface.access_config": {
          label: "External IP",
          help: "Add one to get an ephemeral public address.",
        },
        "service_account.scopes": { defaultValue: ["cloud-platform"] },
      },
      slots: [
        {
          id: "subnetwork",
          label: "Subnetwork",
          targetType: "google_compute_subnetwork",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
          path: ["network_interface"],
        },
        {
          // The slot id is the attribute it writes, which inside service_account is the email.
          id: "email",
          label: "Service account",
          targetType: "google_service_account",
          targetAttribute: "email",
          cardinality: "one",
          required: false,
          path: ["service_account"],
        },
      ],
    },

    google_compute_address: {
      displayName: "Static IP Address",
      category: "compute",
      description: "Reserved internal or external IP address.",
      keepFields: ["name", "address_type", "region", "description"],
      fields: {
        name: { placeholder: "web-ip" },
        address_type: { defaultValue: "EXTERNAL", options: ["INTERNAL", "EXTERNAL"] },
        region: { required: true, defaultValue: "us-central1" },
      },
    },

    google_compute_disk: {
      displayName: "Persistent Disk",
      category: "compute",
      description: "Block storage volume attachable to a VM.",
      keepFields: ["name", "zone", "type", "size"],
      fields: {
        name: { placeholder: "data" },
        zone: { required: true, defaultValue: "us-central1-a" },
        type: {
          defaultValue: "pd-balanced",
          options: ["pd-standard", "pd-balanced", "pd-ssd", "hyperdisk-balanced"],
        },
        size: { defaultValue: 10, label: "Size (GB)" },
      },
    },

    google_storage_bucket: {
      displayName: "Storage Bucket",
      category: "storage",
      description: "Cloud Storage bucket for object data.",
      keepFields: [
        "name",
        "location",
        "storage_class",
        "uniform_bucket_level_access",
        "force_destroy",
      ],
      fields: {
        name: { placeholder: "my-app-assets", help: "Must be globally unique across GCP." },
        location: { defaultValue: "US" },
        storage_class: {
          defaultValue: "STANDARD",
          options: ["STANDARD", "NEARLINE", "COLDLINE", "ARCHIVE"],
        },
        uniform_bucket_level_access: {
          defaultValue: true,
          help: "Disables per-object ACLs in favour of IAM. Recommended.",
        },
        force_destroy: {
          defaultValue: false,
          help: "Allows terraform destroy to delete a bucket that still holds objects.",
        },
      },
    },

    google_service_account: {
      displayName: "Service Account",
      category: "iam",
      description: "Identity that workloads run as.",
      keepFields: ["account_id", "display_name", "description"],
      fields: {
        account_id: {
          placeholder: "web-runner",
          help: "6 to 30 lowercase letters, digits and hyphens. Becomes the email prefix.",
        },
      },
    },

    google_project_service: {
      displayName: "Enabled API",
      category: "project",
      description: "Enables a Google Cloud API on the project.",
      keepFields: ["service", "disable_on_destroy"],
      fields: {
        service: {
          defaultValue: "compute.googleapis.com",
          options: [
            "compute.googleapis.com",
            "storage.googleapis.com",
            "iam.googleapis.com",
            "run.googleapis.com",
            "sqladmin.googleapis.com",
            "container.googleapis.com",
          ],
        },
        disable_on_destroy: {
          defaultValue: false,
          help: "Leaving this off avoids disabling an API other stacks may depend on.",
        },
      },
    },
  },
};
