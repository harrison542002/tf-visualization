# Contributing

## Project layout

```
app/                      Next.js App Router entry
components/
  canvas/                 React Flow canvas, palette, node renderer
  panel/                  Properties panel and the generic field editor
  generate/               Export dialog
  wizard/                 Provider selection
lib/
  providers/              Resource catalog (the data)
    types.ts              Provider-agnostic schema vocabulary
    registry.ts           Provider lookup
    gcp/                  Google Cloud resources
  graph/                  Canvas state and connection rules
  terraform/              IR, compiler and serializers
```

Tests live beside the code they cover as `*.test.ts` / `*.test.tsx`.

Before opening a pull request:

```bash
npm test && npm run typecheck && npm run lint
```

## Adding a resource

This is the most common contribution and usually needs no React at all. Say we are adding
`google_compute_router_nat`.

### 1. Describe it

Add the schema to the right file under `lib/providers/gcp/` — `network.ts` here. A resource is
data: the fields a user can edit, and the slots it can be connected through.

```ts
export const computeRouterNat: ResourceSchema = {
  type: "google_compute_router_nat",
  displayName: "Cloud NAT",
  category: "network",
  description: "Outbound internet access for instances without public IPs.",
  fields: [
    { key: "name", label: "Name", type: "string", required: true, placeholder: "nat" },
    {
      key: "nat_ip_allocate_option",
      label: "IP allocation",
      type: "enum",
      required: true,
      options: ["AUTO_ONLY", "MANUAL_ONLY"],
      defaultValue: "AUTO_ONLY",
    },
  ],
  slots: [
    {
      id: "router",
      label: "Router",
      targetType: "google_compute_router",
      targetAttribute: "name",
      cardinality: "one",
      required: true,
    },
  ],
};
```

`FieldSchema.key` and `ConnectionSlot.id` are written to the output verbatim, so they must be
the real Terraform attribute names.

### 2. Register it

Add it to the exported array at the bottom of the file. `lib/providers/gcp/index.ts` picks it
up from there.

```ts
export const networkResources: readonly ResourceSchema[] = [
  computeNetwork,
  computeSubnetwork,
  computeFirewall,
  computeRouter,
  computeRouterNat,
];
```

That is normally the whole change. The palette, the node with its handles, the properties
panel form, connection validation and both serializers are all driven by the schema.

### 3. Only if the output nests

Most resources map to flat attributes. When Terraform's schema genuinely nests — as
`google_compute_firewall` does with `allow { ... }` — add a `build` function. It receives the
attributes the default builder produced, so it only has to relocate what it owns:

```ts
build: ({ field, defaultAttributes }) => {
  const protocol = field.string("protocol") ?? "tcp";
  return tfBlock(omitAttributes(defaultAttributes, ["protocol", "ports"]), [
    nestedBlock("allow", tfBlock([attr("protocol", tfString(protocol))])),
  ]);
},
```

Reach for this only when the flat mapping cannot express the resource. `computeInstance` in
`lib/providers/gcp/compute.ts` is the fullest worked example.

### 4. Tests

`lib/providers/registry.test.ts` runs structural checks over every resource automatically —
dangling slot targets, enum defaults that are not in `options`, duplicate keys, defaults whose
type does not match the field. A new schema is covered by those the moment it is registered.

Write a test of your own when you add a `build` override, asserting the generated HCL. See the
`compileGraph with build overrides` block in `lib/terraform/compile.test.ts`.

## Adding a provider

1. Create `lib/providers/<id>/` with resource schemas and an `index.ts` exporting a
   `ProviderDefinition`.
2. Replace the `comingSoon(...)` entry in `lib/providers/registry.ts` with it.

Nothing in `components/`, `lib/graph/` or `lib/terraform/` should need to change. If it does,
that is a sign the abstraction is leaking and worth raising in the pull request.

## Conventions

- **Strict types.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Avoid
  `any` and non-null assertions; prefer narrowing.
- **Keep `lib/terraform/` free of React.** It is pure by design, which is what makes it cheap
  to test.
- **Comments explain why, not what.** The reason a line exists is worth writing down; a
  restatement of the code is not.
- **Serializer output is asserted exactly.** Formatting is a feature — generated files should
  survive `terraform fmt` unchanged — so tests pin whole strings rather than fragments.
