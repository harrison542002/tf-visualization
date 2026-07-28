"use client";

import { useState } from "react";

import type { FieldSchema, FieldValue } from "@/lib/providers/types";

interface FieldInputProps {
  readonly field: FieldSchema;
  readonly value: FieldValue | undefined;
  readonly onChange: (value: FieldValue) => void;
}

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950";

/**
 * One control, chosen by the field's declared type.
 *
 * This is the whole reason `FieldSchema` carries a `type`: the properties panel never needs a
 * per-resource form, so adding a resource to the catalog gives it a working editor for free.
 */
/** Splits the visible text into the list that gets stored. */
const parseList = (text: string): readonly string[] =>
  text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

interface StringListInputProps {
  readonly id: string;
  readonly placeholder: string;
  readonly value: readonly string[];
  readonly onChange: (value: FieldValue) => void;
}

/**
 * Text box backed by a list.
 *
 * The raw text is held locally rather than derived from the array on every render. Round
 * tripping through `split`/`join` would discard the separator the moment it was typed — the
 * comma in "22," parses to `["22"]`, which renders back as "22", making a multi-entry list
 * impossible to type.
 */
function StringListInput({ id, placeholder, value, onChange }: StringListInputProps) {
  const external = value.join(", ");
  const [draft, setDraft] = useState(external);
  const [lastExternal, setLastExternal] = useState(external);

  // Adopt changes that came from elsewhere (a different node selected, say) without
  // clobbering what is currently being typed.
  if (external !== lastExternal) {
    setLastExternal(external);
    setDraft(external);
  }

  return (
    <input
      id={id}
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
        setLastExternal(parseList(event.target.value).join(", "));
        onChange(parseList(event.target.value));
      }}
      className={inputClass}
    />
  );
}

export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const id = `field-${field.key}`;

  const control = () => {
    switch (field.type) {
      case "bool":
        return (
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
            className="size-4 rounded border-zinc-300 dark:border-zinc-700"
          />
        );

      case "enum":
        return (
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
          >
            <option value="">(not set)</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );

      case "number":
        return (
          <input
            id={id}
            type="number"
            value={value === undefined ? "" : String(value)}
            placeholder={field.placeholder ?? ""}
            // Kept as text when blank so clearing the box means "unset" rather than 0.
            onChange={(event) =>
              onChange(event.target.value === "" ? "" : Number(event.target.value))
            }
            className={inputClass}
          />
        );

      case "stringList":
        return (
          <StringListInput
            id={id}
            placeholder={field.placeholder ?? "comma, separated"}
            value={Array.isArray(value) ? value : []}
            onChange={onChange}
          />
        );

      case "string":
        return (
          <input
            id={id}
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
          />
        );
    }
  };

  return (
    <div className={field.type === "bool" ? "flex items-center gap-2" : "space-y-1"}>
      {field.type === "bool" && control()}
      <label htmlFor={id} className="block text-xs font-medium">
        {field.label}
        {field.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {field.type !== "bool" && control()}
      {field.help && (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{field.help}</p>
      )}
    </div>
  );
}
