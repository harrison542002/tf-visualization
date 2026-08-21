/**
 * Command line entry point for the catalog generator.
 *
 *   npm run codegen -- --schema <path> --provider gcp --out lib/providers/gcp/generated.ts
 *
 * `--include` narrows the run to a prefix, which is how you generate a slice (say
 * `google_compute_`) without emitting a multi-megabyte module.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { convertProviderSchema, selectProviderSchema } from "./convert";
import { emitCatalog } from "./catalog";
import { emitResourceModule } from "./emit";
import { readProviderSchema } from "./readSchema";
import { applyOverrides, type ProviderOverrides } from "./overrides";
import { awsOverrides } from "./overrides/aws";
import { azureOverrides } from "./overrides/azure";
import { gcpOverrides } from "./overrides/gcp";

interface ProviderProfile {
  readonly displayName: string;
  readonly prefix: string;
  /** Curated tier-1 selection and the metadata schemas cannot carry. */
  readonly overrides?: ProviderOverrides;
}

const PROFILES: Record<string, ProviderProfile> = {
  gcp: { displayName: "Google Cloud", prefix: "google_", overrides: gcpOverrides },
  aws: { displayName: "Amazon Web Services", prefix: "aws_", overrides: awsOverrides },
  azure: { displayName: "Microsoft Azure", prefix: "azurerm_", overrides: azureOverrides },
};

/** `--tier1` narrows the run to the curated set and applies the overrides. */
function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args.set(name, "true");
    } else {
      args.set(name, next);
      index += 1;
    }
  }
  return args;
}

function requireArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`missing required argument --${name}`);
  return value;
}

/** Reports what conversion could not represent, so the gaps are visible rather than silent. */
function printStats(stats: ReturnType<typeof convertProviderSchema>["stats"]): void {
  console.log(`  resources in schema : ${stats.resourcesInSchema}`);
  console.log(`  resources emitted   : ${stats.resourcesEmitted}`);
  console.log(`  fields emitted      : ${stats.fieldsEmitted}`);
  console.log(`  computed skipped    : ${stats.computedSkipped}  (read-only outputs)`);
  console.log(`  deprecated skipped  : ${stats.deprecatedSkipped}`);
  console.log(`  enums recovered     : ${stats.enumsRecovered}  (from descriptions)`);
  if (stats.budgetTruncated > 0) {
    const names = stats.budgetTruncatedResources;
    console.log(`  budget truncated    : ${stats.budgetTruncated} blocks in ${names.length} resources`);
    for (const name of names.slice(0, 8)) console.log(`      ${name}`);
  }
  if (stats.depthTruncated > 0) {
    console.log(`  depth truncated     : ${stats.depthTruncated}`);
  }

  const unsupported = Object.entries(stats.unsupportedTypes).sort((a, b) => b[1] - a[1]);
  const total = unsupported.reduce((sum, [, count]) => sum + count, 0);
  if (total > 0) {
    console.log(`  unsupported types   : ${total} attributes across ${unsupported.length} shapes`);
    for (const [shape, count] of unsupported.slice(0, 8)) {
      console.log(`      ${String(count).padStart(5)}  ${shape}`);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const providerId = requireArg(args, "provider");
  const profile = PROFILES[providerId];
  if (!profile) {
    throw new Error(`unknown provider "${providerId}", expected one of ${Object.keys(PROFILES).join(", ")}`);
  }

  const schemaPath = requireArg(args, "schema");
  const outPath = args.get("out") ?? `lib/providers/${providerId}/generated.ts`;
  const includePrefix = args.get("include");

  const loaded = readProviderSchema(schemaPath);
  const { key } = selectProviderSchema(loaded.schema);
  const schema = loaded.schema;

  const result = convertProviderSchema(schema, {
    providerPrefix: profile.prefix,
    ...(includePrefix ? { include: (type: string) => type.startsWith(includePrefix) } : {}),
  });

  if (args.has("catalog")) {
    const outDir = args.get("out") ?? "public/catalog";
    const emitted = emitCatalog(result.resources, {
      providerId,
      providerVersion: key,
      outDir,
      ...(profile.overrides ? { overrides: profile.overrides } : {}),
    });

    console.log(`${profile.displayName} catalog -> ${outDir}/${providerId}/`);
    console.log(`  schema read as      : ${loaded.encoding}, ${(loaded.bytes / 1024 / 1024).toFixed(1)} MB`);
    printStats(result.stats);
    console.log(`  resources written   : ${emitted.total} (${emitted.curated} curated)`);
    if (emitted.inference) {
      const { resourcesWithSlots, slotsInferred, topTargets } = emitted.inference;
      const share = Math.round((resourcesWithSlots / emitted.total) * 100);
      console.log(`  connectable         : ${resourcesWithSlots} (${share}%), ${slotsInferred} slots inferred`);
      for (const [target, count] of topTargets.slice(0, 5)) {
        console.log(`      ${String(count).padStart(4)}  -> ${target}`);
      }
    }
    console.log(`  index.json          : ${(emitted.indexBytes / 1024).toFixed(0)} KB`);
    console.log(`  resource files      : ${(emitted.resourceBytes / 1024 / 1024).toFixed(1)} MB total, ` +
      `${(emitted.resourceBytes / emitted.total / 1024).toFixed(1)} KB average
`);
    return;
  }

  let resources = result.resources;
  if (args.has("tier1")) {
    if (!profile.overrides) throw new Error(`no overrides defined for provider "${providerId}"`);
    const applied = applyOverrides(resources, profile.overrides);
    resources = applied.resources;

    console.log(`
curated tier-1: ${resources.length} of ${profile.overrides.tier1.length} requested`);
    if (applied.missing.length > 0) {
      // A tier-1 entry the schema does not contain is a typo or a renamed resource, and would
      // otherwise vanish silently from the palette.
      console.log(`  NOT FOUND IN SCHEMA: ${applied.missing.join(", ")}`);
    }
    const withSlots = resources.filter((entry) => entry.slots.length > 0).length;
    const slotCount = resources.reduce((sum, entry) => sum + entry.slots.length, 0);
    console.log(`  slots curated : ${slotCount} across ${withSlots} resources`);
  }

  const source = emitResourceModule(resources, {
    providerName: profile.displayName,
    providerVersion: key,
    exportName: `${providerId}GeneratedResources`,
    curated: args.has("tier1"),
    // Counted before the tier-1 filter, so it matches what `--catalog` writes into
    // `public/catalog/` and the UI can report it without fetching anything.
    catalogSize: result.resources.length,
    catalogSizeExportName: `${providerId}CatalogSize`,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, source);

  console.log(`\n${profile.displayName} -> ${outPath}`);
  if (!args.has("tier1")) printStats(result.stats);
  console.log(`  output size         : ${(source.length / 1024).toFixed(0)} KB\n`);
}

main();
