import type { ProviderOverrides } from "../overrides";

/**
 * Curated Azure catalog.
 *
 * Azure differs from the other two in one structural way: almost everything belongs to a
 * resource group, and the reference is by *name* rather than id. That makes
 * `resource_group_name -> azurerm_resource_group.name` the most common slot in the catalog,
 * and it is why the resource group is tier-1 entry number one.
 *
 * The provider also documents only 8% of its attributes, so `help` text is largely absent and
 * enum recovery finds nothing — anything useful here had to be written by hand.
 */
const resourceGroupSlot = {
  id: "resource_group_name",
  label: "Resource group",
  targetType: "azurerm_resource_group",
  targetAttribute: "name",
  cardinality: "one",
  required: true,
} as const;

export const azureOverrides: ProviderOverrides = {
  tier1: [
    "azurerm_resource_group",
    "azurerm_virtual_network",
    "azurerm_subnet",
    "azurerm_network_security_group",
    "azurerm_public_ip",
    "azurerm_network_interface",
    "azurerm_linux_virtual_machine",
    "azurerm_managed_disk",
    "azurerm_storage_account",
  ],

  resources: {
    azurerm_resource_group: {
      displayName: "Resource Group",
      category: "project",
      description: "Container that everything else belongs to.",
      keepFields: ["name", "location"],
      fields: {
        name: { required: true, placeholder: "my-app-rg" },
        location: { required: true, defaultValue: "westeurope" },
      },
    },

    azurerm_virtual_network: {
      displayName: "Virtual Network",
      category: "network",
      description: "Isolated network within a region.",
      keepFields: ["name", "location", "address_space"],
      fields: {
        name: { required: true, placeholder: "my-vnet" },
        location: { required: true, defaultValue: "westeurope" },
        address_space: { required: true, defaultValue: ["10.0.0.0/16"] },
      },
      slots: [resourceGroupSlot],
    },

    azurerm_subnet: {
      displayName: "Subnet",
      category: "network",
      description: "IP range within a virtual network.",
      keepFields: ["name", "address_prefixes"],
      fields: {
        name: { required: true, placeholder: "web" },
        address_prefixes: { required: true, defaultValue: ["10.0.1.0/24"] },
      },
      slots: [
        resourceGroupSlot,
        {
          id: "virtual_network_name",
          label: "Virtual network",
          targetType: "azurerm_virtual_network",
          targetAttribute: "name",
          cardinality: "one",
          required: true,
        },
      ],
    },

    azurerm_network_security_group: {
      displayName: "Network Security Group",
      category: "network",
      description: "Firewall rules for subnets and interfaces.",
      keepFields: ["name", "location"],
      fields: {
        name: { required: true, placeholder: "web-nsg" },
        location: { required: true, defaultValue: "westeurope" },
      },
      slots: [resourceGroupSlot],
    },

    azurerm_public_ip: {
      displayName: "Public IP",
      category: "network",
      description: "Public IP address.",
      keepFields: ["name", "location", "allocation_method", "sku"],
      fields: {
        name: { required: true, placeholder: "web-ip" },
        location: { required: true, defaultValue: "westeurope" },
        allocation_method: { required: true, defaultValue: "Static", options: ["Static", "Dynamic"] },
        sku: { defaultValue: "Standard", options: ["Basic", "Standard"] },
      },
      slots: [resourceGroupSlot],
    },

    azurerm_network_interface: {
      displayName: "Network Interface",
      category: "network",
      description: "NIC attaching a VM to a subnet.",
      keepFields: [
        "name",
        "location",
        "ip_configuration",
        "ip_configuration.name",
        "ip_configuration.private_ip_address_allocation",
      ],
      fields: {
        name: { required: true, placeholder: "web-nic" },
        location: { required: true, defaultValue: "westeurope" },
        "ip_configuration.name": { defaultValue: "internal" },
        "ip_configuration.private_ip_address_allocation": {
          defaultValue: "Dynamic",
          options: ["Dynamic", "Static"],
        },
      },
      slots: [
        resourceGroupSlot,
        {
          // Lands inside the ip_configuration block rather than at the top level.
          id: "subnet_id",
          label: "Subnet",
          targetType: "azurerm_subnet",
          targetAttribute: "id",
          cardinality: "one",
          required: true,
          path: ["ip_configuration"],
        },
      ],
    },

    azurerm_linux_virtual_machine: {
      displayName: "Linux VM",
      category: "compute",
      description: "Linux virtual machine.",
      keepFields: ["name", "location", "size", "admin_username"],
      fields: {
        name: { required: true, placeholder: "web-1" },
        location: { required: true, defaultValue: "westeurope" },
        size: { required: true, defaultValue: "Standard_B1s" },
        admin_username: { required: true, defaultValue: "azureuser" },
      },
      slots: [
        resourceGroupSlot,
        {
          id: "network_interface_ids",
          label: "Network interfaces",
          targetType: "azurerm_network_interface",
          targetAttribute: "id",
          cardinality: "many",
          required: true,
        },
      ],
    },

    azurerm_managed_disk: {
      displayName: "Managed Disk",
      category: "storage",
      description: "Block storage disk.",
      keepFields: ["name", "location", "storage_account_type", "create_option", "disk_size_gb"],
      fields: {
        name: { required: true, placeholder: "data-disk" },
        location: { required: true, defaultValue: "westeurope" },
        storage_account_type: {
          required: true,
          defaultValue: "Standard_LRS",
          options: ["Standard_LRS", "StandardSSD_LRS", "Premium_LRS", "UltraSSD_LRS"],
        },
        create_option: { required: true, defaultValue: "Empty" },
        disk_size_gb: { defaultValue: 32 },
      },
      slots: [resourceGroupSlot],
    },

    azurerm_storage_account: {
      displayName: "Storage Account",
      category: "storage",
      description: "Blob, file and queue storage.",
      keepFields: ["name", "location", "account_tier", "account_replication_type"],
      fields: {
        name: { required: true, placeholder: "myappstorage", help: "Globally unique, lowercase." },
        location: { required: true, defaultValue: "westeurope" },
        account_tier: { required: true, defaultValue: "Standard", options: ["Standard", "Premium"] },
        account_replication_type: {
          required: true,
          defaultValue: "LRS",
          options: ["LRS", "GRS", "RAGRS", "ZRS"],
        },
      },
      slots: [resourceGroupSlot],
    },
  },
};
