"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import { useGraphStore, type ResourceNode as ResourceNodeType } from "@/lib/graph/store";
import { findResourceSchema } from "@/lib/providers/registry";
import { CATEGORY_STYLES } from "./categoryStyles";

/**
 * A resource on the canvas.
 *
 * Rendered entirely from the catalog: one target handle per declared slot, plus a single
 * source handle for the resources that reference this one. Adding a resource type to the
 * catalog gives it a node here with no changes to this file.
 */
function ResourceNodeComponent({ data, selected }: NodeProps<ResourceNodeType>) {
  // The canvas only ever holds one provider's resources, so the schema is looked up from the
  // active provider rather than duplicated into every node's data.
  const providerId = useGraphStore((state) => state.providerId);
  const schema = providerId ? findResourceSchema(providerId, data.resourceType) : undefined;

  if (!schema) {
    return (
      <div className="rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
        Unknown resource: {data.resourceType}
      </div>
    );
  }

  const style = CATEGORY_STYLES[schema.category];

  return (
    <div
      className={`w-56 rounded-lg border bg-white shadow-sm transition dark:bg-zinc-950 ${
        selected
          ? "border-zinc-900 ring-2 ring-zinc-900/10 dark:border-zinc-100 dark:ring-zinc-100/10"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className={`flex items-center gap-2 rounded-t-lg px-3 py-2 ${style.header}`}>
        <span className={`size-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {schema.displayName}
          </p>
          <p className="truncate font-mono text-sm font-medium">{data.localName}</p>
        </div>
      </div>

      {schema.slots.length > 0 && (
        <ul className="py-1">
          {schema.slots.map((slot) => (
            // Full-bleed row so the handle lands on the node border rather than inside it.
            <li key={slot.id} className="relative px-3 py-1">
              <Handle
                id={slot.id}
                type="target"
                position={Position.Left}
                className="!size-2.5 !border-2 !border-white !bg-zinc-400 dark:!border-zinc-950"
              />
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {slot.label}
                {slot.required && <span className="ml-0.5 text-red-500">*</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-white !bg-zinc-400 dark:!border-zinc-950"
      />
    </div>
  );
}

export const ResourceNode = memo(ResourceNodeComponent);
