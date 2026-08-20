/**
 * Reads a provider schema dump, whatever encoding it was written in.
 *
 * `tofu providers schema -json > schema.json` produces UTF-8 from a POSIX shell but UTF-16LE
 * from PowerShell, which is the usual way these files get made on Windows. A UTF-16 file is
 * exactly twice the size and fails `JSON.parse` on its first byte, so detecting the byte order
 * mark here saves the caller from an error that looks like a corrupt download.
 */

import { readFileSync } from "node:fs";

import type { ProviderSchemaJson } from "./convert";

export type SchemaEncoding = "utf8" | "utf8-bom" | "utf16le" | "utf16be";

export interface LoadedSchema {
  readonly schema: ProviderSchemaJson;
  readonly encoding: SchemaEncoding;
  readonly bytes: number;
}

function decode(buffer: Buffer): { text: string; encoding: SchemaEncoding } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf16le" };
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // Node has no utf16be decoder, so swap the byte pairs and reuse the LE one.
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le"), encoding: "utf16be" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf8-bom" };
  }

  return { text: buffer.toString("utf8"), encoding: "utf8" };
}

export function readProviderSchema(path: string): LoadedSchema {
  const buffer = readFileSync(path);
  const { text, encoding } = decode(buffer);

  let schema: ProviderSchemaJson;
  try {
    schema = JSON.parse(text) as ProviderSchemaJson;
  } catch (cause) {
    throw new Error(
      `${path} is not valid JSON after decoding as ${encoding}: ${(cause as Error).message}`,
    );
  }

  if (!schema.provider_schemas) {
    throw new Error(`${path} has no provider_schemas — is it a schema dump?`);
  }

  return { schema, encoding, bytes: buffer.length };
}
