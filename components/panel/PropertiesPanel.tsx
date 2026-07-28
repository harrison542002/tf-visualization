"use client";

import { useGraphStore } from "@/lib/graph/store";
import { findResourceSchema, getProvider } from "@/lib/providers/registry";
import type { FieldValue, FieldValues, ProviderId } from "@/lib/providers/types";
import { isValidLocalName } from "@/lib/terraform/identifiers";
import { FieldInput } from "./FieldInput";

/**
 * Editor for the selected node, plus the provider-level settings when nothing is selected.
 *
 * Both forms are generated from `FieldSchema` lists, so neither knows anything about GCP.
 */
export function PropertiesPanel() {
  const providerId = useGraphStore((state) => state.providerId);
  const selectedNodeId = useGraphStore((state) => state.selectedNodeId);
  const nodes = useGraphStore((state) => state.nodes);
  const providerSettings = useGraphStore((state) => state.providerSettings);
  const setProviderSetting = useGraphStore((state) => state.setProviderSetting);
  const setNodeField = useGraphStore((state) => state.setNodeField);
  const renameNode = useGraphStore((state) => state.renameNode);
  const removeNode = useGraphStore((state) => state.removeNode);

  if (!providerId) return null;
  const provider = getProvider(providerId);
  const selected = nodes.find((node) => node.id === selectedNodeId);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      {selected ? (
        <SelectedNodeForm
          key={selected.id}
          providerId={providerId}
          resourceType={selected.data.resourceType}
          localName={selected.data.localName}
          fields={selected.data.fields}
          onRename={(value) => renameNode(selected.id, value)}
          onFieldChange={(key, value) => setNodeField(selected.id, key, value)}
          onRemove={() => removeNode(selected.id)}
        />
      ) : (
        <div className="p-4">
          <h2 className="text-sm font-semibold">{provider.displayName} settings</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Applied to the generated provider block. Select a node to edit it.
          </p>
          <div className="mt-4 space-y-3">
            {provider.providerFields.map((field) => (
              <FieldInput
                key={field.key}
                field={field}
                value={providerSettings[field.key]}
                onChange={(value) => setProviderSetting(field.key, value)}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

interface SelectedNodeFormProps {
  readonly providerId: ProviderId;
  readonly resourceType: string;
  readonly localName: string;
  readonly fields: FieldValues;
  readonly onRename: (value: string) => void;
  readonly onFieldChange: (key: string, value: FieldValue) => void;
  readonly onRemove: () => void;
}

function SelectedNodeForm({
  providerId,
  resourceType,
  localName,
  fields,
  onRename,
  onFieldChange,
  onRemove,
}: SelectedNodeFormProps) {
  const schema = findResourceSchema(providerId, resourceType);
  if (!schema) return <p className="p-4 text-sm">Unknown resource type: {resourceType}</p>;

  const nameIsValid = isValidLocalName(localName);

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold">{schema.displayName}</h2>
      <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{schema.type}</p>

      <div className="mt-4 space-y-1">
        <label htmlFor="local-name" className="block text-xs font-medium">
          Terraform name<span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          id="local-name"
          type="text"
          value={localName}
          onChange={(event) => onRename(event.target.value)}
          className={`w-full rounded-md border bg-white px-2 py-1.5 font-mono text-sm outline-none dark:bg-zinc-950 ${
            nameIsValid
              ? "border-zinc-300 focus:border-zinc-500 dark:border-zinc-700"
              : "border-red-500"
          }`}
        />
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {nameIsValid
            ? `Referenced as ${schema.type}.${localName}`
            : "Letters, digits, underscores and hyphens, starting with a letter or underscore."}
        </p>
      </div>

      <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {schema.fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={fields[field.key]}
            onChange={(value) => onFieldChange(field.key, value)}
          />
        ))}
      </div>

      {schema.slots.length > 0 && (
        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="text-xs font-medium">Connections</h3>
          <ul className="mt-2 space-y-1">
            {schema.slots.map((slot) => (
              <li key={slot.id} className="text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{slot.label}</span>
                {slot.required && <span className="text-red-500">*</span>} &mdash; drag from a{" "}
                <span className="font-mono">{slot.targetType}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="mt-6 w-full rounded-md border border-red-300 px-2 py-1.5 text-sm text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Delete resource
      </button>
    </div>
  );
}
