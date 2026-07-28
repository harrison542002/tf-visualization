import { attr, nestedBlock, tfBlock, tfString, tfStringList } from "@/lib/terraform/ir";
import { omitAttributes } from "../helpers";
import type { ResourceSchema } from "../types";

/** VPC network. The root of most GCP topologies, so it has no outgoing slots. */
export const computeNetwork: ResourceSchema = {
  type: "google_compute_network",
  displayName: "VPC Network",
  category: "network",
  description: "Virtual private cloud network.",
  fields: [
    {
      key: "name",
      label: "Name",
      type: "string",
      required: true,
      placeholder: "main",
    },
    {
      key: "auto_create_subnetworks",
      label: "Auto-create subnetworks",
      type: "bool",
      required: false,
      defaultValue: false,
      help: "Leave off when defining subnetworks explicitly on the canvas.",
    },
    {
      key: "routing_mode",
      label: "Routing mode",
      type: "enum",
      required: false,
      options: ["REGIONAL", "GLOBAL"],
      defaultValue: "REGIONAL",
    },
    {
      key: "mtu",
      label: "MTU",
      type: "number",
      required: false,
      help: "Between 1300 and 8896. Left unset, GCP uses 1460.",
    },
    { key: "description", label: "Description", type: "string", required: false },
  ],
  slots: [],
};

export const computeSubnetwork: ResourceSchema = {
  type: "google_compute_subnetwork",
  displayName: "Subnetwork",
  category: "network",
  description: "IP range carved out of a VPC within one region.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "web" },
    {
      key: "ip_cidr_range",
      label: "IP CIDR range",
      type: "string",
      required: true,
      placeholder: "10.0.1.0/24",
    },
    {
      key: "region",
      label: "Region",
      type: "string",
      required: true,
      defaultValue: "us-central1",
    },
    {
      key: "private_ip_google_access",
      label: "Private Google access",
      type: "bool",
      required: false,
      defaultValue: false,
      help: "Lets instances without external IPs reach Google APIs.",
    },
    { key: "description", label: "Description", type: "string", required: false },
  ],
  slots: [
    {
      id: "network",
      label: "Network",
      targetType: "google_compute_network",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    },
  ],
};

/**
 * Firewall rule.
 *
 * Terraform nests the protocol and ports inside an `allow` block, so protocol/ports are
 * declared as ordinary fields for the UI and relocated by `build`.
 */
export const computeFirewall: ResourceSchema = {
  type: "google_compute_firewall",
  displayName: "Firewall Rule",
  category: "network",
  description: "Allows traffic into or out of a VPC.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "allow-ssh" },
    {
      key: "direction",
      label: "Direction",
      type: "enum",
      required: false,
      options: ["INGRESS", "EGRESS"],
      defaultValue: "INGRESS",
    },
    {
      key: "priority",
      label: "Priority",
      type: "number",
      required: false,
      defaultValue: 1000,
      help: "Lower numbers win. Range 0 to 65535.",
    },
    {
      key: "protocol",
      label: "Protocol",
      type: "enum",
      required: true,
      options: ["tcp", "udp", "icmp", "all"],
      defaultValue: "tcp",
    },
    {
      key: "ports",
      label: "Ports",
      type: "stringList",
      required: false,
      placeholder: "22, 80, 443",
      help: "Leave empty for all ports. Ignored when protocol is icmp.",
    },
    {
      key: "source_ranges",
      label: "Source ranges",
      type: "stringList",
      required: false,
      placeholder: "0.0.0.0/0",
    },
    { key: "target_tags", label: "Target tags", type: "stringList", required: false },
  ],
  slots: [
    {
      id: "network",
      label: "Network",
      targetType: "google_compute_network",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    },
  ],
  build: ({ field, defaultAttributes }) => {
    const protocol = field.string("protocol") ?? "tcp";
    const ports = field.stringList("ports");

    const allow = [attr("protocol", tfString(protocol))];
    // The GCP provider rejects `ports` on icmp, and an empty list means "every port".
    if (ports.length > 0 && protocol !== "icmp") {
      allow.push(attr("ports", tfStringList(ports)));
    }

    return tfBlock(omitAttributes(defaultAttributes, ["protocol", "ports"]), [
      nestedBlock("allow", tfBlock(allow)),
    ]);
  },
};

export const computeRouter: ResourceSchema = {
  type: "google_compute_router",
  displayName: "Cloud Router",
  category: "network",
  description: "Dynamic routing for a VPC, required by Cloud NAT and VPN.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "main-router" },
    {
      key: "region",
      label: "Region",
      type: "string",
      required: true,
      defaultValue: "us-central1",
    },
    { key: "description", label: "Description", type: "string", required: false },
  ],
  slots: [
    {
      id: "network",
      label: "Network",
      targetType: "google_compute_network",
      targetAttribute: "id",
      cardinality: "one",
      required: true,
    },
  ],
};

export const networkResources: readonly ResourceSchema[] = [
  computeNetwork,
  computeSubnetwork,
  computeFirewall,
  computeRouter,
];
