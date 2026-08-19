# IFClite as an upstream for Reviter — 2026-08-19

[IFClite](https://github.com/LTplus-AG/ifc-lite) (`LTplus-AG/ifc-lite`, MPL-2.0,
head `6ce17fa` on 2026-08-19) is a client-side IFC toolkit: a Rust core compiled
to WebAssembly, 42 publishable npm packages, six Rust crates, a WebGPU renderer,
a CLI and an MCP server. This entry records what it has, what Reviter has, what
is worth taking, and what four probes against Reviter's own output actually
showed. Every figure below is from a run on 2026-08-19 against the packages'
then-current npm versions; nothing here recomputes.

## The two projects do not overlap where it matters

Reviter's whole difficulty is upstream of IFC. It opens a proprietary,
undocumented container and recovers element identity, categories, parameters,
levels, materials and geometry by measurement. IFClite starts where a valid IFC
file already exists. Neither can do the other's job: IFClite cannot read an RVT,
and Reviter has no IFC query engine, no IDS validator, no BCF writer and no
schema registry.

That means the relationship is **downstream consumption, not replacement**.
Reviter's `makeIfc` is the seam. Everything IFClite is good at attaches to
Reviter's *output*, not to its decoders.

The one place they genuinely compete is the paired-reference reader
(`lib/reviter/ifc-reference.ts`, currently `web-ifc`), and there the incumbent
wins on size — see below.

## What each side has

| Capability | Reviter | IFClite |
| --- | --- | --- |
| Read `.rvt` / `.rfa` / `.rte` / `.rft` | yes — the entire project | no |
| Read `.dwg` | yes (`libredwg-web`) | no |
| Native Revit categories, parameters, types, identity, host/level relations | yes | n/a |
| Read IFC | reference analysis only, via `web-ifc` | first-class: columnar store, 100% IFC4/IFC4X3 schema coverage, IFC2X3, IFC5/IFCX |
| Write IFC | `export-ifc.ts`, IFC4 Reference View, 1,023 lines, Reviter-specific psets | `@ifc-lite/create` (author from scratch), `@ifc-lite/export` (`exportToStep`, schema conversion) |
| IFC query / SQL | no — `ObjectList`/`PropertiesDock` browse one decoded model | `@ifc-lite/query`, incl. DuckDB-WASM SQL |
| IDS validation | no | `@ifc-lite/ids` (+ EN/DE/FR reporting) |
| BCF issues | bespoke JSON sidecars (`review-exchange.ts`) | `@ifc-lite/bcf`, BCF read/write with viewpoints |
| Clash detection | no | `@ifc-lite/clash` (+ BCF output) |
| Model diff | `regression.ts` — RVT vs paired IFC | `@ifc-lite/diff` — IFC vs IFC |
| 2D drawings | `architectural-plan.ts` + `makePlanSvg` (1,210 + 270 lines), from recovered RVT geometry | `@ifc-lite/drawing-2d` — section cutter, hidden-line, hatch, SVG/PDF, from IFC meshes |
| Export formats | GLB, OBJ, DXF, SVG, IFC, JSON audit | glTF/GLB, STEP, Parquet, CSV, JSON-LD, IFCX, USD |
| Renderer | Three.js, with walk mode, markup, comments, floor browser | WebGPU renderer + Three.js/Babylon adapters |
| Filter/colourise by rule | ad-hoc in `scene.ts` | `@ifc-lite/lens` |
| Schedules / property tables | no | `@ifc-lite/lists` |
| MCP server for agents | no | `@ifc-lite/mcp` |
| Licence | none declared | MPL-2.0 |

## What four probes showed

All four ran on Node 22.22.2, packages installed straight from npm, no Rust
toolchain, no browser. The fixture is the `ConvertResult` from
`tests/export-ifc.test.ts` put through `makeIfc` — 86 STEP entities, one
`IfcWall`, one `IfcDoor`.

**1. IFClite parses Reviter's IFC without a single change to either side.**
`@ifc-lite/parser@4.1.0` returned schema `IFC4`, 86 entities, and a spatial
hierarchy that reproduced Reviter's own tree — project → site → building →
`Revit level 30` (elevation 3.048 m) → elements `#39`, `#60`. Type mapping,
GUIDs, names and the type objects all survived:

