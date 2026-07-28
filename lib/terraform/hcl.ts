/**
 * Renders a {@link TfDocument} as HCL2.
 *
 * Written by hand because no maintained HCL *writer* exists for JavaScript: the `hcl` package
 * was last published in 2014, and `@cdktf/hcl-tools` is a WASM bundle pointed the other way
 * (HCL to JSON). Since the IR is small and closed, a direct renderer is both smaller and
 * easier to test than pulling in a general-purpose dependency.
 *
 * Output aims to be byte-identical to what `terraform fmt` would produce, so that generated
 * files drop into a repository without reformatting noise.
 */

import {
  attr,
  isEmptyBlock,
  nestedBlock,
  tfBlock,
  tfMap,
  tfString,
  type TfAttribute,
  type TfBlock,
  type TfDocument,
  type TfValue,
} from "./ir";

const INDENT = "  ";

const indentOf = (level: number): string => INDENT.repeat(level);

/**
 * Escapes a string for a quoted HCL literal.
 *
 * The two non-obvious cases are `${` and `%{`, which introduce interpolation and template
 * directives. A user typing a literal `${foo}` into a description field must not have it
 * evaluated by Terraform, so both are doubled.
 */
export function escapeHclString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    // Function replacements, not string ones: `$$` in a replacement string is an escape for
    // a literal `$`, which would silently collapse `$${` back to `${`.
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, () => "%%{");
}

interface RenderedValue {
  readonly text: string;
  /** Multi-line values break `=` alignment groups, matching `terraform fmt`. */
  readonly multiline: boolean;
}

function renderValue(value: TfValue, level: number): RenderedValue {
  switch (value.kind) {
    case "string":
      return { text: `"${escapeHclString(value.value)}"`, multiline: false };

    case "number":
      if (!Number.isFinite(value.value)) {
        throw new Error(
          `Cannot render non-finite number as HCL: ${String(value.value)}. ` +
            "This indicates a bug in the compiler, which should reject it first.",
        );
      }
      return { text: String(value.value), multiline: false };

    case "bool":
      return { text: value.value ? "true" : "false", multiline: false };

    case "ref":
      return { text: value.parts.join("."), multiline: false };

    case "list": {
      if (value.items.length === 0) return { text: "[]", multiline: false };
      const items = value.items.map((item) => renderValue(item, level));
      // Lists in practice hold short scalars (tags, ports, CIDRs), so they stay inline.
      // A nested multi-line item forces the whole list to break.
      if (items.some((item) => item.multiline)) {
        const lines = items.map((item) => `${indentOf(level + 1)}${item.text},`);
        return {
          text: `[\n${lines.join("\n")}\n${indentOf(level)}]`,
          multiline: true,
        };
      }
      return { text: `[${items.map((item) => item.text).join(", ")}]`, multiline: false };
    }

    case "map": {
      if (value.entries.length === 0) return { text: "{}", multiline: false };
      const body = renderAttributes(
        value.entries.map((entry) => attr(entry.key, entry.value)),
        level + 1,
      );
      return { text: `{\n${body.join("\n")}\n${indentOf(level)}}`, multiline: true };
    }
  }
}

/**
 * Renders attributes with `=` aligned across runs of consecutive single-line attributes,
 * which is what `terraform fmt` does. A multi-line attribute ends the current run.
 */
function renderAttributes(attributes: readonly TfAttribute[], level: number): string[] {
  const rendered = attributes.map((attribute) => ({
    key: attribute.key,
    ...renderValue(attribute.value, level),
  }));

  const lines: string[] = [];
  let runStart = 0;

  const flushRun = (endExclusive: number): void => {
    if (endExclusive <= runStart) return;
    const run = rendered.slice(runStart, endExclusive);
    const width = Math.max(...run.map((entry) => entry.key.length));
    for (const entry of run) {
      lines.push(`${indentOf(level)}${entry.key.padEnd(width)} = ${entry.text}`);
    }
  };

  rendered.forEach((entry, index) => {
    if (!entry.multiline) return;
    flushRun(index);
    lines.push(`${indentOf(level)}${entry.key} = ${entry.text}`);
    runStart = index + 1;
  });
  flushRun(rendered.length);

  return lines;
}

function renderBlockBody(block: TfBlock, level: number): string[] {
  const lines = renderAttributes(block.attributes, level);

  for (const nested of block.blocks) {
    if (lines.length > 0) lines.push("");
    lines.push(...renderBlock([nested.type], nested.block, level));
  }

  return lines;
}

/**
 * Renders a block and its labels, e.g. `["resource", "google_compute_network", "main"]`
 * becomes `resource "google_compute_network" "main" { ... }`.
 *
 * The first label is the block type and is emitted bare; the rest are quoted.
 */
function renderBlock(
  labels: readonly [string, ...string[]],
  block: TfBlock,
  level: number,
): string[] {
  const [type, ...rest] = labels;
  const header = [type, ...rest.map((label) => `"${escapeHclString(label)}"`)].join(" ");
  const pad = indentOf(level);

  if (isEmptyBlock(block)) return [`${pad}${header} {}`];

  return [`${pad}${header} {`, ...renderBlockBody(block, level + 1), `${pad}}`];
}

/** Builds the `terraform { required_providers { ... } }` block from the document header. */
function requiredProvidersBlock(document: TfDocument): TfBlock {
  const entries = document.requiredProviders.map((requirement) =>
    attr(
      requirement.localName,
      tfMap([
        { key: "source", value: tfString(requirement.source) },
        { key: "version", value: tfString(requirement.version) },
      ]),
    ),
  );

  return tfBlock([], [nestedBlock("required_providers", tfBlock(entries))]);
}

/** Renders a complete Terraform configuration, terminated by a trailing newline. */
export function serializeHcl(document: TfDocument): string {
  const sections: string[][] = [];

  if (document.requiredProviders.length > 0) {
    sections.push(renderBlock(["terraform"], requiredProvidersBlock(document), 0));
  }

  for (const provider of document.providers) {
    sections.push(renderBlock(["provider", provider.name], provider.block, 0));
  }

  for (const resource of document.resources) {
    sections.push(renderBlock(["resource", resource.type, resource.name], resource.block, 0));
  }

  if (sections.length === 0) return "";

  return `${sections.map((section) => section.join("\n")).join("\n\n")}\n`;
}
