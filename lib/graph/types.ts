import type { FieldValues } from "@/lib/providers/types";

/**
 * Payload carried by every node on the canvas.
 *
 * The index signature is required by React Flow's `Node<T extends Record<string, unknown>>`
 * constraint; the named properties are what the app actually reads.
 */
export interface ResourceNodeData extends Record<string, unknown> {
  /** Terraform resource type, matched against the provider catalog. */
  readonly resourceType: string;
  /** Terraform local name, unique among nodes of the same resource type. */
  readonly localName: string;
  /** User-entered values, keyed by `FieldSchema.key`. Missing keys fall back to defaults. */
  readonly fields: FieldValues;
}

/**
 * Structural subset of a React Flow node that the compiler needs.
 *
 * Declared separately so `lib/terraform/` stays free of UI dependencies and can be tested
 * without constructing React Flow objects. A real `Node<ResourceNodeData>` satisfies it.
 */
export interface CompileNode {
  readonly id: string;
  readonly data: ResourceNodeData;
}

/**
 * Structural subset of a React Flow edge.
 *
 * Direction reads as "referenced -> referencing": the `source` is the resource being pointed
 * at (a VPC), and the `target` is the resource that holds the slot and writes the reference
 * (a subnetwork). `targetHandle` is the {@link ConnectionSlot.id} being filled.
 */
export interface CompileEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly targetHandle?: string | null;
}