```
IfcWall #39 name="Walls:Exterior Wall - 200mm:10" guid=0mOqkFO1FrHkTnosNapBqz geometry=true
   Reviter_Recovery -> RevitElementId=10 | RevitCategory=Walls | CategoryEvidence=native-token
                     | GeometryProvenance=native | GeometryExact=true | ...
   Reviter_RevitInstanceParameters -> Unconnected Height [-1001105]=3
IfcDoor #60 ... GeometryProvenance=reconstructed | GeometryExact=false
IfcWallType #54 name="Exterior Wall - 200mm"
IfcDoorType #72 name="Single Flush:0915 x 2134 mm"
```

The recovery evidence Reviter attaches is not just syntactically present, it is
readable by an independent implementation as ordinary property sets. That is the
strongest available check that `export-ifc.ts` emits real IFC and not something
only `web-ifc` tolerates.

**2. The geometry kernel tessellates it, in Node, and writes GLB.**
`@ifc-lite/geometry@3.8.3` `processAdaptive()` returned two meshes keyed by
express id (39 and 60), and `exportGlbFromMeshes` produced a 1,608-byte GLB. So
the same package is a viable `web-ifc` substitute *and* a headless verification
path for CI, which Reviter does not currently have.

**3. IDS validation works on the recovered model.** A one-rule IDS document
("every `IfcWall` carries `Reviter_Recovery.GeometryExact`") validated through
`@ifc-lite/ids@1.15.47` and reported `100% (1 pass / 0 fail, applicable 1)`.
This is the capability with no Reviter equivalent at all: a declarative,
buildingSMART-standard gate over a recovered model, which is exactly the shape
of the "validating on a second building" problem — an IDS file states what a
recovery must contain without being fitted to one project's byte offsets.

**4. BCF export works from Reviter-shaped review data.** `@ifc-lite/bcf@1.18.1`
took a camera (position/target/up/fov — engine-agnostic, so Reviter's Three.js
camera fits without adaptation), an IFC GUID selection and a comment, and wrote
a 1,884-byte `.bcfzip` containing `bcf.version`, `project.bcfp`, `markup.bcf`
and a `.bcfv` viewpoint. Reviter's comments and markup already carry viewpoints
and model-feet anchors; they are one mapping function away from a format other
BIM tools can open.

**And one negative result worth keeping.** `export-ifc.test.ts` notes that
`web-ifc` accepts malformed STEP REALs (`1E-9` where `1.E-9` is required), so
the round-trip is blind to that defect class. IFClite's parser is **equally
tolerant** — a fixture edited to `1E-5` parsed with no error and the same 86
entities. IFClite does not replace `nonConformingNumbers()`; that textual
conformance check stays load-bearing.

## Constraints on adopting any of it

**Licence.** IFClite is MPL-2.0 — file-level copyleft. Consuming the packages as
npm dependencies imposes nothing on Reviter's own source. *Copying* IFClite
source into `lib/` makes those files MPL-2.0 and they must keep their headers.
Prefer dependencies over vendoring. Separately, Reviter still declares no
licence of its own (README, "Publication note"); that should be settled before
this matters.

**Bundle size — the one place the incumbent wins.** Measured 2026-08-19:

| Binary | raw | gzipped |
| --- | --- | --- |
| `web-ifc@0.0.77` `web-ifc.wasm` | 1,303,940 B | 474,022 B |
| `@ifc-lite/wasm@4.7.0` `ifc-lite_bg.wasm` | 4,268,209 B | 1,455,955 B |

IFClite's WASM is 3.1× larger gzipped than `web-ifc`'s, against the project's
own "~1.2 MB gzipped" figure. Reviter already keeps IFC parsing behind a lazily
loaded worker (`ifc-worker.ts`), so this is paid only when someone pairs an IFC —
but it is a real cost and it argues against swapping `web-ifc` out on size
grounds alone. Swap only if IFClite's geometry proves measurably more faithful
on a real paired export, which no probe here tested.

**Build wiring.** Two very different costs:

- `@ifc-lite/parser`, `ids`, `bcf`, `lens`, `lists`, `diff` are plain ESM with no
  workers and no WASM. They drop into `package.json` and work — probes 1, 3 and 4
  needed nothing else.
- `@ifc-lite/geometry` spawns `new Worker(new URL('./geometry.worker.ts',
  import.meta.url), {type:'module'})` from inside `node_modules`. Vite resolves
  that; `scripts/build-pages.mjs` will not — it enumerates worker entry points by
  hand and copies `.wasm` files explicitly (lines 70–86). Adopting the geometry
  package means adding its worker as an esbuild entry point and copying
  `ifc-lite_bg.wasm` beside the others, then passing the copied URL through
  `wasmUrls`, which the package supports for exactly this reason.

