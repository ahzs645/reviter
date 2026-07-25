# Reviter

Reviter is a browser-only Revit inspection and experimental geometry conversion library. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file is opened from the browser file picker, parsed in the tab, and converted in a dedicated Web Worker. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 nested duplicated-bounds record detection, with native element IDs, record codes, field counts, and axis-aligned bounds in feet
- native Revit `BuiltInCategory` recovery straight from the partition stream, so walls, doors, curtain panels, mullions, railings, columns, floors, ceilings, stairs, and ramps are named from the RVT itself rather than inferred from a paired IFC
- evidence-backed display classification for walls, doors, panels, frames, columns, railings, slabs/roofs, coverings, windows, stairs, and ramps in the supplied 2027 model
- a standards-aware Revit `Material` schema adapter for reader-supported releases (real-file extraction and element assignment are not wired yet)
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data, with the decoded Revit category carried through the proxy name, description, and audit report

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

### Native category tokens

Element categories are decoded, and they are the first typed BIM data Reviter reads without a paired reference file. Revit writes each element's `BuiltInCategory` into the partition stream as a fixed 18-byte token — the field tag `04 00`, a `u32` discriminator, the negative 64-bit category id, and an `ff ff ff ff` terminator. The token carries no element id, so ownership is resolved after the scan: the owner is the nearest preceding 64-bit value that the same pass proved to be a real native element id. Elements whose own token is not recoverable inherit a category from a record-code consensus, and a consensus is only published once a code cluster clears both a support floor (8 elements) and a purity floor (70%).

Every assignment is reported with its evidence. In the supplied model the consensus is decisive rather than marginal — curtain panels 98.7%, mullions 96.0%, walls 97.6%, doors 92.2% — and the category counts line up with the paired IFC export's product types (Revit mullions against `IfcMember`, curtain panels against `IfcPlate`, railings against `IfcRailing`, floors against `IfcSlab`, ceilings against `IfcCovering`, ramps against `IfcRamp`). Category ids that the paired export does not corroborate keep their numeric label instead of being guessed at from Revit's much larger category enumeration.

A 2027 envelope is not an element's native shape. Native family meshes, curved faces, openings, compound-layer assignments, element-material references, parameters, constraints, and general typed BIM semantics beyond the category remain undecoded. Appearance/material strings, colors, and embedded previews exist in the partition corpus, but production extraction and assignment are not implemented. The IFC exporter therefore writes clearly described `IfcBuildingElementProxy` geometry; it does not mislabel proxies as native `IfcWall`, `IfcSlab`, or family geometry.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Categories | Materials |
| --- | --- | --- | --- | --- |
| 2023 | fixed `ArcWall` six-coordinate record detected as a bounds hypothesis | production promotion disabled pending paired proof | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2024–2026 | version-specific geometry record not yet proven | diagnostic fallback only | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2027 | supplied-project nested duplicated bounds + native element ID and record classification | filtered, category-styled axis-aligned envelope proxies | native `BuiltInCategory` tokens, IFC-corroborated | category display fallbacks; native assignment pending |
| unknown | no release-specific decoder | diagnostic fallback only | attempted; reports zero when the token is absent | no claim |

The category decoder is not gated on the release, because it is self-validating: a file that carries no category tokens simply reports none, and the previous record-code classification stays in place. It is verified against the supplied Revit 2027 project. The only other real Revit files in the corpus are the `.rfa` family files from the `@phi-ag/rvt` examples (2016–2026); families carry no project category tokens, so they neither confirm nor refute cross-release behaviour.

## Embedded schema

`Formats/Latest` is Autodesk's own dictionary for the on-disk object graph — roughly half a megabyte of class names, inheritance, and field declarations shipped inside every Revit file. A class that is serializable at the top level is written as:

```text
[u16 nameLen] [name] [u16 tag | 0x8000] [u16 pad]
[u16 parentLen] [parent name]
[u16 flag] [u32 version] [u32 declared field count]
```

