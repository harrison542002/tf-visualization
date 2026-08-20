/**
 * Reports what conversion loses against the hand-written catalog.
 *
 *   npm run codegen:diff -- --schema <path>
 *
 * Compares only the resource types the catalog already covers, since those are the ones with a
 * known-good hand-written answer to measure against.
 */

import { gcpProvider } from "@/lib/providers/gcp";
import { convertProviderSchema } from "./convert";
import { diffCatalogs, formatDiff } from "./diff";
import { readProviderSchema } from "./readSchema";

function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args.set(token.slice(2), "true");
    } else {
      args.set(token.slice(2), next);
      index += 1;
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const schemaPath = args.get("schema");
  if (!schemaPath) throw new Error("missing required argument --schema");

  const handWritten = gcpProvider.resources;
  const wanted = new Set(handWritten.map((resource) => resource.type));

  const { schema } = readProviderSchema(schemaPath);
  const { resources } = convertProviderSchema(schema, {
    providerPrefix: "google_",
    include: (type) => wanted.has(type),
  });

  const summary = diffCatalogs(handWritten, resources);
  console.log(formatDiff(summary, { verbose: args.has("verbose") }));
}

main();
