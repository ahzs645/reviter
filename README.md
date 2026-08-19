# Reviter

Reviter is a local-only Revit inspection and experimental geometry conversion library with a browser studio and a Node extraction command. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file can be opened from the browser file picker and converted in a dedicated Web Worker, or processed directly into an open format from the command line. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

Most of what is known about the format was arrived at by measuring, and that
record — what was probed, what the controls said, what was tried and rejected —
lives in [`docs/`](docs/README.md) rather than here. This file describes what
Reviter does now.

## Extract geometry from an RVT

The converter reads the Revit release from the file's own `BasicFileInfo`
stream, so the direct API and Node command do not require a separate metadata
pass or a hard-coded release:

```sh
npm ci
npm run extract -- model.rvt --out model.glb
```

The output extension selects GLB, OBJ, DXF, SVG, IFC proxy, or JSON audit
output. All formats use the same locally recovered scene as the browser; no
model data is uploaded. Use a paired export to verify a model element by
element when one is available:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc
```

## Development

```bash
npm install
npm run dev
npm test
npm run test:pages
```

`scripts/browser-check.mjs` is the manual end-to-end check that the built bundle really converts a Revit file in a browser tab. It serves `dist-pages` locally, drives Chromium through the same file input a person uses, and reports the rendered conversion summary plus a screenshot. It needs a local Revit file, so it stays out of `npm test`.

```bash
npm run build:pages
node scripts/browser-check.mjs dist-pages /path/to/model.rvt shot.png /path/to/reference.ifc
```

Build it with the default base path for that check; a bundle built for GitHub Pages requests its assets from `/reviter/` and will not boot under the local root server. Passing the matching IFC export also pairs it in the same tab, which is how the [paired regression workflow](docs/unbc-paired-export-harness-2026-07-28.md#paired-regression-workflow) was verified: on 2026-07-28 the 67 MB sample model converted in about 25 seconds and its 80 MB IFC paired to 41,312 typed elements, both without leaving the browser.

The raw SVF extraction remains in ignored `work/` storage. **No reference derivative is bundled any more.** A 25.6 MB GLB of one building used to ship in the repository and be offered to whichever file matched it, which meant every clone carried a derivative of someone's project and every other RVT found the feature permanently disabled. The comparison is worth keeping — a conversion by Revit's own tooling is the best yardstick there is for judging a recovery — so the capability stayed and the asset went: pair your own GLB or glTF from disk, exactly as a paired IFC export is already supplied. It is read in the browser through an object URL and never uploaded, it works for any model, and nothing about a particular building is compiled in. The deployment now ships only the small glTF runtime loader.

### Google Colab build

Run `python3 scripts/prepare_reviter_colab_bundle.py` to snapshot the current tracked and untracked build inputs into `My Drive/Reviter`. The generated `reviter_pages_build_colab.ipynb` follows the same Drive-backed pattern as CBCTer: it mounts Drive, verifies the source and Autodesk-model checksums, extracts the active workspace to `/content`, runs the Pages validation build there, and saves the artifact, summary, and build log under `My Drive/Reviter/reviter-outputs`.

The storage and compute responsibilities are intentionally separate:

1. Google Drive is the persistent handoff. It keeps the source archive, manifest, recovered Autodesk GLB, notebook, logs, summaries, and finished artifacts.
2. A Colab VM is disposable compute. It verifies the archive, extracts it to fast `/content`, installs dependencies, runs type/lint/Pages checks, and creates `dist-pages.tar.gz`.
3. The result is copied back to Drive before the CLI releases the VM. The deployed browser app serves the unpacked artifact; it does not fetch authenticated Drive URLs at runtime.

The installed Colab CLI can run the same pathway without manually executing notebook cells. `--upload` and `--download` are repeatable, `--open` shows the attached runtime in the browser, and `--gpu L4` requests the Pro high-memory L4 pool. CLI-created `empty.ipynb` sessions can appear as **Unknown notebook** in Colab's session dialog; the named CLI session and endpoint are still authoritative.

```bash
colab --auth=oauth2 run \
  --gpu L4 \
  --session reviter-pages-l4 \
  --open \
  --timeout 1800 \
  --upload "$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-build/reviter-source.tar.gz=/content/reviter-source.tar.gz" \
  --upload "$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-build/reviter-source-manifest.json=/content/reviter-source-manifest.json" \
  --download "/content/reviter-output.tar.gz=$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-outputs/reviter-output.tar.gz" \
  scripts/launch_reviter_colab_build.py