The tag is what identifies the class in `Partitions/NN` records, and it drifts between releases as Autodesk inserts classes into the ordering — in the local corpus `ArcWall` moves `0x14f` → `0x1b8` → `0x1c3` across 2020, 2026, and 2027 while its parent stays `VWall`.

**The parent name is what makes the record trustworthy.** A name-and-tag pattern alone also matches compressed noise: scanning for it loosely over the supplied 2027 project yields 232 candidates, of which 48 are mangled strings such as `Cuuuuuuuaaaas` and `HostTrfCreatDr`, including one name carrying four different tags. Requiring a well-formed parent-class name to begin exactly four bytes after the class name removes every one of those and leaves 184 classes, each with its base class — `ArcWall` → `VWall`, `HostObjAttr` → `Symbol`, `Cell` → `CellInterface`, `GeomStep` → `GeomGenerator`.

The inventory is corroborated against an independent source: across the Revit 2020, 2023, and 2026 family files it reproduces all 218 checkable class-to-tag pairs in the tag-drift dataset published by `rvt-rs`, with no disagreements — before and after the parent-name filter, so the filter costs no true positives.

The field *list* is deliberately not walked. The declared count and schema version are read because they sit at a fixed offset after the parent name, but the field records that follow contain inline class definitions whose layout does not close across the corpus. Several framings fit the observed bytes and each leaves a variable unexplained remainder — measured over the 2026 family file, the bytes following a zero-field class run 18, 33, 34, 40, 42, 54, 55, 82, and longer. `rvt-rs` reports the same gap as field-count mismatches. A field graph that is probably wrong would be worse than none, so the parser stops at what the bytes prove.

`Global/PartitionTable` is also read, for its UTF-16 partition names. In a project these are worksets; in a family the stream carries the family partition path instead, so the decoder reports the names without asserting which kind they are.

## Supplied-project synthesis

