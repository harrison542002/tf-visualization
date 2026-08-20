/**
 * Recovers enum options from attribute descriptions.
 *
 * Terraform provider schemas have no concept of an enum: `routing_mode` is typed `string` with
 * no hint that only `REGIONAL` and `GLOBAL` are legal. The Google provider does write the
 * constraint into the description, though, in a handful of recognisable shapes — measured at
 * 1079 of 23317 string attributes (4.6%), overwhelmingly the bracketed form.
 *
 * Turning those into real dropdowns is the single largest automatic quality win available from
 * the schema alone, so it is worth parsing carefully and refusing anything ambiguous.
 */

/** Longest option list worth turning into a dropdown; beyond this a free-text box is kinder. */
const MAX_OPTIONS = 40;

/** `Possible values: ["A", "B"]` — by far the most common shape. */
const BRACKETED = /Possible values:\s*\[([^\]]+)\]/i;

/** `Possible values are: 'A', 'B'` and `Supported values include: A, B.` */
const COMMA_LIST =
  /(?:Possible values are|Supported values (?:include|are)|Must be one of|One of):\s*([^.\n]+)/i;

const stripQuotes = (value: string): string => value.replace(/^["'`]|["'`]$/g, "").trim();

function clean(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const raw of values) {
    const value = stripQuotes(raw.trim()).replace(/\.$/, "");
    // Options are provider constants: uppercase words, digits, dashes and dots. Anything with
    // spaces or prose punctuation is a sentence that happened to match, not a value.
    if (!value || value.length > 60 || /\s/.test(value)) continue;
    if (!/^[A-Za-z0-9_.\-/]+$/.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push(value);
  }

  return options;
}

/**
 * Returns the enum options a description declares, or `undefined` when it declares none.
 *
 * A single option is rejected: it is almost always a default being mentioned in prose rather
 * than a genuine one-value enum.
 */
export function recoverEnumOptions(description: string | undefined): readonly string[] | undefined {
  if (!description) return undefined;

  const bracketed = BRACKETED.exec(description);
  if (bracketed?.[1]) {
    const options = clean(bracketed[1].split(","));
    if (options.length >= 2 && options.length <= MAX_OPTIONS) return options;
    return undefined;
  }

  const list = COMMA_LIST.exec(description);
  if (list?.[1]) {
    // Trailing "and X" is common in prose lists.
    const options = clean(list[1].replace(/\band\b/gi, ",").split(","));
    if (options.length >= 2 && options.length <= MAX_OPTIONS) return options;
  }

  return undefined;
}
