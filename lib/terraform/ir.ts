/**
 * Provider-neutral intermediate representation of a Terraform configuration.
 *
 * The graph is compiled into this shape once, then rendered independently as HCL
 * (`lib/terraform/hcl.ts`) or Terraform's native JSON syntax (`lib/terraform/json.ts`).
 * Keeping the IR free of both React Flow and provider specifics is what lets a new cloud
 * provider be added as catalog data rather than as serializer changes.
 */

/**
 * A Terraform value.
 *
 * `ref` is the case that earns this union its keep: an unquoted expression such as
 * `google_compute_network.main.id`. The two output formats render it differently — bare in
 * HCL, wrapped in `"${...}"` in JSON — so the distinction has to survive compilation rather
 * than being flattened into a string early.
 */
export type TfValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "list"; readonly items: readonly TfValue[] }
  | { readonly kind: "map"; readonly entries: readonly TfMapEntry[] }
  | { readonly kind: "ref"; readonly parts: TfRefParts };

/** At least one segment, so a `ref` can never render as an empty expression. */
export type TfRefParts = readonly [string, ...string[]];

export interface TfMapEntry {
  readonly key: string;
  readonly value: TfValue;
}

/**
 * Attributes are an ordered list rather than a record so that output order is explicit and
 * stable, which keeps snapshot tests meaningful.
 */
export interface TfAttribute {
  readonly key: string;
  readonly value: TfValue;
}

export interface TfBlock {
  readonly attributes: readonly TfAttribute[];
  readonly blocks: readonly TfNestedBlock[];
}

/** A nested block such as `network_interface { ... }` inside a resource. */
export interface TfNestedBlock {
  readonly type: string;
  readonly block: TfBlock;
}

export interface TfResource {
  /** Terraform resource type, e.g. `google_compute_network`. */
  readonly type: string;
  /** Terraform local name, e.g. `main`. Unique within a resource type. */
  readonly name: string;
  readonly block: TfBlock;
}

/** One entry of `terraform { required_providers { ... } }`. */
export interface TfProviderRequirement {
  /** Key used inside `required_providers`, e.g. `google`. */
  readonly localName: string;
  /** Registry address, e.g. `hashicorp/google`. */
  readonly source: string;
  /** Version constraint, e.g. `~> 6.0`. */
  readonly version: string;
}

/** A configured `provider "google" { ... }` block. */
export interface TfProviderBlock {
  readonly name: string;
  readonly block: TfBlock;
}

/**
 * A complete, self-contained Terraform configuration.
 *
 * The `terraform` and `provider` blocks are part of the document so that a downloaded file
 * is runnable as-is rather than needing hand-written boilerplate around it.
 */
export interface TfDocument {
  readonly requiredProviders: readonly TfProviderRequirement[];
  readonly providers: readonly TfProviderBlock[];
  readonly resources: readonly TfResource[];
}

// --- Constructors -----------------------------------------------------------------------
// Small by design: they exist so callers read as data declarations rather than as object
// literals repeating `kind` everywhere.

export const tfString = (value: string): TfValue => ({ kind: "string", value });
export const tfNumber = (value: number): TfValue => ({ kind: "number", value });
export const tfBool = (value: boolean): TfValue => ({ kind: "bool", value });

export const tfList = (items: readonly TfValue[]): TfValue => ({ kind: "list", items });
export const tfStringList = (values: readonly string[]): TfValue =>
  tfList(values.map(tfString));

export const tfMap = (entries: readonly TfMapEntry[]): TfValue => ({ kind: "map", entries });

export const tfRef = (...parts: TfRefParts): TfValue => ({ kind: "ref", parts });

/**
 * Reference to an attribute of another resource, e.g.
 * `resourceRef("google_compute_network", "main", "id")`.
 */
export const resourceRef = (
  resourceType: string,
  localName: string,
  attribute: string,
): TfValue => tfRef(resourceType, localName, attribute);

export const attr = (key: string, value: TfValue): TfAttribute => ({ key, value });

export const tfBlock = (
  attributes: readonly TfAttribute[] = [],
  blocks: readonly TfNestedBlock[] = [],
): TfBlock => ({ attributes, blocks });

export const nestedBlock = (type: string, block: TfBlock): TfNestedBlock => ({ type, block });

/** True when a block would render as `{}` — used to skip emitting empty provider blocks. */
export const isEmptyBlock = (block: TfBlock): boolean =>
  block.attributes.length === 0 && block.blocks.length === 0;
