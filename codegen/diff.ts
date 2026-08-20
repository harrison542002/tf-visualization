/**
 * Compares generated resources against hand-written ones.
 *
 * This is the measurement that decides how much enrichment and curation the catalog actually
 * needs. Conversion can only produce what a provider schema contains, so the interesting
 * output is what is *missing*: slots above all, plus the human metadata (display names,
 * categories, defaults, placeholders) that no schema carries.
 */

import type { FieldSchema, ResourceSchema } from "@/lib/providers/types";

/** A field flattened to a dotted path, so nested blocks compare as easily as top-level ones. */
export interface FlatField {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly hasOptions: boolean;
}

export function flattenFields(
  fields: readonly FieldSchema[],
  prefix = "",
): readonly FlatField[] {
  const flat: FlatField[] = [];

  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    flat.push({
      path,
      type: field.type,
      required: field.required,
      hasDefault: field.defaultValue !== undefined,
      hasOptions: field.options !== undefined,
    });
    if (field.fields) flat.push(...flattenFields(field.fields, path));
  }

  return flat;
}

export interface FieldDifference {
  readonly path: string;
  readonly reason: string;
}

export interface ResourceDiff {
  readonly type: string;
  readonly onlyInHandWritten: readonly string[];
  readonly onlyInGenerated: readonly string[];
  readonly mismatched: readonly FieldDifference[];
  /** Metadata the schema cannot supply, lost unless curation restores it. */
  readonly lostMetadata: readonly string[];
  readonly slotsLost: readonly string[];
}

export interface DiffSummary {
  readonly compared: number;
  readonly missingFromGenerated: readonly string[];
  readonly diffs: readonly ResourceDiff[];
  readonly totals: {
    readonly slotsLost: number;
    readonly defaultsLost: number;
    readonly optionsLost: number;
    readonly fieldsOnlyInHandWritten: number;
    readonly fieldsOnlyInGenerated: number;
  };
}

export function diffCatalogs(
  handWritten: readonly ResourceSchema[],
  generated: readonly ResourceSchema[],
): DiffSummary {
  const generatedByType = new Map(generated.map((resource) => [resource.type, resource]));

  const diffs: ResourceDiff[] = [];
  const missingFromGenerated: string[] = [];
  let slotsLost = 0;
  let defaultsLost = 0;
  let optionsLost = 0;
  let fieldsOnlyInHandWritten = 0;
  let fieldsOnlyInGenerated = 0;

  for (const hand of handWritten) {
    const gen = generatedByType.get(hand.type);
    if (!gen) {
      missingFromGenerated.push(hand.type);
      continue;
    }

    const handFlat = flattenFields(hand.fields);
    const genFlat = flattenFields(gen.fields);
    const genByPath = new Map(genFlat.map((field) => [field.path, field]));
    const handByPath = new Map(handFlat.map((field) => [field.path, field]));

    const onlyInHandWritten = handFlat
      .filter((field) => !genByPath.has(field.path))
      .map((field) => field.path);
    const onlyInGenerated = genFlat
      .filter((field) => !handByPath.has(field.path))
      .map((field) => field.path);

    const mismatched: FieldDifference[] = [];
    const lostMetadata: string[] = [];

    for (const field of handFlat) {
      const counterpart = genByPath.get(field.path);
      if (!counterpart) continue;

      if (counterpart.type !== field.type) {
        mismatched.push({
          path: field.path,
          reason: `type ${field.type} -> ${counterpart.type}`,
        });
      }
      if (counterpart.required !== field.required) {
        mismatched.push({
          path: field.path,
          reason: `required ${field.required} -> ${counterpart.required}`,
        });
      }
      // Defaults and enum options are editorial choices; no provider schema carries them.
      if (field.hasDefault && !counterpart.hasDefault) {
        lostMetadata.push(`${field.path} (default)`);
        defaultsLost += 1;
      }
      if (field.hasOptions && !counterpart.hasOptions) {
        lostMetadata.push(`${field.path} (options)`);
        optionsLost += 1;
      }
    }

    if (hand.displayName !== gen.displayName) {
      lostMetadata.push(`displayName "${hand.displayName}" -> "${gen.displayName}"`);
    }
    if (hand.category !== gen.category) {
      lostMetadata.push(`category ${hand.category} -> ${gen.category}`);
    }
    if (hand.description && !gen.description) {
      lostMetadata.push("description (empty in schema)");
    }

    const slotsLostHere = hand.slots.map(
      (slot) => `${slot.id} -> ${slot.targetType}.${slot.targetAttribute}`,
    );

    slotsLost += slotsLostHere.length;
    fieldsOnlyInHandWritten += onlyInHandWritten.length;
    fieldsOnlyInGenerated += onlyInGenerated.length;

    diffs.push({
      type: hand.type,
      onlyInHandWritten,
      onlyInGenerated,
      mismatched,
      lostMetadata,
      slotsLost: slotsLostHere,
    });
  }

  return {
    compared: diffs.length,
    missingFromGenerated,
    diffs,
    totals: {
      slotsLost,
      defaultsLost,
      optionsLost,
      fieldsOnlyInHandWritten,
      fieldsOnlyInGenerated,
    },
  };
}

/** Renders the summary as a readable report. */
export function formatDiff(summary: DiffSummary, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];

  lines.push(`Compared ${summary.compared} hand-written resources against generated output.`);
  lines.push("");
  lines.push("Totals");
  lines.push(`  slots lost              : ${summary.totals.slotsLost}`);
  lines.push(`  defaults lost           : ${summary.totals.defaultsLost}`);
  lines.push(`  enum options lost       : ${summary.totals.optionsLost}`);
  lines.push(`  fields only hand-written: ${summary.totals.fieldsOnlyInHandWritten}`);
  lines.push(`  fields only generated   : ${summary.totals.fieldsOnlyInGenerated}`);

  if (summary.missingFromGenerated.length > 0) {
    lines.push("");
    lines.push(`Not present in generated output (${summary.missingFromGenerated.length}):`);
    for (const type of summary.missingFromGenerated) lines.push(`  ${type}`);
  }

  for (const diff of summary.diffs) {
    const interesting =
      diff.onlyInHandWritten.length > 0 ||
      diff.mismatched.length > 0 ||
      diff.slotsLost.length > 0 ||
      diff.lostMetadata.length > 0;
    if (!interesting && !options.verbose) continue;

    lines.push("");
    lines.push(diff.type);

    if (diff.slotsLost.length > 0) {
      lines.push(`  slots lost (${diff.slotsLost.length}):`);
      for (const slot of diff.slotsLost) lines.push(`    ${slot}`);
    }
    if (diff.onlyInHandWritten.length > 0) {
      lines.push(`  missing from generated (${diff.onlyInHandWritten.length}):`);
      for (const path of diff.onlyInHandWritten) lines.push(`    ${path}`);
    }
    if (diff.mismatched.length > 0) {
      lines.push(`  mismatched (${diff.mismatched.length}):`);
      for (const entry of diff.mismatched) lines.push(`    ${entry.path}: ${entry.reason}`);
    }
    if (diff.lostMetadata.length > 0) {
      lines.push(`  metadata (${diff.lostMetadata.length}):`);
      for (const entry of diff.lostMetadata) lines.push(`    ${entry}`);
    }
    // The extra-fields count is the schema being more complete than the hand-written entry,
    // which is the generator doing its job rather than a problem.
    if (diff.onlyInGenerated.length > 0) {
      lines.push(`  extra in generated      : ${diff.onlyInGenerated.length} fields`);
    }
  }

  return lines.join("\n");
}
