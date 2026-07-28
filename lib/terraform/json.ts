/**
 * Renders a {@link TfDocument} as Terraform's native JSON configuration syntax (`.tf.json`).
 *
 * Terraform reads `.tf.json` directly, so this is a first-class output format rather than a
 * convenience dump — the same document rendered here and by `serializeHcl` describes exactly
 * the same infrastructure.
 */

import type { TfBlock, TfDocument, TfValue } from "./ir";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Escapes interpolation and template markers in a literal string.
 *
 * Easy to miss: string values in `.tf.json` are evaluated as template expressions, exactly as
 * in HCL. A bucket description containing a literal `${var.x}` would otherwise be evaluated
 * instead of stored. JSON's own quoting is handled by `JSON.stringify`, so only the Terraform
 * template markers are doubled here.
 */
export function escapeJsonTemplate(value: string): string {
  // Function replacements, not string ones: `$$` in a replacement string is an escape for a
  // literal `$`, which would silently collapse `$${` back to `${`.
  return value.replace(/\$\{/g, () => "$${").replace(/%\{/g, () => "%%{");
}

function valueToJson(value: TfValue): JsonValue {
  switch (value.kind) {
    case "string":
      return escapeJsonTemplate(value.value);

    case "number":
      if (!Number.isFinite(value.value)) {
        throw new Error(
          `Cannot render non-finite number as JSON: ${String(value.value)}. ` +
            "This indicates a bug in the compiler, which should reject it first.",
        );
      }
      return value.value;

    case "bool":
      return value.value;

    case "ref":
      // Unlike HCL, JSON has no bare-expression form: references travel as interpolations.
      return `\${${value.parts.join(".")}}`;

    case "list":
      return value.items.map(valueToJson);

    case "map":
      return Object.fromEntries(
        value.entries.map((entry) => [entry.key, valueToJson(entry.value)]),
      );
  }
}

function blockToJson(block: TfBlock): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};

  for (const attribute of block.attributes) {
    result[attribute.key] = valueToJson(attribute.value);
  }

  // Repeatable blocks (two `network_interface`s, say) must collapse into a single key, so
  // nested blocks of the same type are grouped into an array. Terraform accepts the array
  // form for both single and repeated blocks, so it is used uniformly.
  const grouped = new Map<string, Record<string, JsonValue>[]>();
  for (const nested of block.blocks) {
    const existing = grouped.get(nested.type);
    if (existing) {
      existing.push(blockToJson(nested.block));
    } else {
      grouped.set(nested.type, [blockToJson(nested.block)]);
    }
  }
  for (const [type, blocks] of grouped) {
    result[type] = blocks;
  }

  return result;
}

/** Builds the document as a plain JSON tree, useful for assertions in tests. */
export function toJsonDocument(document: TfDocument): JsonValue {
  const result: Record<string, JsonValue> = {};

  if (document.requiredProviders.length > 0) {
    result["terraform"] = {
      required_providers: Object.fromEntries(
        document.requiredProviders.map((requirement) => [
          requirement.localName,
          { source: requirement.source, version: requirement.version },
        ]),
      ),
    };
  }

  if (document.providers.length > 0) {
    result["provider"] = Object.fromEntries(
      document.providers.map((provider) => [provider.name, blockToJson(provider.block)]),
    );
  }

  if (document.resources.length > 0) {
    const resources: Record<string, Record<string, JsonValue>> = {};
    for (const resource of document.resources) {
      const byName = resources[resource.type] ?? {};
      byName[resource.name] = blockToJson(resource.block);
      resources[resource.type] = byName;
    }
    result["resource"] = resources;
  }

  return result;
}

/** Renders a complete `.tf.json` configuration, terminated by a trailing newline. */
export function serializeJson(document: TfDocument): string {
  return `${JSON.stringify(toJsonDocument(document), null, 2)}\n`;
}
