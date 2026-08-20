import type { ProviderOverrides } from "../overrides";

/**
 * Curated AWS catalog.
 *
 * Slots are all hand-written: nothing in the provider schema says `aws_subnet.vpc_id` points at
 * an `aws_vpc`, and unlike GCP there is no upstream definition to mine. AWS naming is at least
 * regular enough that the `<resource>_id` convention makes them obvious to a human.
 *
 * `keepFields` matters more here than elsewhere — `aws_instance` alone carries over a hundred
 * attributes, and a palette that shows all of them is unusable.
 */
export const awsOverrides: ProviderOverrides = {
  tier1: [
    "aws_vpc",
    "aws_subnet",
    "aws_internet_gateway",
    "aws_route_table",
    "aws_route_table_association",
    "aws_security_group",
    "aws_eip",
    "aws_nat_gateway",
    "aws_instance",
    "aws_ebs_volume",
    "aws_s3_bucket",
    "aws_iam_role",
  ],

  resources: {
    aws_vpc: {
      displayName: "VPC",
      category: "network",
      description: "Isolated virtual network.",
      keepFields: ["cidr_block", "enable_dns_hostnames", "enable_dns_support", "instance_tenancy"],
      fields: {
        cidr_block: { required: true, placeholder: "10.0.0.0/16", defaultValue: "10.0.0.0/16" },
        enable_dns_hostnames: { defaultValue: true },
        enable_dns_support: { defaultValue: true },
      },
    },

    aws_subnet: {
      displayName: "Subnet",
      category: "network",
      description: "IP range within a VPC, in one availability zone.",
      keepFields: ["cidr_block", "availability_zone", "map_public_ip_on_launch"],
      fields: {
        cidr_block: { required: true, placeholder: "10.0.1.0/24", defaultValue: "10.0.1.0/24" },
        availability_zone: { placeholder: "us-east-1a" },
        map_public_ip_on_launch: { defaultValue: false },
      },
      slots: [
        {
          id: "vpc_id",
          label: "VPC",
          targetType: "aws_vpc",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
      ],
    },

    aws_internet_gateway: {
      displayName: "Internet Gateway",
      category: "network",
      description: "Gives a VPC access to the internet.",
      keepFields: [],
      slots: [
        {
          id: "vpc_id",
          label: "VPC",
          targetType: "aws_vpc",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
      ],
    },

    aws_route_table: {
      displayName: "Route Table",
      category: "network",
      description: "Routing rules for subnets in a VPC.",
      keepFields: [],
      slots: [
        {
          id: "vpc_id",
          label: "VPC",
          targetType: "aws_vpc",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
      ],
    },

    aws_route_table_association: {
      displayName: "Route Table Association",
      category: "network",
      description: "Attaches a route table to a subnet.",
      keepFields: [],
      slots: [
        {
          id: "subnet_id",
          label: "Subnet",
          targetType: "aws_subnet",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
        {
          id: "route_table_id",
          label: "Route table",
          targetType: "aws_route_table",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
      ],
    },

    aws_security_group: {
      displayName: "Security Group",
      category: "network",
      description: "Stateful firewall for instances.",
      keepFields: ["name", "description"],
      fields: {
        name: { placeholder: "web-sg" },
        description: { defaultValue: "Managed by Terraform" },
      },
      slots: [
        {
          id: "vpc_id",
          label: "VPC",
          targetType: "aws_vpc",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
      ],
    },

    aws_eip: {
      displayName: "Elastic IP",
      category: "network",
      description: "Static public IPv4 address.",
      keepFields: ["domain"],
      fields: { domain: { defaultValue: "vpc" } },
    },

    aws_nat_gateway: {
      displayName: "NAT Gateway",
      category: "network",
      description: "Outbound internet access for private subnets.",
      keepFields: ["connectivity_type"],
      fields: { connectivity_type: { defaultValue: "public" } },
      slots: [
        {
          id: "subnet_id",
          label: "Subnet",
          targetType: "aws_subnet",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
        {
          id: "allocation_id",
          label: "Elastic IP",
          targetType: "aws_eip",
          targetAttribute: "id",
          cardinality: "one",
          required: false,
        },
      ],
    },

    aws_instance: {
      displayName: "EC2 Instance",
      category: "compute",
      description: "Virtual machine.",
      keepFields: ["ami", "instance_type", "key_name", "availability_zone", "monitoring"],
      fields: {
        ami: { required: true, placeholder: "ami-0abcdef1234567890" },
        instance_type: { required: true, defaultValue: "t3.micro" },
        monitoring: { defaultValue: false },
      },
      slots: [
        {
          id: "subnet_id",
          label: "Subnet",
          targetType: "aws_subnet",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
        },
        {
          id: "vpc_security_group_ids",
          label: "Security groups",
          targetType: "aws_security_group",
          targetAttribute: "id",
          cardinality: "many",
          required: false,
        },
      ],
    },

    aws_ebs_volume: {
      displayName: "EBS Volume",
      category: "storage",
      description: "Block storage volume.",
      keepFields: ["availability_zone", "size", "type", "encrypted"],
      fields: {
        availability_zone: { required: true, placeholder: "us-east-1a" },
        size: { defaultValue: 8 },
        type: { defaultValue: "gp3", options: ["gp2", "gp3", "io1", "io2", "sc1", "st1"] },
        encrypted: { defaultValue: true },
      },
    },

    aws_s3_bucket: {
      displayName: "S3 Bucket",
      category: "storage",
      description: "Object storage bucket.",
      keepFields: ["bucket", "force_destroy"],
      fields: {
        bucket: { required: true, placeholder: "my-app-assets", help: "Globally unique." },
        force_destroy: { defaultValue: false },
      },
    },

    aws_iam_role: {
      displayName: "IAM Role",
      category: "iam",
      description: "Identity that AWS services assume.",
      keepFields: ["name", "description", "assume_role_policy"],
      fields: {
        name: { placeholder: "app-role" },
        assume_role_policy: { required: true, help: "Trust policy document, as JSON." },
      },
    },
  },
};
