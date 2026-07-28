/**
 * Provider-agnostic vocabulary for describing cloud resources.
 *
 * Nothing here mentions GCP. A provider is a bundle of {@link ResourceSchema} data, so adding
 * AWS or Azure means writing catalog entries under `lib/providers/<id>/` — the canvas, the
 * property panel, the validator and the serializers all read from these types and need no
 * changes.
 */

import type { TfAttribute, TfBlock, TfValue } from "@/lib/terraform/ir";

export type ProviderId = "gcp" | "aws" | "azure";

export type ResourceCategory = "network" | "compute" | "storage" | "iam" | "project";

export type FieldType = "string" | "number" | "bool" | "enum" | "stringList";

/** A value as held in a node's config — the user-editable side of a resource. */
export type FieldValue = string | number | boolean | readonly string[];

export type FieldValues = Readonly<Record<string, FieldValue>>;

/**
 * One editable property of a resource. The property panel renders itself entirely from these,
 * so a resource with no `build` override needs no UI code at all.
 */
export interface FieldSchema {
  /** Terraform attribute name, used verbatim in the generated output. */
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly defaultValue?: FieldValue;
  /** Allowed values; required when `type` is `"enum"`. */
  readonly options?: readonly string[];
  readonly placeholder?: string;
  /** Short hint shown under the input. */
  readonly help?: string;
}

/**
 * A typed connection point: "this resource can reference one of those".
 *
 * Slots do double duty — they render as handles on the node, gate which edges the canvas
 * will accept, and tell the compiler what reference to write into the output.
 */
export interface ConnectionSlot {
  /**
   * Terraform attribute the reference is written to, e.g. `network`. Also the React Flow
   * handle id. Resources with a `build` override may use it as a lookup key instead.
   */
  readonly id: string;
  readonly label: string;
  /** Resource type this slot accepts, e.g. `google_compute_network`. */
  readonly targetType: string;
  /** Attribute read off the target, e.g. `id`, `self_link` or `name`. */
  readonly targetAttribute: string;
  readonly cardinality: "one" | "many";
  readonly required: boolean;
}

/** Reads a node's field values with the schema's declared type applied. */
export interface FieldAccessor {
  readonly string: (key: string) => string | undefined;
  readonly number: (key: string) => number | undefined;
  readonly bool: (key: string) => boolean | undefined;
  readonly stringList: (key: string) => readonly string[];
}

/**
 * Everything a {@link ResourceSchema.build} override needs to assemble a block.
 *
 * `defaultAttributes` is what the standard flat builder would have produced, so an override
 * can reuse most of it and only hand-place the parts that belong in nested blocks.
 */
export interface BuildContext {
  readonly field: FieldAccessor;
  /** Resolved reference for a `one` slot, or `undefined` when nothing is connected. */
  readonly ref: (slotId: string) => TfValue | undefined;
  /** Resolved references for a `many` slot, in the order the edges were created. */
  readonly refs: (slotId: string) => readonly TfValue[];
  readonly defaultAttributes: readonly TfAttribute[];
}

export interface ResourceSchema {
  /** Terraform resource type, e.g. `google_compute_subnetwork`. */
  readonly type: string;
  readonly displayName: string;
  readonly category: ResourceCategory;
  /** Short blurb shown in the palette. */
  readonly description: string;
  readonly fields: readonly FieldSchema[];
  readonly slots: readonly ConnectionSlot[];
  /**
   * Optional escape hatch for resources whose output has nested blocks.
   *
   * Omit it and fields and slots map straight to flat attributes, which covers most
   * resources. Supply it only where Terraform's schema genuinely nests, such as
   * `google_compute_instance`'s `boot_disk` and `network_interface`.
   */
  readonly build?: (context: BuildContext) => TfBlock;
}

export interface ProviderDefinition {
  readonly id: ProviderId;
  readonly displayName: string;
  /**
   * Name Terraform knows the provider by, e.g. `google` for GCP and `azurerm` for Azure.
   * Used for `required_providers` keys and `provider "<name>"` blocks.
   */
  readonly terraformName: string;
  /** False for providers that are announced in the UI but not yet implemented. */
  readonly available: boolean;
  /** Registry address and version constraint for `required_providers`. */
  readonly requirement: { readonly source: string; readonly version: string };
  /** Provider-level settings such as project and region. */
  readonly providerFields: readonly FieldSchema[];
  readonly resources: readonly ResourceSchema[];
}
