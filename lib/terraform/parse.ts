/**
 * Reads HCL2 into a structural syntax tree.
 *
 * The counterpart to `hcl.ts`, and hand-written for the same reason: the only browser-ready
 * HCL parser is `@cdktf/hcl2json`, 1.8 MB of Go compiled to WASM, which is a poor trade for an
 * occasional import.
 *
 * The important simplification is that this **structures** HCL rather than evaluating it. A
 * value it cannot represent — a function call, a `for` expression, `var.region` — is kept
 * verbatim as an `expression`, which still lets references be found inside it and means a real
 * config parses instead of failing. Nothing here resolves variables, locals or modules.
 */

export type HclValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "null" }
  | { readonly kind: "list"; readonly items: readonly HclValue[] }
  | { readonly kind: "object"; readonly entries: readonly HclEntry[] }
  /** Anything not evaluated: references, interpolations, functions, arithmetic. */
  | { readonly kind: "expression"; readonly text: string };

export interface HclEntry {
  readonly key: string;
  readonly value: HclValue;
}

export interface HclBlock {
  /** `resource`, `provider`, `variable`, ... */
  readonly type: string;
  /** Quoted labels after the type, e.g. `["google_compute_network", "main"]`. */
  readonly labels: readonly string[];
  readonly attributes: readonly HclEntry[];
  readonly blocks: readonly HclBlock[];
  readonly line: number;
}

export interface ParseError {
  readonly message: string;
  readonly line: number;
}

export interface ParseResult {
  readonly blocks: readonly HclBlock[];
  readonly errors: readonly ParseError[];
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;

/**
 * Scanner over the source text.
 *
 * Recursive descent straight on the string, with no separate token stream: the grammar is
 * small enough that a token layer would be more code than it saves.
 */
class Scanner {
  private index = 0;
  readonly errors: ParseError[] = [];

  constructor(private readonly source: string) {}

  get done(): boolean {
    return this.index >= this.source.length;
  }

  get line(): number {
    let line = 1;
    for (let i = 0; i < this.index && i < this.source.length; i += 1) {
      if (this.source[i] === "\n") line += 1;
    }
    return line;
  }

  peek(offset = 0): string {
    return this.source[this.index + offset] ?? "";
  }

  startsWith(text: string): boolean {
    return this.source.startsWith(text, this.index);
  }

  advance(count = 1): string {
    const taken = this.source.slice(this.index, this.index + count);
    this.index += count;
    return taken;
  }

  error(message: string): void {
    this.errors.push({ message, line: this.line });
  }

  /** Skips whitespace and comments. `stopAtNewline` leaves the newline in place. */
  skipTrivia(stopAtNewline = false): void {
    for (;;) {
      const char = this.peek();

      if (char === "\n" && stopAtNewline) return;
      if (char === " " || char === "\t" || char === "\r" || char === "\n") {
        this.index += 1;
        continue;
      }

      if (char === "#" || (char === "/" && this.peek(1) === "/")) {
        while (!this.done && this.peek() !== "\n") this.index += 1;
        continue;
      }

      if (char === "/" && this.peek(1) === "*") {
        this.index += 2;
        while (!this.done && !this.startsWith("*/")) this.index += 1;
        if (this.done) this.error("unterminated block comment");
        else this.index += 2;
        continue;
      }

      return;
    }
  }

  readIdentifier(): string {
    if (!IDENT_START.test(this.peek())) return "";
    let text = "";
    while (!this.done && IDENT_CHAR.test(this.peek())) text += this.advance();
    return text;
  }