```

`scripts/run_reviter_colab_build.py` writes a machine-readable summary containing every step's return code and duration plus the finished artifact's byte count and SHA-256. The CLI attempts requested downloads even when the remote script fails, so partial logs can still be recovered, and it tears down the runtime unless `--keep` was explicitly requested.

## Local utility workspace

The browser studio also includes personal tools that never upload or attach
local identity data to the model export:

- a folder-based `.rfa` library index with embedded previews, PartAtom family
  types and parameters, adjacent `_cat.txt` catalogs, manufacturer/dimension/
  voltage search, and explicit OmniClass-number resolution;
- a shared-parameter manager that detects encodings, validates, merges,
  deduplicates, compares by GUID, reports renames/datatype changes/regrouping,
  and downloads a merged Revit text file;
- the merged 9,543-row vanilla and food-service OmniClass editions as a
  searchable, on-demand classification browser;
- full `BasicFileInfo` worksharing metadata in a local-only inspector, including
  username and saved paths; those sensitive fields are filtered from JSON
  reports;
- embedded PNG and legacy indexed-BMP preview extraction from local DWG files;
  and
- UTF-8, UTF-16LE/BE, Windows-1251, and Windows-1252 text decoding.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- `PartAtom` family metadata, including category, taxonomy, design-file links, family types, and parameter values
- dependency-free parsing and writing of Revit shared-parameter files, family type catalogs, and OmniClass taxonomy files
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 nested duplicated-bounds record detection, with native element IDs, record codes, field counts, and axis-aligned bounds in feet
- native Revit `BuiltInCategory` recovery straight from the partition stream, so walls, doors, curtain panels, mullions, railings, columns, floors, ceilings, stairs, and ramps are named from the RVT itself rather than inferred from a paired IFC
- evidence-backed display classification for walls, doors, panels, frames, columns, railings, slabs/roofs, coverings, windows, stairs, and ramps in the supplied 2027 model
- a standards-aware Revit `Material` schema adapter for reader-supported releases (real-file extraction and element assignment are not wired yet)
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data, with the decoded Revit category carried through the proxy name, description, and audit report
- browser-generated per-element JSON manifests with recovered IDs, categories, type links, parameters, bounds, display state, and geometry provenance

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

### Native category tokens

Element categories are decoded, and they are the first typed BIM data Reviter reads without a paired reference file. Revit writes each element's `BuiltInCategory` into the partition stream as a fixed 18-byte token — the field tag `04 00`, a `u32` discriminator, the negative 64-bit category id, and an `ff ff ff ff` terminator. The token carries no element id, so ownership is resolved after the scan: the owner is the nearest preceding 64-bit value that the same pass proved to be a real native element id. Elements whose own token is not recoverable inherit a category from a record-code consensus, and a consensus is only published once a code cluster clears one of three support/purity floors — 8 elements at 70%, 4 at 85%, or 3 at 100%. Support and purity trade against each other because a single flat floor of 8 was tuned on the clusters that dominate by count and silently excluded the tail: a building holds a dozen ramps and a couple of dozen ceilings, so those clusters could never reach 8 directly resolved members however unanimous they were. Inheritance is not a minor path — in a 2026-07-28 run on the supplied model, **23,462 of the 39,159 categorised elements (60%) were inherited rather than read from their own token**.

Every assignment is reported with its evidence. In that run the consensus was decisive rather than marginal — curtain panels 98.7%, mullions 96.0%, walls 97.6%, doors 92.2% — and the category counts line up with the paired IFC export's product types (Revit mullions against `IfcMember`, curtain panels against `IfcPlate`, railings against `IfcRailing`, floors against `IfcSlab`, ceilings against `IfcCovering`, ramps against `IfcRamp`). Category ids that the paired export does not corroborate keep their numeric label instead of being guessed at from Revit's much larger category enumeration.

A 2027 envelope is not an element's native shape. Reviter therefore records geometry fidelity independently from semantic type. The IFC4 Reference View exporter writes the recovered per-element tessellation when available, uses a bounds solid only as an explicit fallback, maps independently decoded native categories to IFC classes, and attaches `Reviter_Recovery` properties stating whether each body is native, reconstructed, or approximate. Persisted levels, types, material assignments, parameters, identities, and proven door/window host relationships are carried into the IFC when available; missing evidence is left unknown rather than synthesized.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Categories | Materials |
| --- | --- | --- | --- | --- |
| 2023 | fixed `ArcWall` six-coordinate record detected as a bounds hypothesis | production promotion disabled pending paired proof | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2024–2026 | version-specific geometry record not yet proven | diagnostic fallback only | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2027 | supplied-project nested duplicated bounds + native element ID and record classification | filtered, category-styled axis-aligned envelope proxies | native `BuiltInCategory` tokens, IFC-corroborated | category display fallbacks; native assignment pending |
| unknown | no release-specific decoder | diagnostic fallback only | attempted; reports zero when the token is absent | no claim |

The category decoder is not gated on the release, because it is self-validating: a file that carries no category tokens simply reports none, and the previous record-code classification stays in place. Its building-scale rules are verified against the supplied Revit 2027 project, **and against no second building**. The Revitless toolkit contributes one real Revit 2014 `.rfa` fixture, which now verifies legacy release detection, PartAtom metadata, and the component-scale diagnostic path; it does not validate project geometry rules. Every building threshold and classification rule in Reviter is therefore still fitted on one building, and every figure quoted anywhere in this file or in [`docs/`](docs/README.md) is an observation from a dated run on that building rather than a standing fact. [`docs/validating-on-a-second-building.md`](docs/validating-on-a-second-building.md) records what that has cost so far, rule by rule, the harness that now makes the problem testable on any model rather than on this one, and what to look at first on a second file.

Two independent things are gated by release, and it is worth not confusing them. Reviter's **own** decoders are chosen per release by `decoderPlanForVersion`, and the element-bounds, identity, category-ownership, and material decoders that carry the supplied model are 2027-specific. The **optional** standards-aware reader is a separate, vendored Rust/WASM library (`lib/rvt-wasm`, from `rvt-rs`) that declares 2016–2026, and that range is load-bearing rather than stale: on the supplied 2027 file its `quickSummary` succeeds and reports the release and 10,481 schema classes, but `openRvtBytesWithDiagnostics` traps inside the WebAssembly module. The two ranges do not overlap, which is why a message about the optional reader must never be written as a verdict on the file — `reader-support.ts` holds the range once so the four places that used to repeat it cannot drift apart.

### What one building's thresholds actually decide

A threshold fitted to one model is a hypothesis about all models, and the ones here are applied with a bare `continue`. Measured on the supplied project on 2026-07-30:

- **Wrapper detection is category-checked, not record-code-only.** The curtain-wall container fingerprint (`recordCode 30`, field count 8–10) used to run ahead of the decoded category and win. It claimed 1,840 records — every one of which carried a decoded category, so the byte pattern was never breaking a tie, it was overruling evidence. 1,809 are `Walls`, and a curtain wall is a Wall, so the rule was right about the overwhelming majority; the other 31 are 14 Curtain Wall Mullions, 9 Curtain Grids Wall and 8 Curtain Wall Panels — the very children a wrapper exists to reveal. The fingerprint now stands alone only where no category decoded, and those 31 elements are back in the scene.
- **Storeys come from the file, not from a histogram.** `levels` used to be the 8 most populated 0.5 ft elevation buckets, sorted by population, capped at 8 — and the supplied model returned exactly 8, so the cap was binding. Revit persists `Element.m_assocLevelId`, which this model carries 37,503 times, and those relations resolve to 18 level ids of which 12 clear the 20-member floor: −7.2, −3.3, 0, 3.3, 9.8, 14.4, 19.4, 24.3, 30.0, 34.1, 40.0 and 44.0 ft, each with the level's own element id. Each elevation is its members' **median** base height, so one misparsed envelope cannot move a storey. The histogram remains as a fallback for files whose relations do not decode, now uncapped.
- **Limits that bind are reported.** `MAX_TREADS`, `MAX_CURVES_PER_ELEMENT`, `MAX_QUAD_SPAN_FEET`, `MAX_HALF_THICKNESS_FEET` and `MAX_COORDINATE` are ordinary-building envelopes that discard geometry silently, so a monumental stair or a site-scale plane would go missing with the run still reporting success. They are unchanged — re-tuning them without a second building would only move the fitting — but `limit-census.ts` now counts every rejection and `stats.fittedLimitsReached` plus a conversion warning name any limit that bound. The supplied model reaches none of them, which is exactly why they were invisible.

## Element types and names

A Revit element does not carry its family or type name. It carries the element id of a **type element**, and that type element holds the name. Both decoders work off the same record framing — element id at `+0`, a zero word at `+4`, a per-record stamp at `+8`, class discriminators at `+16` and `+22`, and an `ff ff ff ff` null-field marker at `+18`.

In records whose second discriminator is `0x0c93` — walls, curtain walls, and openings — the type id follows the `0x116f` field slot: skip its `[u32 n][n × (u32, u16)]` index list, then take the 64-bit value beginning where the following zero run ends. Jumping to the *end* of the run rather than assuming a fixed pad is what makes this work on curtain walls, which otherwise return the type id shifted by a byte. The type record then stores its name behind the `0x1104` slot as `ff ff ff ff 04 11 [u32 charCount][UTF-16LE]`.

**Verification** against the paired IFC export, whose product names have the form `Family:Type:ElementId`: the type reference is correct for **8,009 of 8,013** predictions — **99.95%** — and following it through to the name reproduces the IFC type string for **5,619 elements with no disagreements**.

Selecting an element in the viewer now shows its type name, its type element id, and its decoded parameters.

Scope: this covers system families, whose type records live in the same partition. Loadable families — mullions, columns, furniture — keep their type names inside family-document blobs elsewhere and are not decoded.

## Element parameters

An element's instance parameters are a flat table of `(BuiltInParameter id, value)` pairs:

```text
[u32 count] [count x ( i64 negative parameter id, f64 value in feet )]
```

The table carries no element id. Ownership comes from the anchor in front of it, where the element restates its own id — `ff ff ff ff 10 03 01 00 00 00 [u64 element id]`. Which anchor is used matters: resolving by "nearest preceding record start" instead lets the type-reference slot inside an element steal ownership, collapsing the assignment and misfiling most wall tables onto ids the IFC export has never heard of.

**Verification.** Over the 6,278 walls that have both a decoded table and an IFC swept-solid depth, the value stored under parameter `-1001101` reproduces that depth to within 1e-6 ft on **6,272 of them — 99.9%**. The next best parameter matches 2.3%. That single check confirms the table framing, the f64-in-feet encoding, and the element join at once.

Parameter names come from the `BuiltInParameter` values published in Autodesk's Revit 2026 API documentation, and are corroborating evidence rather than part of the decode: 125 of the 131 parameter ids found in the supplied project resolve, and the names that land beside the verified height are `WALL_USER_HEIGHT_PARAM` "Unconnected Height", `WALL_BASE_OFFSET` "Base Offset", and `WALL_TOP_OFFSET` "Top Offset" — exactly the company a wall height should keep. Six ids, `-1001101` among them, are absent from the published enum; the whole `-1000000…-1000999` band is empty there while its neighbours are dense, so these are most likely internal parameters Autodesk does not surface. They are reported by number rather than guessed at, and a [second, independently produced table](docs/oda-label-resource-tables.md) of the same enumeration does not carry them either.

That second table also supplies what the published documentation does not: the enumerator for a parameter id, so every decoded parameter now carries `WALL_USER_HEIGHT_PARAM` beside its label and a consumer can join on the identifier that survives a release change or a localised install; and the label Revit itself prints for a category, which is not always the humanised enumerator. `OST_CurtainWallPanels` is "Curtain Panels", `OST_StairsRailing` is "Railings", and `OST_StairsRailingBaluster` — the third largest category in the supplied project at 3,166 elements — is "Balusters". 758 of the 1,075 labelled categories are not the humanised enumerator, and they are now named the way Revit names them everywhere they are shown.

Selecting an element in the viewer now lists its decoded parameters by name.

## Module map

Each stage of the pipeline is its own module, so a decoder change cannot reach into the renderer and an export-format change cannot reach into the parser.

| Module | Responsibility |
| --- | --- |
| `lib/reviter/revit-container.ts` | OLE/CFB stream payloads and the truncated-gzip chunk framing |
| `lib/reviter/elem-table.ts` | `Global/ElemTable` layout detection and the native element-ID index |
| `lib/reviter/bounds-records.ts` | the Revit 2027 duplicated-bounds element record |
| `lib/reviter/native-categories.ts` | `BuiltInCategory` tokens, element ownership, and record-code consensus |
| `lib/reviter/native-decoder.ts` | release gating, the 2023 `ArcWall` hypothesis, and the material schema adapter |
| `lib/reviter/segment-scan.ts` | the diagnostic coordinate scanner and its cleanup passes |
| `lib/reviter/scene.ts` | display selection, category batching, and display materials |
| `lib/reviter/convert.ts` | the pipeline that orchestrates the modules above |
| `lib/reviter/export-*.ts` | one module per output format, re-exported by `exports.ts` |
| `lib/reviter/worker.ts`, `ifc-worker.ts` | the Web Worker entry points |
| `lib/reviter/ifc-reference.ts`, `regression.ts` | paired IFC analysis and the regression gates |
| `lib/reviter/schema.ts` | the embedded `Formats/Latest` serializable-class inventory |
| `lib/reviter/partition-names.ts` | workset / family partition names from `Global/PartitionTable` |
| `lib/reviter/types.ts` | the shared public types |

The interface is split the same way: `app/ReviterStudio.tsx` is the composition
root, with the viewport in `app/studio/ModelCanvas.tsx`, Three.js group assembly
in `three-scene.ts`, the paired reference model in `reference-model.ts` and its
runtime batching in `reference-scene.ts`, and the summary panels in
`panels.tsx`.

## Library surface

```ts
import {
  convertRvtBytes,
  makeDxf,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
} from "./lib/reviter";

