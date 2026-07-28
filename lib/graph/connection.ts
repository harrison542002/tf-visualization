/**
 * Decides whether an edge the user is dragging is allowed.
 *
 * Kept pure and separate from the canvas so the rule is testable without React Flow, and so
 * the same schema drives both the live drag feedback and the compiler's validation. Rejecting
 * a connection here is friendlier than accepting it and reporting a diagnostic at export time.
 */

import { findResourceSchema } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/providers/types";
import type { CompileEdge, CompileNode } from "./types";

/** The shape React Flow hands to `isValidConnection`, for both new and reconnected edges. */
export interface ConnectionCandidate {
  readonly source: string | null;
  readonly target: string | null;
  readonly targetHandle?: string | null;
}

export function isConnectionAllowed(
  providerId: ProviderId,
  nodes: readonly CompileNode[],
  edges: readonly CompileEdge[],
  candidate: ConnectionCandidate,
): boolean {
  const { source, target, targetHandle } = candidate;
  if (!source || !target || !targetHandle) return false;
  if (source === target) return false;

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return false;

  const sourceSchema = findResourceSchema(providerId, sourceNode.data.resourceType);
  const targetSchema = findResourceSchema(providerId, targetNode.data.resourceType);
  if (!sourceSchema || !targetSchema) return false;

  const slot = targetSchema.slots.find((candidateSlot) => candidateSlot.id === targetHandle);
  if (!slot) return false;
  if (slot.targetType !== sourceSchema.type) return false;

  const existing = edges.filter(
    (edge) => edge.target === target && edge.targetHandle === targetHandle,
  );
  // Re-dragging an existing edge onto the same slot should not read as a duplicate.
  if (existing.some((edge) => edge.source === source)) return false;
  if (slot.cardinality === "one" && existing.length > 0) return false;

  return true;
}