  /** Reads a quoted string, returning its raw body with escapes still intact. */
  readQuoted(): string {
    if (this.peek() !== '"') return "";
    this.advance();

    let raw = "";
    while (!this.done && this.peek() !== '"') {
      if (this.peek() === "\\") {
        raw += this.advance(2);
        continue;
      }
      raw += this.advance();
    }

    if (this.done) this.error("unterminated string");
    else this.advance();
    return raw;
  }
}

const unescape = (raw: string): string =>
  raw
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

/** True when a quoted body contains a template that must be preserved verbatim. */
const isTemplated = (raw: string): boolean => /\$\{|%\{/.test(raw.replace(/\$\$\{|%%\{/g, ""));

function parseHeredoc(scanner: Scanner): HclValue {
  scanner.advance(2); // <<
  if (scanner.peek() === "-") scanner.advance();

  const marker = scanner.readIdentifier();
  if (!marker) {
    scanner.error("heredoc with no marker");
    return { kind: "expression", text: "" };
  }

  // Body runs to a line containing only the marker.
  while (!scanner.done && scanner.peek() !== "\n") scanner.advance();
  scanner.advance();

  const lines: string[] = [];
  for (;;) {
    if (scanner.done) {
      scanner.error(`unterminated heredoc <<${marker}`);
      break;
    }
    let line = "";
    while (!scanner.done && scanner.peek() !== "\n") line += scanner.advance();
    scanner.advance();
    if (line.trim() === marker) break;
    lines.push(line);
  }

  return { kind: "string", value: lines.join("\n") };
}

function parseList(scanner: Scanner): HclValue {
  scanner.advance(); // [
  const items: HclValue[] = [];

  for (;;) {
    scanner.skipTrivia();
    if (scanner.done) {
      scanner.error("unterminated list");
      break;
    }
    if (scanner.peek() === "]") {
      scanner.advance();
      break;
    }

    items.push(parseValue(scanner));
    scanner.skipTrivia();
    if (scanner.peek() === ",") scanner.advance();
  }

  return { kind: "list", items };
}

function parseObject(scanner: Scanner): HclValue {
  scanner.advance(); // {
  const entries: HclEntry[] = [];

  for (;;) {
    scanner.skipTrivia();
    if (scanner.done) {
      scanner.error("unterminated object");
      break;
    }
    if (scanner.peek() === "}") {
      scanner.advance();
      break;
    }

    // Keys may be bare or quoted, and separated by either `=` or `:`.
    const key = scanner.peek() === '"' ? unescape(scanner.readQuoted()) : scanner.readIdentifier();
    if (!key) {
      scanner.error("expected an object key");
      scanner.advance();
      continue;
    }

    scanner.skipTrivia();
    if (scanner.peek() === "=" || scanner.peek() === ":") scanner.advance();

    entries.push({ key, value: parseValue(scanner) });
    scanner.skipTrivia();
    if (scanner.peek() === ",") scanner.advance();
  }

  return { kind: "object", entries };
}

/**
 * Reads an unrecognised expression verbatim, up to the end of the value.
 *
 * Balances brackets and skips over strings so that a comma inside `join(",", x)` does not end
 * the expression early.
 */
function readBareExpression(scanner: Scanner): string {
  let text = "";
  let depth = 0;

  for (;;) {
    if (scanner.done) break;
    const char = scanner.peek();

    if (char === '"') {
      text += '"' + scanner.readQuoted() + '"';
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) break;
      depth -= 1;
    }
    if (depth === 0 && (char === "\n" || char === ",")) break;
    if (char === "#" || (char === "/" && scanner.peek(1) === "/")) break;

    text += scanner.advance();
  }

  return text.trim();
}

function parseValue(scanner: Scanner): HclValue {
  scanner.skipTrivia();
  const char = scanner.peek();

  if (char === '"') {
    const raw = scanner.readQuoted();
    // A templated string keeps its markers so references inside it remain findable.
    return isTemplated(raw)
      ? { kind: "expression", text: `"${raw}"` }
      : { kind: "string", value: unescape(raw) };
  }
  if (char === "[") return parseList(scanner);
  if (char === "{") return parseObject(scanner);
  if (scanner.startsWith("<<")) return parseHeredoc(scanner);

  const text = readBareExpression(scanner);
  if (text === "true" || text === "false") return { kind: "bool", value: text === "true" };
  if (text === "null") return { kind: "null" };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { kind: "number", value: Number(text) };
  return { kind: "expression", text };
}

/** Parses a block body up to its closing brace. */
function parseBody(scanner: Scanner): { attributes: HclEntry[]; blocks: HclBlock[] } {
  const attributes: HclEntry[] = [];
  const blocks: HclBlock[] = [];

  for (;;) {
    scanner.skipTrivia();
    if (scanner.done) {
      scanner.error("unterminated block");
      break;
    }
    if (scanner.peek() === "}") {
      scanner.advance();
      break;
    }

    const line = scanner.line;
    const name = scanner.readIdentifier();
    if (!name) {
      scanner.error(`unexpected character "${scanner.peek()}"`);
      scanner.advance();
      continue;
    }

    scanner.skipTrivia(true);

    if (scanner.peek() === "=") {
      scanner.advance();
      attributes.push({ key: name, value: parseValue(scanner) });
      continue;
    }

    // Otherwise it is a nested block, optionally with labels.
    const labels: string[] = [];
    for (;;) {
      scanner.skipTrivia(true);
      if (scanner.peek() === '"') labels.push(unescape(scanner.readQuoted()));
      else if (IDENT_START.test(scanner.peek()) && scanner.peek() !== "{") {
        labels.push(scanner.readIdentifier());
      } else break;
    }

    scanner.skipTrivia();
    if (scanner.peek() !== "{") {
      scanner.error(`expected "{" after ${name}`);
      continue;
    }
    scanner.advance();

    const body = parseBody(scanner);
    blocks.push({ type: name, labels, ...body, line });
  }

  return { attributes, blocks };
}

/** Parses a whole `.tf` document. Never throws; problems come back as `errors`. */
export function parseHcl(source: string): ParseResult {
  const scanner = new Scanner(source);
  const blocks: HclBlock[] = [];

  for (;;) {
    scanner.skipTrivia();
    if (scanner.done) break;

    const line = scanner.line;
    const type = scanner.readIdentifier();
    if (!type) {
      scanner.error(`unexpected character "${scanner.peek()}"`);
      scanner.advance();
      continue;
    }

    const labels: string[] = [];
    for (;;) {
      scanner.skipTrivia(true);
      if (scanner.peek() === '"') labels.push(unescape(scanner.readQuoted()));
      else if (IDENT_START.test(scanner.peek())) labels.push(scanner.readIdentifier());
      else break;
    }

    scanner.skipTrivia();
    if (scanner.peek() !== "{") {
      scanner.error(`expected "{" after ${type}`);
      continue;
    }
    scanner.advance();

    const body = parseBody(scanner);
    blocks.push({ type, labels, ...body, line });
  }

  return { blocks, errors: scanner.errors };
}

/** A `type.name.attribute` reference found inside an expression. */
export interface HclReference {
  readonly resourceType: string;
  readonly localName: string;
  readonly attribute: string;
}

/** Prefixes that look like references but address something other than a resource. */
const NON_RESOURCE = new Set(["var", "local", "each", "count", "data", "module", "path", "self"]);

const REFERENCE = /\b([a-z][a-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;

/** Extracts every resource reference in an expression, in order. */
export function findReferences(text: string): readonly HclReference[] {
  const found: HclReference[] = [];

  for (const match of text.matchAll(REFERENCE)) {
    const [, resourceType, localName, attribute] = match;
    if (!resourceType || !localName || !attribute) continue;
    if (NON_RESOURCE.has(resourceType)) continue;
    found.push({ resourceType, localName, attribute });
  }

  return found;
}

/** Collects references from a value tree, including inside lists and objects. */
export function referencesIn(value: HclValue): readonly HclReference[] {
  switch (value.kind) {
    case "expression":
      return findReferences(value.text);
    case "list":
      return value.items.flatMap(referencesIn);
    case "object":
      return value.entries.flatMap((entry) => referencesIn(entry.value));
    default:
      return [];
  }
}
