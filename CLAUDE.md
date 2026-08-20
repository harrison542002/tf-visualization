# CLAUDE.md

Canvas-based Terraform authoring tool. Next.js App Router, React Flow, Tailwind 4, strict
TypeScript. Headed for open-source release, so readability and test coverage are requirements
rather than polish.

Read `CONTRIBUTING.md` before adding a resource or provider — it has the worked walkthrough.

## Commands

```bash
npm test
npm run codegen
npm run codegen:diff
npm run codegen:catalog
npm run typecheck  
npm run lint       
npm run dev        
```

Run all three of the first commands before considering a change done.

## Architecture

```
lib/providers/   catalog data: what resources exist, their fields and slots; palette search
lib/graph/       canvas state (zustand), connection rules, auto-layout, PNG export
lib/terraform/   ir.ts -> compile.ts -> hcl.ts | json.ts
lib/theme/       colour theme preference
codegen/         provider schema -> ResourceSchema; overrides/ is the curation layer
components/      UI, generated from the catalog
```

Data flows one way: catalog + graph -> `compileGraph` -> `TfDocument` -> serializer.

## Invariants worth protecting

- **`lib/terraform/` imports no React and no React Flow.** `CompileNode` and `CompileEdge` in
  `lib/graph/types.ts` are structural subsets that real React Flow objects satisfy. This is why
  most tests need no DOM.
- **`compileGraph` never throws for bad user input.** Everything wrong with a graph comes back
  as a `Diagnostic` so the export dialog can list it. Throwing is reserved for programmer
  error, such as a non-finite number reaching a serializer.
- **UI is schema-driven.** The properties panel renders from `ResourceSchema.fields`; node
  handles render from `slots`. Adding a resource type must not require a new component.
- **Both serializers escape `${` and `%{`.** String values in `.tf.json` are evaluated as
  templates exactly as in HCL, so this is not HCL-only. Note that `String.replace` treats `$$`
  in a *replacement string* as an escape — both serializers use function replacements to avoid
  silently collapsing `$${` back to `${`.
- **Output order is deterministic.** Resources sort by type then name; attributes follow schema
  order. Snapshot tests depend on it.
- **Edge direction is referenced -> referencing.** `edge.source` is the resource being pointed
  at (a VPC); `edge.target` holds the slot and writes the reference (a subnetwork).
  `edge.targetHandle` is the slot id.
- **Every graph mutation goes through `commit()` in the store.** That is what makes it
  undoable. Passing a tag coalesces a run of edits (all the keystrokes in one field) into a
  single history step; omitting it starts a new step.
- **Dark mode is class-based, not media-based.** `@custom-variant dark` in `globals.css` keys
  off `.dark` on `<html>`, so an explicit choice can override the OS. The inline script in
  `app/layout.tsx` sets that class before first paint and must stay in step with
  `THEME_STORAGE_KEY`.

## Testing

Tests sit beside their source as `*.test.ts(x)`. `lib/providers/registry.test.ts` structurally
validates the whole catalog, so new schemas get baseline coverage for free.

Serializer tests assert exact output strings, including `=` alignment, because matching
`terraform fmt` is a feature. Do not loosen them to fragment matching when they fail — check
whether the formatting change was intended first.
