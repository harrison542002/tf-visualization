# CLAUDE.md

Canvas-based Terraform authoring tool. Next.js App Router, React Flow, Tailwind 4, strict
TypeScript. Headed for open-source release, so readability and test coverage are requirements
rather than polish.

Read `CONTRIBUTING.md` before adding a resource or provider — it has the worked walkthrough.

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run codegen
npm run codegen:diff
npm run codegen:catalog
npm run dev
```

Run the first three before considering a change done. CI (`.github/workflows/ci.yml`) runs the
same three on every push and pull request, so a red pipeline means one of them was skipped.

## Architecture

```
lib/providers/   catalog data: what resources exist, their fields and slots; palette search
lib/graph/       canvas state (zustand), connection rules, auto-layout, PNG export
lib/terraform/   ir.ts -> compile.ts -> hcl.ts | json.ts; parse.ts reads HCL back in
lib/theme/       colour theme preference
codegen/         provider schema -> ResourceSchema; overrides/ is the curation layer
components/      UI, generated from the catalog
hooks/           shared React hooks; components hold none of their own
tests/           mirrors the tree above, one `*.test.ts(x)` per source file
```

Data flows one way: catalog + graph -> `compileGraph` -> `TfDocument` -> serializer.

## Invariants worth protecting
- React Compiler is on, so nothing is memoised by hand.
- Only add necessary comment, do not require to add explanation comment.

## Testing

Tests live in `tests/`, mirroring the source tree: `lib/terraform/hcl.ts` is covered by
`tests/lib/terraform/hcl.test.ts`. They import through the `@/` alias, never a relative path, so
a file can be moved without rewriting its test's imports.
`tests/lib/providers/registry.test.ts` structurally validates the whole catalog, so new schemas
get baseline coverage for free.