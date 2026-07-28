# CLAUDE.md

Canvas-based Terraform authoring tool. Next.js App Router, React Flow, Tailwind 4, strict
TypeScript. Headed for open-source release, so readability and test coverage are requirements
rather than polish.

Read `CONTRIBUTING.md` before adding a resource or provider — it has the worked walkthrough.

## Commands

```bash
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run dev         # dev server on :3000
```

Run all three of the first commands before considering a change done.

## Architecture

```
lib/providers/   catalog data: what resources exist, their fields and slots; palette search
lib/graph/       canvas state (zustand), connection rules, auto-layout, PNG export
lib/terraform/   ir.ts -> compile.ts -> hcl.ts | json.ts
lib/theme/       colour theme preference
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

## Gotchas

- React Flow requires `"use client"` and `@xyflow/react/dist/style.css`.
- **The canvas needs an unbroken definite-height chain from `<html>` down.** `app/layout.tsx`
  uses `h-full` on both `html` and `body`; switching `body` to `min-h-full` makes its height
  `auto`, every percentage and `flex-1` below it indefinite, and collapses the canvas to zero
  with React Flow warning #004. The symptom is a blank canvas area, not an exception.
- Node data must satisfy `Record<string, unknown>` for React Flow's generics; hence the index
  signature on `ResourceNodeData`.
- Controlled inputs backed by parsed values (the `stringList` field) keep their raw text in
  local state. Deriving the text from the parsed array eats the separator as it is typed. See
  `StringListInput` in `components/panel/FieldInput.tsx`.
- **PNG export needs *measured* nodes.** Use `getNodesBounds` from the `useReactFlow` hook,
  never the bare import — only the hook form sees measured dimensions. Unmeasured nodes give a
  zero-area box, `getViewportForBounds` then returns a NaN zoom, and a NaN transform makes
  `html-to-image` hang rather than throw. `exportImage.ts` rejects such bounds up front.
- Font embedding is switched off for the export (`skipFonts`). Inlining the 17 `@font-face`
  rules this app loads dominates the export; text falls back down the same font stack.
- `npm audit` reports issues in Next's own transitive `postcss` and `sharp`. The only offered
  fix downgrades Next to 9.3.3; leave them.