| Supplied project | What Reviter uses |
| --- | --- |
| `rvt-app-main` | The MIT-licensed [`@phi-ag/rvt`](https://github.com/phi-ag/rvt) streaming metadata and thumbnail reader |
| `rvt-ts-viewer` | The partition-coordinate recovery approach, reworked into the reusable `lib/reviter` core and a transferable Web Worker pipeline |
| `rvt-rs-main` | The clean-room format status, support boundary, diagnostic model, and optional WebAssembly reader integration |
| `rvt2ifc-fe-master` | The openBIM viewer/export direction; current Reviter exports can be handed to IFC viewers |
| `rvt-convert-main` | Export-format and configuration ideas only; its Autodesk/Azure upload flow is intentionally excluded because it conflicts with client-only processing |

A second review of the supplied projects found little left to bring over from the browser ones: `rvt-app-main`'s Revit handling is a thin wrapper over `@phi-ag/rvt` that Reviter already calls directly, `rvt-ts-viewer`'s recovery is a subset of `lib/reviter/segment-scan.ts`, and `rvt2ifc-fe-master`'s IFC type-code table is redundant now that `web-ifc` reports type names directly. The remaining value was in `rvt-rs`: its `Formats/Latest` work is the basis for the schema inventory above, and its published tag-drift dataset is what that inventory is checked against.

The implementation also uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

The captured Autodesk Viewer assets were inspected with the supplied `jsmap` workflow. For the exact supplied sample, Reviter now bundles a locally converted, quantized GLB of Autodesk's server-generated derivative and uses it as the high-fidelity reference view. It contains the source mesh hierarchy and materials but does not turn Autodesk Viewer into an RVT decoder: other RVT files still use Reviter's local recovery or a paired IFC reference.

## Paired regression workflow

After opening an RVT, choose its matching IFC export in the **Regression fixture** panel. Both files remain local. Reviter then:

1. parses native IDs from `Global/ElemTable`;
2. detects every strict nested duplicated-bounds record in each decompressible `Partitions/*` page and inventories leading-u32 evidence;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join remains diagnostic evidence. A duplicated-bounds record is stronger. Correlation against the supplied IFC joins 25,180 unique recovered IDs to known IFC products/types and yields strong record-code clusters for walls, doors, panels, members, columns, railings, slabs, roofs, coverings, and windows. This validates the record as an element envelope and supports the supplied-model display classification, but it still does not prove a native shape or a universal Revit object class mapping.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- nested duplicated-bounds recovery: 35,677 record occurrences, 35,633 unique native IDs, and 33,985 non-zero 3D envelopes
- RVT-only default scene: 28,225 category-classified element proxies; 1,569 curtain-wall/opening wrapper envelopes and 4,191 unclassified envelopes remain auditable/exportable but are hidden from the default view
- generated scene: 225,800 vertices, 338,700 triangles, and 21 category batches
- paired index evidence: 8,902 `ElemTable` IDs plus 37,324 partition-record IDs
- Autodesk derivative cross-check: 59,582 stable Revit IDs and 51,420 fragments in the signed-in reference capture
- Autodesk derivative presentation evidence: 22 materials and no bitmap textures; its screenshot look comes primarily from detailed meshes, technical shading, feature edges, and shadows
- strongest supplied-pair clusters include 1,044 standard walls, 1,294 doors, 15,654 members, 4,972 plates, 95 columns, 136 railings, and 53 slabs
- native category recovery: 22,353 category tokens, 11,926 elements resolved directly from their own token, 21,997 more inherited from a record-code consensus, for 33,923 categorised elements — 18,352 curtain wall mullions, 6,878 curtain panels, 2,818 walls, 1,288 doors, 146 railings, 82 columns, 49 floors, 27 stairs, 24 ceilings, 5 windows, 5 ramps, and 4,247 stair/railing components
- local RVT-only conversion of the 67 MB model completes in about 17 seconds in Node and 25 seconds in a Chromium tab, including native category recovery
- the conversion previously spent roughly 90% of its time decompressing garbage: four byte sequences inside the DEFLATE payload happen to match the gzip signature, and each one was handed the remaining 69 MB of the stream as input. `fflate` sizes its output buffer from the input length, so those four false chunks allocated and decoded hundreds of megabytes each. Validating the gzip flag byte and bounding every chunk by the next valid signature cut the same workload from 134 seconds to 17 with byte-identical record output (35,633 bounds records, 33,985 solid envelopes)

The bounds signature is currently confirmed for this supplied Revit 2027 file. It must be regression-tested on more RVT versions before being treated as a general Revit decoder.

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

The interface is split the same way: `app/ReviterStudio.tsx` is the composition root, with the viewport in `app/studio/ModelCanvas.tsx`, Three.js group assembly in `three-scene.ts`, the Autodesk reference in `autodesk-reference.ts`, and the summary panels in `panels.tsx`.

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

## Family files

`.rfa` and `.rft` files open on the same client-only path, but they carry neither the 2027 duplicated-bounds records nor the project category tokens, so they land on the diagnostic coordinate scanner. That scanner's coordinate window is now chosen from the file kind: a family spans a single component, so a project-scale window both discards its short curves and admits long spurious runs the component cannot physically contain. On the `racbasicsamplefamily` corpus the component-scale window roughly doubles the recovered candidates and keeps the recovered extent inside the component — the 2023 sample previously reported a 128 ft extent for a component under 11 ft across. `ConvertOptions.geometryScale` overrides the choice. The output is still diagnostic: it is labelled as such, and it is not a native Revit element model.

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

Build it with the default base path for that check; a bundle built for GitHub Pages requests its assets from `/reviter/` and will not boot under the local root server. Passing the matching IFC export also pairs it in the same tab, which is how the paired workflow below was verified: the 67 MB model converts in about 25 seconds and the 80 MB IFC pairs to 41,312 typed elements, both without leaving the browser.

The raw SVF extraction remains in ignored `work/` storage. The deployment includes only the optimized `public/autodesk-reference.glb` reference derivative and its small runtime loader; that reference activates only for the matching supplied-project filename.

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

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