**Cross-origin isolation.** The parallel geometry path prefers
`SharedArrayBuffer` but falls back to `ArrayBuffer` when it is absent, and the
shard-scan optimisation is additionally gated on files ≥ 8 MB and ≥ 2 workers.
GitHub Pages cannot send COOP/COEP headers, so the Pages deployment would get the
non-shared path — slower, not broken.

**Package manager.** IFClite is a pnpm workspace; Reviter is npm with a
committed `package-lock.json`. Irrelevant for consuming published packages,
relevant only if their repo is ever built locally (which also needs a nightly
Rust toolchain and `wasm-pack`).

**Install weight.** `@ifc-lite/parser` + `geometry` + `ids` + `bcf` pulled 25 MB
into `node_modules` (`data` 9.9 MB, `parser` 5.6 MB, `wasm` 4.5 MB). Dev-time
cost only; the shipped bundle is governed by tree-shaking and the WASM figures
above.

## What is worth taking, in order

**1. IFClite as an independent verifier of `makeIfc`, in CI.** Highest value,
lowest cost, no runtime bundle impact — a devDependency and a test. Today
`export-ifc.test.ts` checks Reviter's output with `web-ifc`, the same reader the
viewer uses; a second, independently implemented reader turns "our reader accepts
it" into "two unrelated readers accept it". Probe 1 is that test, already
working. Pair it with an IDS document asserting the invariants
`export-ifc.ts` promises (every product carries `Reviter_Recovery`,
`GeometryExact` is present and boolean, every element sits under a storey) and
`docs/validating-on-a-second-building.md` gains a gate that is not fitted to the
UNBC model.

**2. BCF export for comments and markup.** `review-exchange.ts` invents
`reviter-comments` and `reviter-markup` JSON. Those sidecars are fine for
Reviter-to-Reviter, but nothing else opens them. `@ifc-lite/bcf` writes the
format every BIM tool already reads, from data Reviter already stores, and it
brings only `jszip`. Keep the JSON as the native format; add BCF as an export.
Probe 4 shows the mapping is small.

**3. IDS validation in the studio.** Once the parser is in, a "check this
recovery against a requirements file" panel is mostly UI. It is also the first
Reviter feature that would be useful to someone who does not care how the RVT
was decoded.

**4. `@ifc-lite/lens` and `@ifc-lite/lists`.** Zero-dependency rule engines for
"colour by category / property" and "build a schedule table". Both are things
the studio does ad hoc in `scene.ts` and `ObjectList.tsx`; both are pure data
transforms that would work on Reviter's decoded elements with an adapter.

**5. Evaluate `@ifc-lite/geometry` against `web-ifc` on a real paired export —
before deciding anything.** This is the only swap with a real downside (3.1×
WASM). It needs a measurement on the supplied model, not an argument: same file,
both readers, compare element counts, per-element AABBs and wall depths through
the existing `verify-pair.ts` assertions. If IFClite is not clearly better on
fidelity, keep `web-ifc`.

## What is not worth taking

- **The WebGPU renderer.** Reviter's Three.js viewport carries walk mode, markup,
  comments, the floor browser, reference overlay and picking. Replacing the
  renderer replaces all of it for no decoding benefit.
- **`@ifc-lite/create` / `exportToStep` as a replacement for `export-ifc.ts`.**
  Reviter's exporter exists to carry recovery provenance — native vs
  reconstructed vs approximate, category evidence, Revit ids, host relations.
  A generic authoring API would have to be taught all of that. Probe 1 says the
  current exporter is already correct; rewriting it buys nothing.
- **`@ifc-lite/drawing-2d`.** It sections IFC meshes. Reviter's plans are built
  from recovered RVT geometry with Revit-specific stair and datum rules
  (`architectural-plan.ts`). Different input, different rules.
- **`@ifc-lite/clash`, `merge`, `collab`, the server, the CLI.** Federation and
  multi-model workflows are outside what Reviter claims to do.

## Reproducing the probes

Nothing above is checked in. To re-run:

```sh
mkdir ifclite-probe && cd ifclite-probe && npm init -y
npm install @ifc-lite/parser @ifc-lite/geometry @ifc-lite/ids @ifc-lite/bcf
```

then generate the fixture IFC with `makeIfc(fixture())` — the `fixture()` in
`tests/export-ifc.test.ts` — and feed it to `IfcParser.parseColumnar`,
`GeometryProcessor.processAdaptive`, `validateIDS` and `writeBCF` respectively.
Probe 1 and probe 3 are the two worth promoting into `tests/`.
