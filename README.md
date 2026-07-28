# Terraform Visualizer

Design cloud infrastructure on a canvas, then export it as Terraform.

Pick a cloud provider, drag resources onto a graph, connect them, and generate a configuration
in either HCL (`main.tf`) or Terraform's native JSON syntax (`main.tf.json`). Connections are
not decoration: joining a subnetwork to a VPC emits a real reference.

```hcl
resource "google_compute_subnetwork" "web" {
  name          = "web"
  ip_cidr_range = "10.0.1.0/24"
  region        = "us-central1"
  network       = google_compute_network.main.id
}
```

Google Cloud is implemented. AWS and Azure are listed in the picker and are next up.

## Editor

- **Search** the palette by display name, Terraform type, description or category
- **Undo and redo** with `Ctrl`/`Cmd`+`Z` and `Ctrl`/`Cmd`+`Shift`+`Z`; a run of edits to one
  field collapses into a single step
- **Right-click** a node to duplicate or delete it, an edge to remove the connection, or the
  canvas to tidy the layout, fit the view, export or clear
- **Tidy layout** arranges resources into columns by how deep they sit in the reference chain
- **Export a PNG** of the graph, or the configuration itself as HCL or JSON
- **Light, dark or system** theme, remembered between visits

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000>.

| Command              | What it does                |
| -------------------- | --------------------------- |
| `npm run dev`        | Development server          |
| `npm run build`      | Production build            |
| `npm test`           | Run the test suite once     |
| `npm run test:watch` | Run tests in watch mode     |
| `npm run typecheck`  | Type-check without emitting |
| `npm run lint`       | ESLint                      |

## How it works

The graph is compiled into a provider-neutral intermediate representation, and the two output
formats are independent pure functions over that IR:

```
Provider catalog  ->  Canvas graph  ->  Compiler  ->  IR  ->  HCL
   (schema data)      (React Flow)     (validate)          -> JSON
```

| Layer       | Location                          | Responsibility                                         |
| ----------- | --------------------------------- | ------------------------------------------------------ |
| Catalog     | `lib/providers/`                  | Declares which resources exist, their fields and slots |
| Graph       | `lib/graph/`                      | Canvas state and connection rules                      |
| Compiler    | `lib/terraform/compile.ts`        | Validates the graph and lowers it to the IR            |
| IR          | `lib/terraform/ir.ts`             | Provider-neutral description of a configuration        |
| Serializers | `lib/terraform/hcl.ts`, `json.ts` | Render the IR                                          |

Three properties fall out of this split and are worth preserving:

- **The compiler and serializers never touch React.** They are plain functions over plain
  data, which is why most of the test suite needs no DOM.
- **The UI is generated from the catalog.** The properties panel builds itself from a
  resource's `fields`, and node handles from its `slots`. Adding a resource type does not mean
  writing a component.
- **Adding a provider is adding data.** AWS support means writing `lib/providers/aws/` and
  flipping `available` to `true` in the registry.

The HCL writer is hand-rolled because JavaScript has no maintained one — the `hcl` package was
last published in 2014, and `@cdktf/hcl-tools` converts in the opposite direction. Output is
formatted to match `terraform fmt`, including `=` alignment, so generated files drop into a
repository without reformatting noise.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), which walks through adding a resource to the catalog —
the most useful first contribution, and usually a data-only change.

## Licence

Not yet chosen. A licence must be added before this is published publicly.