const bytes = await file.arrayBuffer();
const result = convertRvtBytes(bytes, file.name, {
  maxSegments: 12_000,
  // Read from BasicFileInfo; release-specific native decoders are disabled if omitted.
  revitVersion: 2027,
});

if (result.ok) {
  const obj = makeObj(result);
  const dxf = makeDxf(result);
  const svg = makePlanSvg(result);
  // Historical API name; duplicated-bounds results export as IFC solid proxies.
  const ifc = makeIfcCenterlines(result);
  const audit = makeReport(result, null);
}
```

For production UI work, use `lib/reviter/worker.ts` as the entry point so large files do not block the main thread.

IFC reference analysis is deliberately isolated in `lib/reviter/ifc-worker.ts`, keeping the 3 MB parser bundle and its WebAssembly binary out of the main interface bundle until an IFC is actually selected.

### The optional Revit 2021 compatibility vocabulary

```ts
import { loadLegacyRevit2021Api } from "./lib/reviter";

const legacy = await loadLegacyRevit2021Api();
legacy.category(-2000011);
// { value: -2000011, names: ["OST_Walls"], label: "Walls" }

legacy.displayUnit("DUT_MILLIMETERS");
// catalog string, symbol, compatible unit types and parameter types
```

The data behind it — 8,075 rows of Revit 2021 enum aliases, category and
parameter-group labels, MEP classifications, shared-data types, display units and
symbols — lives in `lib/reviter/legacy-revit-2021.data.ts`. It is loaded through a
dynamic `import()` so the table stays out of the initial viewer bundle, and it is
never used as evidence by the RVT geometry decoder; it is vocabulary for reading
old files, not a decoder input.

**It is the artifact of record and cannot currently be regenerated.** It was
written once by `scripts/generate-legacy-revit-api.ts` from a Revitless toolkit
checkout's `src/Decompiled` C#, and that tree is not in this repository — so the
generator throws for every reader of it. The script is kept, unrun, as the record
of which declarations were extracted and how; both its header and the data file's
say what input would be needed.

## Family files

`.rfa` and `.rft` files open on the same client-only path, but they carry neither the 2027 duplicated-bounds records nor the project category tokens, so they land on the diagnostic coordinate scanner. That scanner's coordinate window is now chosen from the file kind: a family spans a single component, so a project-scale window both discards its short curves and admits long spurious runs the component cannot physically contain. On the `racbasicsamplefamily` corpus the component-scale window roughly doubles the recovered candidates and keeps the recovered extent inside the component — the 2023 sample previously reported a 128 ft extent for a component under 11 ft across. `ConvertOptions.geometryScale` overrides the choice. The output is still diagnostic: it is labelled as such, and it is not a native Revit element model.

## Where the evidence is

Every building-scale rule in Reviter was fitted on **one model**, and the
measurements that justify each one are observations from dated runs rather than
standing facts — there is no model file in this repository, so nothing recomputes
them. [`docs/README.md`](docs/README.md) indexes all 84 entries. The ones to
start with:

| If you want to know | Read |
| --- | --- |
| how much of the supplied building is recovered, and what the coverage percentages mean | [Coverage measurements](docs/unbc-coverage-measurements-2026-07-30.md) |
| what protects a rule that was fitted on one building | [The paired-export harness](docs/unbc-paired-export-harness-2026-07-28.md) · [Validating on a second building](docs/validating-on-a-second-building.md) |
| how an element's extent, body, or arc is actually read | [Which bounds copy is the element's](docs/unbc-bounds-record-copies-2026-07-28.md) · [Wall bodies](docs/unbc-wall-surfaces-and-solids-2026-07-28.md) · [Element object framing](docs/unbc-element-object-framing-2026-07-28.md) |
| why a class is drawn the way it is | [Stairs and railings](docs/unbc-stair-and-railing-geometry-2026-07-28.md) · [Doors, windows and openings](docs/unbc-door-window-opening-geometry-2026-07-28.md) · [Drawn but not elements](docs/unbc-drawn-but-not-elements-2026-07-28.md) |
| what is still missing and whether it is reachable | [The undrawn census](docs/unbc-undrawn-element-census-2026-07-28.md) |
| how much of the file format is decoded at all | [Stream coverage and the embedded schema](docs/rvt-stream-and-schema-coverage.md) |

The Revit 2027 geometry-replay work — faces, edge loops, analytic surfaces,
tessellation, ownership — is a further forty-nine entries, grouped by area in
the index.

## Third-party components

The implementation uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

Reviter's own decoders are clean-room: they are derived from measurements of
Revit files, not from Autodesk source or runtime assemblies. The one exception is
the optional compatibility vocabulary described above, which is explicitly marked
and isolated from the geometry decoder.

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
