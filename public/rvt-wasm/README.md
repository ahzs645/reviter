# rvt-rs

**Apache-2.0 clean-room Rust/Python toolkit for inspecting Autodesk Revit files (`.rvt`, `.rfa`, `.rte`, `.rft`) without a Revit installation.** Opens the OLE/CFB container, decodes Revit's truncated-gzip streams, extracts metadata and previews, parses the embedded `Formats/Latest` schema, and classifies all observed schema field encodings across an 11-release 2016–2026 reference corpus.

**This is not yet a full Revit model reader.** Schema-directed instance walking has a verified `ADocument` beachhead on Revit 2024–2026 (document-level metadata only — not per-element), and `Formats/Latest` schema classification covers 100% of observed field encodings. IFC4 STEP emission produces a valid spatial tree with typed elements **when fed synthesized `DecodedElement` inputs from the test fixtures** — see `tests/fixtures/synthetic-project.ifc`.

**On real `.rvt` project files the element extraction pipeline does not currently produce typed elements** — the schema-directed scanner hits 1 of 405 classes (`HostObjAttr`, a permissive parent class) on `Revit_IFC5_Einhoven.rvt` and 0 classes on `2024_Core_Interior.rvt`. 80 per-class decoders ship (`elements::all_decoders()` — Wall, Floor, Door, Window, Column, Beam, Stair, Railing, Rebar, Room/Area/Space, Furniture, DesignOption, Phase, Workset, Electrical/Mechanical/Plumbing FamilyInstance subtypes) but are exercised only against synthesized test inputs — they're not wired into the `iter_elements` dispatch path. Root-cause investigation (`reports/element-framing/RE-01-synthesis.md`) found that element instance data lives in `Partitions/*` streams with a wire envelope that has not been reverse-engineered yet; the current walker scans `Global/Latest` which holds only document-level metadata. Q-01 corpus validation is licensed and scripted (`tools/fetch-corpus.sh`) but not yet executed against `project_corpus_smoke`. See [What does not work yet](#what-does-not-work-yet) below.

**A zero-upload, client-side browser viewer ships alongside the library**, live at <https://drunkonjava.github.io/rvt-rs/>. Drop a `.rvt` / `.rfa` file onto the page — the WebAssembly build parses it in-tab, renders 3D via Three.js with orbit controls + element picking + scene tree, and offers one-click **Export glTF** / **Export IFC** / **Export plan SVG**. No upload, no account, no telemetry. CI asserts the compiled `.wasm` has zero `fetch` / `XMLHttpRequest` / `WebSocket` imports.

For the non-technical workflow, start with the [`docs/user-guide.md`](docs/user-guide.md). Installation paths live in [`docs/install.md`](docs/install.md). For the short support boundary, read [`docs/status.md`](docs/status.md) and the supported MVP input profile in [`docs/supported-profile.md`](docs/supported-profile.md). The detailed roadmap tasks live in [`TODO.md`](TODO.md) and the matching GitHub milestones/issues.

Rust 2024 edition (MSRV 1.85). **Fifteen CLIs ship** (`rvt-analyze`, `rvt-info`, `rvt-inspect`, `rvt-schema`, `rvt-history`, `rvt-diff`, `rvt-corpus`, `rvt-dump`, `rvt-doc`, `rvt-ifc`, `rvt-write`, `rvt-gltf`, `rvt-sheet`, `rvt-elem-table`, `gen-fixture`) plus 36 reproducible probes under `examples/`. Python bindings via pyo3+maturin in the `rvt-py` workspace member (SEC-12/13 — the core `rvt` crate is unconditionally `#![forbid(unsafe_code)]`) — `pip install rvt`.

## What works today

| Layer | Status | Notes |
|---|---|---|
| OLE/CFB container open | ✓ | No Revit required |
| Truncated-gzip stream decode | ✓ | |
| `BasicFileInfo` metadata | ✓ | Version, build, GUID, original path |
| `PartAtom` XML | ✓ | Title, OmniClass code, taxonomies |
| Stream preview extraction | ✓ | Clean PNG, wrapper stripped |
| `Formats/Latest` schema parse | ✓ | 395 classes, 13,570 fields |
| Field-type classification | ✓ | **100% over `rac_basic_sample_family` 11-release corpus** — CI regression gate |
| Cross-release tag-drift table | ✓ | First public 122×11 dataset |
| Layer 5a ADocument walker | partial | Reliable on Revit 2024–2026; 2016–2023 entry-point detection pending |
| Stream-level modifying writer | ✓ | 13/13 streams byte-preserving; `rvt-write` CLI + JSON patch manifests |
| Field-level semantic writer | pending | Gated by [ADR-002](docs/decisions/ADR-002-semantic-write-api-gate.md); no stable API until decoder/validation evidence is strong enough |
| Layer 5b per-class decoders | partial | **80 decoder structs exist in `elements::all_decoders()`** (Level/Wall/Floor/Roof/Ceiling/Door/Window/Column/Beam/Stair/Railing/Room/Furniture/Rebar/DesignOption/Phase/Workset/FamilyInstance subtypes/etc.) and pass unit tests against synthesized `InstanceField` inputs. **They are not reached by `walker::iter_elements` on real `.rvt` files** — the scanner doesn't find their class tags in the streams it scans (RE-01 synthesis). Exercised end-to-end only through committed test fixtures. Wiring into `iter_elements` tracked as DEC-01..05. |
| IFC4 STEP export — spatial tree | ✓ | `IfcProject` + `IfcSite` + `IfcBuilding` + `IfcBuildingStorey` + OmniClass classifications |
| IFC4 STEP export — elements | partial | `IfcWall`/`IfcSlab`/`IfcRoof`/`IfcCovering`/`IfcDoor`/`IfcWindow`/`IfcColumn`/`IfcBeam`/`IfcStair`/`IfcRailing`/`IfcFurniture`/`IfcFooting`/`IfcReinforcingBar`/`IfcSpace`/`IfcBuildingElementProxy` constructors all emit correctly **from synthesized `DecodedElement` inputs** (`tests/fixtures/synthetic-project.ifc` is one such output, 10 typed elements, BlenderBIM verified). On real project files the walker currently only recovers `HostObjAttr` (a parent class) so the exporter emits `IFCBUILDINGELEMENTPROXY` proxies rather than typed walls/doors. Getting typed elements out of real files requires the wire-format breakthrough described in RE-01 synthesis. |
| IFC4 STEP export — geometry | ✓ (rectangular) | `IfcExtrudedAreaSolid` + `IfcRectangleProfileDef` chain wired to the element's Representation slot. Rectangular profiles only (curved doors, non-orthogonal walls still pending — IFC-17/24). |
| IFC4 STEP export — materials | ✓ | Single-material via `IfcMaterial` + `IfcRelAssociatesMaterial`; compound assemblies via `IfcMaterialLayerSet` + `IfcMaterialLayerSetUsage` (IFC-28/29). Walls / floors / roofs with layered composition emit correctly. |
| IFC4 STEP export — properties | ✓ | `IfcPropertySet` + `IfcPropertySingleValue` with typed values (`IfcText`, `IfcInteger`, `IfcReal`, `IfcBoolean`, `IfcLengthMeasure`, `IfcPlaneAngleMeasure`, `IfcAreaMeasure`, `IfcVolumeMeasure`, `IfcCountMeasure`, `IfcTimeMeasure`, `IfcMassMeasure`) wired via `IfcRelDefinesByProperties`. |
| IFC4 STEP export — openings | ✓ | `IfcOpeningElement` + `IfcRelVoidsElement` + `IfcRelFillsElement` — doors and windows cut actual holes in their host walls (BlenderBIM verified). |
| Geometry extraction | partial | Extrusion helpers ship for walls/slabs/roofs/ceilings/columns/beams/stairs/doors/windows (GEO-27..35, IFC-16..26). Swept / revolved / BRep variants exist (IFC-17/18/19/20) but with `rvt` feature-flagged rectangular fallbacks in the default emission path. |
| glTF 2.0 binary export | ✓ | `model_to_glb()` produces a valid `.glb` file that loads in Three.js's `GLTFLoader` (VW1-04). `rvt-gltf` CLI. |
| 2D plan-view SVG export | ✓ | `render_plan_svg()` produces per-category-coloured SVG (walls black, doors blue, columns red, …) (VW1-11). `rvt-sheet` CLI. |
| Browser viewer | ✓ | Live at <https://drunkonjava.github.io/rvt-rs/>. WebAssembly build of the core library + Three.js + Vite. Zero-upload, in-tab parse, Export glTF/IFC/SVG buttons, URL-based share via `share::ViewerState`. (VW1-01 through VW1-24 shipped.) |
| Fuzz-regression harness | ✓ | 9 libFuzzer targets + 38 synthetic adversarial regression cases under `tests/fuzz_regressions.rs`. Caught a real `gzip_header_len` bounds bug on 9-byte truncated headers (Q-04). |

## What does not work yet

| Gap | Status | Evidence |
|---|---|---|
| Element extraction from real `.rvt` project files | not functional | Production `iter_elements` is conservative and does not return low-confidence parent-class candidates. Diagnostic scans still find only `HostObjAttr`-style candidates on `Global/Latest`; real Walls/Floors/Doors require partition-stream decoders. See `reports/element-framing/RE-01-synthesis.md`. |
| 80 per-class decoders wired into walker | not wired | `elements::all_decoders()` is a struct registry; `iter_elements` calls the generic `decode_instance` instead. Even if the scanner found a Wall, it would not use `WallDecoder`. Tracked as DEC-01..05. |
| IFC4 typed elements from real `.rvt` | experimental | `RvtDocExporter::export` emits framework entities and version-gated 2023 ArcWall `IFCWALL` records when evidence is strong enough. Generic `HostObjAttr` proxy emission is suppressed by default; diagnostic export can include those candidates with provenance. Doors/floors/windows and geometry remain unproven on real project files. |
| Community corpus parse verification | not executed | `tools/fetch-corpus.sh` is committed but never run. The 41 candidate files across 7 MIT/Apache repos have not been checked against `project_corpus_smoke`. License verification is solid; parse compatibility is unknown. Tracked as Q01-01..04. |
| Partition-stream wire format | not reverse-engineered | 12 RE probes in `examples/probe_*` tested five hypotheses; all refuted. `Global/ContentDocuments` identified as a structured index but its id space does not match `ElemTable`'s (6/30705 overlap). Blocker on element extraction. |
| Scalar-Container wire format on real bytes | assumption only | L5B-09 fix assumes Vector-equivalent layout for kinds 0x01/0x02/0x04/0x05/0x07/0x0b/0x0d. Round-trip tests use synthesized bytes; no real-.rvt round-trip has been exercised. Tracked as WF-01..03. |
| Patched CFB roundtrip for grow/shrink cases | covered | Family corpus tests cover identity, grow, shrink, multi-stream, and missing-stream patches; project-corpus tests cover identity/grow/shrink/multi while preserving unpatched streams plus GUID/history. |

## Why the schema matters

The openBIM community — anchored by [buildingSMART International](https://www.buildingsmart.org/) and the IFC standard — has spent years working on Revit interoperability. Autodesk's own [revit-ifc](https://github.com/Autodesk/revit-ifc) exporter runs **inside** Revit using the Revit API, so it can only emit what the API surfaces. Real-world IFC exports from Revit are described, routinely and publicly, as *"very limited"* (thinkmoult.com), *"data loss"* (Reddit r/bim), and *"out of the box, just crap"* (the [OSArch Wiki's guide to Revit for openBIM](https://wiki.osarch.org/index.php?title=Revit_setup_for_OpenBIM)).

The schema work here — decoding `Formats/Latest` and classifying 100% of field encodings across 11 Revit releases — is the dictionary a byte-level reader needs. Once the partition-stream decoder work in [`TODO.md`](TODO.md) lands, the resulting IFC export can carry more than what the Revit API chooses to expose. That is the thesis. It is not yet the delivered product.

If you're building BIM/AEC tooling and want an Apache-2 Revit reader to compose into your stack, the current release covers:

- **Reliably** — metadata extraction, schema introspection (100% field-type classification across the 11-release family corpus), OLE/CFB open, truncated-gzip decode, IFC4 STEP emission from synthesized inputs, glTF 2.0 binary, 2D plan-view SVG, 80 per-class decoder structs that pass unit tests against synthesized fixtures.

- **As scaffolding, not functional on real project files yet** — broad diagnostic element scans and walker→IFC integration. Production export now suppresses low-confidence `HostObjAttr` proxies and only emits the narrow, version-gated 2023 ArcWall path when it is supported by corpus evidence (see "What does not work yet" above).

See [`tests/fixtures/synthetic-project.ifc`](tests/fixtures/synthetic-project.ifc) for a committed sample IFC output — `IfcProject` + `IfcSite` + `IfcBuilding` + three `IfcBuildingStorey`s + ten typed `IfcWall`/`IfcSlab`/`IfcDoor`/`IfcWindow`/`IfcStair`/`IfcBuildingElementProxy` entities, all wired to the storey via `IfcRelContainedInSpatialStructure`, BlenderBIM- and IfcOpenShell-verified. The browser viewer at <https://drunkonjava.github.io/rvt-rs/> runs the same IFC emission pipeline — so drag-and-drop a .rvt and the resulting Export IFC produces the metadata/spatial scaffold (not typed elements) end-to-end in the tab.

## Quick demo

One command produces the full forensic picture — identity, upgrade history, format anchors, schema table, Phase D link histogram, content metadata, and a disclosure scan:

```bash
cargo build --release
./target/release/rvt-analyze --redact path/to/your.rfa
```

### From Python

```python
import rvt

f = rvt.RevitFile("my-project.rfa")
print(f.version, f.part_atom_title)      # 2024 "0610 x 0915mm"
print(f.read_adocument()["fields"][-1])  # {name: m_devBranchInfo, kind: element_id, tag: 0, id: 35}
open("out.ifc", "w").write(f.write_ifc())
```

Install: `pip install rvt` — or build from source with [`maturin build --release --manifest-path rvt-py/Cargo.toml`](docs/python.md#from-source). Full API + Jupyter notebook walkthrough: [`docs/python.md`](docs/python.md) and [`docs/rvt-python-quickstart.ipynb`](docs/rvt-python-quickstart.ipynb).
See [`docs/install.md`](docs/install.md) for cargo, PyPI, source, and viewer
install/smoke-test paths.

### In the browser

Drop a `.rvt` / `.rfa` / `.rte` / `.rft` at <https://drunkonjava.github.io/rvt-rs/> — nothing leaves the tab. The viewer compiles the core library to WebAssembly (`wasm-pack build --target web --features wasm`), runs the parse in a dedicated worker, and renders 3D via Three.js. One-click buttons export the model as **glTF 2.0 binary**, **IFC4 STEP**, or **plan-view SVG**. URL state (camera pose + category filters) is shareable via the hash fragment.

Privacy posture is CI-enforced: the deploy workflow (`.github/workflows/deploy-viewer.yml`) runs `wasm-objdump -j Import` on every build and fails if the compiled `.wasm` imports `fetch`, `XMLHttpRequest`, or `WebSocket`. See [`docs/viewer-privacy-posture.md`](docs/viewer-privacy-posture.md).

**Sample output** (all pre-scrubbed with `--redact`, committed for review):

- **One-screen teaser**: [`docs/demo/rvt-analyze-2024-teaser.txt`](docs/demo/rvt-analyze-2024-teaser.txt) — the four highlight sections fit in one terminal screen (identity, format anchors, Phase D linkage, disclosure scan)
- **Full terminal report**: [`docs/demo/rvt-analyze-2024-redacted.txt`](docs/demo/rvt-analyze-2024-redacted.txt) — 130 lines of structured output
- **JSON report**:    [`docs/demo/rvt-analyze-2024-redacted.json`](docs/demo/rvt-analyze-2024-redacted.json) — machine-readable version
- **Tag-drift heatmap**: [`docs/data/tag-drift-heatmap.svg`](docs/data/tag-drift-heatmap.svg) — visual proof of class-ID drift across 11 Revit releases

The `--redact` flag (on by default in every committed artifact) scrubs Windows usernames, Autodesk-internal paths, and project-ID folder names to `<redacted>` markers while preserving path shape so claims remain verifiable. Omit the flag when running privately against your own files.

## Results at a glance

Running the shipped CLIs against one 400 KB RFA fixture:

- **Metadata**: version, build tag, creator path, file GUID, locale (`rvt-info`)
- **Atom XML**: title, OmniClass code, taxonomies (`rvt-info` parses `PartAtom`)
- **Preview**: clean PNG thumbnail, 300-byte Revit wrapper stripped (`rvt-info --extract-preview`)
- **Schema**: 395 classes + 1,114 fields + per-field typed encoding (`rvt-schema`)
- **History**: every Revit release that ever saved this file (`rvt-history`)
- **Bulk strings**: 3,746 length-prefixed UTF-16LE records from Partitions/NN — Autodesk unit/spec/parameter-group identifiers, OmniClass + Uniformat codes, Revit category labels, localized format strings (`rvt-history --partitions`)

Every class and field name that `rvt-schema` extracts was cross-checked against the public `RevitAPI.dll` NuGet package's exported C++ symbol list. All top-level tagged class names we've inspected (ADocument, DBView, HostObj, LoadBCBase, Symbol, APIAppInfo, APropertyDouble3, ElementId, and the rest) appear in that export with their decorated signatures (e.g. `__cdecl NotNull<class ADocument *,void>::NotNull(class ADocument *)`), confirming the on-disk schema names match the compiled symbols one-to-one.

A build-server path also appears in C++ assertion strings inside the same DLL; it is mentioned in the recon report for completeness and does not represent anything the reader extracts from .rvt / .rfa files.

## Phase D findings (what makes this project different)

Six reproducible discoveries, all documented in [`docs/rvt-moat-break-reconnaissance.md`](docs/rvt-moat-break-reconnaissance.md) and reproducible from `examples/`:

1. **The schema indexes the data.** Class names do not appear as ASCII in `Global/Latest`; class tags from `Formats/Latest` (u16 after class name, with 0x8000 flag set) occur ~340× the uniform-random rate. The top tag, `AbsCurveGStep`, appears 19,415 times in 938 KB of decompressed Global/Latest. [`examples/link_schema.rs`]

2. **Tags drift across releases** but are stable-sort-assigned. `ADocWarnings` = 0x001b 2016→2026 because no class sorted alphabetically before it has ever been added. `AbsCurveGStep` shifted 0x0053 → 0x0066 across the decade as 19 new A-class entries were inserted. Full 122-class × 11-release drift table: [`docs/data/tag-drift-2016-2026.csv`](docs/data/tag-drift-2016-2026.csv), visualised in [`docs/data/tag-drift-heatmap.svg`](docs/data/tag-drift-heatmap.svg). First publicly-available version of this data. [`examples/tag_drift.rs`]

3. **Revit 2021 was a major undocumented format transition.** Global/Latest grew 27× (~26 KB → ~715 KB) while simultaneously the Forge Design Data Schema namespaces (`autodesk.unit.*`, `autodesk.spec.*`) debuted in Partitions/NN. Two symptoms, one event. Any reader built for 2016-2020 silently drops 30× more data when pointed at 2021+.

4. **Parameter-group namespace shipped separately in Revit 2024.** `autodesk.parameter.group.*` identifiers appear in 2024+ only — three releases after units/specs. Dating the Forge schema rollout from on-disk bytes: [`examples/tag_drift.rs`](examples/tag_drift.rs), [`src/object_graph.rs`](src/object_graph.rs).

5. **A stable Revit format-identifier GUID in family files.** `Global/PartitionTable` is 167 bytes decompressed in `.rfa` family files, and **165 of those bytes are byte-for-byte identical across every Revit release 2016-2026** (98.8% invariant). The invariant region contains a never-before-published UUIDv1: `3529342d-e51e-11d4-92d8-0000863f27ad`. The MAC suffix `0000863f27ad` matches a known Autodesk-dev-workstation signature from circa 2000. Useful for family-file detection. **Scope correction (2026-04-21):** this invariant is a *family-file* anchor, not a universal Revit-file anchor. Three real `.rvt` project files we probed carry three different GUIDs (`6a6261fd-...` on Revit 2023, `552368c6-...` on 2024, all-zero on 2025) in a shorter 87-byte `PartitionTable`. File-type sniffers using the family GUID will correctly reject non-family files but can't identify them. See [`docs/project-file-corpus-probe-2026-04-21.md`](docs/project-file-corpus-probe-2026-04-21.md). [`examples/partition_full.rs`]

6. **Tagged class record structure decoded.** Every class declaration in `Formats/Latest` carries an explicit tag (u16 with 0x8000 flag), optional parent class, and declared field count, followed by N field records each with name + C++ type encoding. `HostObjAttr` now resolves to `{tag=107, parent=Symbol, declared_field_count=3}` with all three field names (`m_symbolInfo`, `m_renderStyleId`, `m_previewElemId`) extracted byte-for-byte. [`examples/record_framing.rs`, `src/formats.rs`]

Three unintended disclosure patterns also surfaced in Autodesk's shipped reference content — the specific values are withheld from this README to avoid re-broadcasting them; they are documented in [`docs/rvt-moat-break-reconnaissance.md`](docs/rvt-moat-break-reconnaissance.md) for security-research reproducibility:

- A customer-facing OneDrive path that leaks the directory structure of an Autodesk employee's personal sample-authoring workflow.
- A build-server path baked into C++ assertion strings inside the public `RevitAPI.dll`.
- A creator-name field inside the `Contents` stream that travels with every copy of the sample family, preserving the name of one of Revit's original 1997 developers.

**Downstream safety:** the `rvt-analyze` CLI ships with a `--redact` flag (on by default for any of the committed demo output in this repo) that rewrites creator paths, Autodesk-internal paths, and build-server paths to `<redacted>` markers while preserving the surrounding structure. Any tool consuming rvt-rs output and displaying it publicly should do the same.

---

## Library surface

All modules compile under both the default build and the `wasm` feature flag. See `src/` for type docs:

| Module | What it does |
|---|---|
| `reader` | Open any Revit file with `OpenLimits`, enumerate every OLE stream, fetch raw stream bytes, bounded reads |
| `compression` | Truncated-gzip decode (`inflate_at`, `inflate_at_auto`, `inflate_at_with_limits`) + multi-chunk (`inflate_all_chunks_with_limits`) + truncated-gzip encoder for write-back (`truncated_gzip_encode`) |
| `basic_file_info` | Version, build tag, GUID, creator path, locale — read path + byte-back encoder (`BasicFileInfo::encode`) |
| `part_atom` | Atom XML with Autodesk `partatom` namespace — title, OmniClass, taxonomies — read + encode |
| `formats` | Parse + encode `Formats/Latest` with `FieldType` classification (100 % over the 11-release corpus) |
| `walker` | Schema-directed instance walker + 80-decoder dispatch + `detect_adocument_start` entry-point finder |
| `elements` | 80 `ElementDecoder` implementations (Wall, Floor, Door, Window, Column, Beam, Stair, Railing, Rebar, Room, Furniture, …) |
| `geometry` | Curve / Face / Solid variants (Line, Arc, Ellipse, NURBS, Hermite, Ruled, Revolved, Extrusion, Sweep, Blend, SweptBlend, Boolean, Mesh, PointCloud) |
| `object_graph` | `DocumentHistory`, string-record extractor for Global/Latest + Partitions/NN |
| `class_index` | Quick class-name inventory (BTreeSet) |
| `corpus` | Cross-version byte-delta classifier |
| `elem_table` | `Global/ElemTable` header parser + rough record enumeration |
| `partitions` | Partitions/NN 44-byte header decoder + gzip-chunk splitter |
| `writer` | Byte-preserving round-trip `copy_file` + `write_with_patches` (atomic temp-file rename, stream-hash verification) + GUID + history preservation |
| `round_trip` | Per-class encoder round-trip verification (`verify_instance_round_trip`) |
| `ifc` | Full IFC4 spatial tree + elements + materials + properties + openings + extrusion geometry + glTF 2.0 binary (`gltf::model_to_glb`) + plan-view SVG (`sheet::render_plan_svg`) + viewer data model (`scene_graph`, `camera`, `clipping`, `sheet`, `share`, `measure`, `annotation`, `pbr`) |
| `streams` | Named constants for every invariant OLE stream in a Revit file |
| `redact` | Shared PII scrubbers for all CLIs (`--redact` flag) |
| `wasm` | `#[cfg(feature = "wasm")]` — 14 JS-callable wasm-bindgen bindings powering the browser viewer |
| `error` | Structured error type (`Error` / `Result`) |

Runtime capabilities:

- Open any Revit file from disk (magic `D0 CF 11 E0 A1 B1 1A E1`)
- Enumerate every OLE stream; find the version-specific `Partitions/NN`
- Decompress any stream (truncated-gzip format — standard gzip header, no trailing CRC/ISIZE)
- Parse `BasicFileInfo`, `PartAtom`, extract preview PNG
- Extract **395 class records** from `Formats/Latest` with tag + parent + ancestor-tag + declared field count for every tagged class
- Decode the 167-byte `Global/PartitionTable` structure including the stable Revit format-identifier GUID
- Decode the 307-byte `Contents` stream including the embedded UTF-16LE metadata chunk
- Produce a byte-for-byte round-trip copy of any `.rfa` / `.rvt` file
- Run across the full 11-release corpus in < 500 ms per file (release build)

**Fourteen CLIs** ship in the box:

```bash
cargo build --release

# One-shot forensic analysis — all subsystems in one report
./target/release/rvt-analyze --redact my-project.rvt
./target/release/rvt-analyze --redact --json my-project.rvt > report.json

# Quick metadata + schema summary
./target/release/rvt-info --show-classes my-project.rvt

# Machine-readable (JSON)
./target/release/rvt-info -f json my-project.rvt > meta.json

# Pull the embedded thumbnail
./target/release/rvt-info --extract-preview preview.png my-project.rvt

# Plain-language file health and IFC export readiness
./target/release/rvt-inspect my-project.rvt
./target/release/rvt-inspect my-project.rvt --json

# Compare two versions of the same file (cross-version byte diff)
./target/release/rvt-diff --decompress 2018.rfa 2024.rfa

# Dump the full class schema (395 classes, 13,570 fields)
./target/release/rvt-schema my-project.rvt

# Document upgrade history (which Revit releases have opened this file)
./target/release/rvt-history my-project.rvt

# Pull every UTF-16LE string record out of Partitions/NN
# (categories, OmniClass, Uniformat, Autodesk unit identifiers, …)
./target/release/rvt-history --partitions my-project.rvt

# Hex-dump every decompressed stream (for Phase D work)
./target/release/rvt-dump my-project.rvt

# IFC4 STEP export — spec-valid scaffold by default, with honest quality warnings
./target/release/rvt-ifc my-project.rvt -o out.ifc

# Require a stronger quality gate before writing IFC
./target/release/rvt-ifc my-project.rvt -o out.ifc --mode strict

# IFC4 export with a shareable JSON readiness/support sidecar
./target/release/rvt-ifc my-project.rvt -o out.ifc --diagnostics out.diagnostics.json

# Diagnostic IFC export — include low-confidence proxy candidates with provenance
./target/release/rvt-ifc my-project.rvt -o diagnostic.ifc --diagnostic-proxies

# glTF 2.0 binary export — loads in Three.js / Blender / any glTF viewer
./target/release/rvt-gltf my-project.rvt -o out.glb

# 2D plan-view SVG — per-category colours, ready for plot/laser-cut/printing
./target/release/rvt-sheet my-project.rvt -o out.svg

# Global/ElemTable dump — declared element-ids + record layout (family 12B / project 28B/40B)
./target/release/rvt-elem-table my-project.rvt --limit 20

# Stream-level write path — patch named OLE streams via JSON manifest
./target/release/rvt-write my-project.rvt --patches patches.json -o patched.rvt

# Per-file doc generator (schema + sample-data render for any RVT)
./target/release/rvt-doc my-project.rvt -o doc.md

# Cross-version corpus analysis (11 releases in one pass)
./target/release/rvt-corpus /path/to/corpus-dir
```

Thirty-six reproducible probes live in `examples/` — one per FACT in the recon report:

```bash
cargo build --release --examples

# --- schema ↔ data linkage (Phase D) ---
./target/release/examples/probe_link              <file>           # null-hypothesis: class names absent from Global/Latest
./target/release/examples/tag_bytes               <file>           # hex around known class names in Formats/Latest
./target/release/examples/tag_dump                <file>           # statistical sweep of post-name u16 patterns
./target/release/examples/link_schema             <file>           # tag-frequency histogram in Global/Latest (340× non-uniformity)
./target/release/examples/tag_drift               <sample-dir> <out.csv>   # per-class drift table 2016-2026
./target/release/examples/tag_drift_svg           <in.csv> <out.svg>       # render drift table as colour-coded SVG heatmap

# --- record framing (Phase 4c) ---
./target/release/examples/record_framing          <file>           # dump bytes at tagged-class defs + first tag occurrence
./target/release/examples/elem_table_probe        <sample-dir>     # Global/ElemTable structural sweep across releases
./target/release/examples/partitions_header_probe <sample-dir>     # 44-byte Partitions/NN header + chunk offsets
./target/release/examples/contents_probe          <file>           # Contents stream decoder (creator name + build tag)

# --- stable anchors ---
./target/release/examples/partition_invariant     <sample-dir>     # find 165-byte invariant in Global/PartitionTable
./target/release/examples/partition_diff          <sample-dir>     # show the 2 varying bytes per release
./target/release/examples/partition_full          <file>           # full annotated hex dump + UUID decode

# --- write path (Phase 6) ---
./target/release/examples/roundtrip                                # copy 2024 sample, verify all 13 streams identical
```

## Format overview

Every Revit file is a Microsoft Compound File Binary (OLE2) container with
this stream layout (constant across 11 years of Revit releases):

```
<root>
├── BasicFileInfo                 UTF-16LE metadata
├── Contents                      custom 4-byte header + DEFLATE body
├── Formats/Latest                DEFLATE — class schema inventory
├── Global/
│   ├── ContentDocuments          tiny document list
│   ├── DocumentIncrementTable    DEFLATE — change tracking
│   ├── ElemTable                 DEFLATE — element ID index
│   ├── History                   DEFLATE — edit history (GUIDs)
│   ├── Latest                    DEFLATE — current object state (17:1 ratio)
│   └── PartitionTable            DEFLATE — partition metadata
├── PartAtom                      plain XML (Atom + Autodesk partatom namespace)
├── Partitions/NN                 bulk data: 5-10 concatenated DEFLATE segments
│                                 NN = 58, 60-69 for Revit 2016-2026
├── RevitPreview4.0               custom header + PNG thumbnail
└── TransmissionData              UTF-16LE transmission metadata
```

All compressed streams use a "truncated gzip" format — the standard 10-byte
gzip header (magic `1F 8B 08 ...`) followed by raw DEFLATE, but *without*
the trailing 8-byte CRC32 + ISIZE that conforming gzip writers produce.
Python's `gzip.GzipFile` and Rust's `flate2::read::GzDecoder` both refuse
these streams. The fix is to skip the 10-byte header manually and use
`flate2::read::DeflateDecoder` on the raw body.

## Reverse engineering state

| Layer | Description | Status |
|---|---|---|
| 1 · Container | OLE2 / Microsoft Compound File ([MS-CFB]) | **Done** |
| 2 · Compression | Truncated gzip → raw DEFLATE | **Done** |
| 3 · Stream framing | Per-stream custom headers, `Partitions/NN` chunk layout, `Contents` / `Preview` / `PartitionTable` wrappers | **Done** — 165/167 bytes of `PartitionTable` invariant; 44-byte `Partitions/NN` header decoded; `62 19 22 05` wrapper magic confirmed on `Contents` + `RevitPreview4.0` |
| 4a · Schema table | Class names + fields + C++ type signatures from `Formats/Latest`; per-class tag + parent + declared field count; cross-release tag-drift map | **Done** |
| 4b · Schema→data link | Tags from `Formats/Latest` occur at ~340× the noise rate in `Global/Latest`; schema IS the live type dictionary for the object graph | **Done** |
| 4c.1 · Record framing | Tagged class records in `Formats/Latest` parse into structured records: `{tag, parent, ancestor_tag, declared_field_count}`; HostObjAttr → `{tag=107, parent=Symbol, ancestor_tag=0x0025 → APIVSTAMacroElem, declared_field_count=3}` | **Done** |
| 4c.2 · Field-body decoding | `FieldType` enum classifies **100%** of schema fields across 8 variants (Primitive, String, Guid, ElementId, ElementIdRef, Pointer, Vector, Container). 11 discriminator bytes mapped, including generalized scalar-base Vector/Container (`{kind} 0x10 ...` / `{kind} 0x50 ...`) and the `0x0d` point-type base. | **Done (100.00% on 13,570 fields across the 11-version corpus; zero `Unknown`)** |
| 4d · ElemTable | `Global/ElemTable` header parser + rough record enumeration; record semantics remain unresolved pending per-element schema lookup | **Partial** |
| 5 · IFC4 export | Full spatial tree + per-element IFC entities + `IfcLocalPlacement` + `IfcExtrudedAreaSolid` + compound material layers + typed property sets + `IfcOpeningElement`/`IfcRelVoidsElement`/`IfcRelFillsElement` for doors and windows. Deterministic ISO-10303-21 output. IfcOpenShell + BlenderBIM verified. | **Done** (rectangular profiles; swept / revolved / BRep fallbacks ship but use rectangular in the default emission path — IFC-17/24 is the remaining refinement) |
| 6 · Write path | Byte-preserving copy for unchanged files; stream-level patching for named OLE streams with atomic temp-file rename, per-stream verification, grow/shrink/multi-stream coverage, and GUID/history preservation checks. Field-level semantic patching is Phase 7. | **Done (stream-level); field-level pending** |
| 7 · Browser viewer | WebAssembly build of the core + Three.js + Vite + Pages deploy. Zero-upload, in-tab parse, export buttons for glTF/IFC/SVG, URL-state share. Live at <https://drunkonjava.github.io/rvt-rs/>. | **Done** (VW1-01..24) |

All 5 original P0 research questions (Q4-Q7) are **resolved**. Layer 4c.2 reaches **100.00% field-type classification** on the 11-version reference corpus (13,570 total schema fields, zero `Unknown`). IFC4 emission, glTF export, 2D plan view, and the browser viewer all ship. The next frontier is real-world project-file corpus validation (Q-01) — one `.rvt` probe already caught a `gzip_header_len` bounds bug that family files never hit.

Key findings from this phase:

- **Q4** The u16 "flag" word in each tagged-class preamble is a **class-tag reference** (ancestor / mixin / protocol). 9/9 non-zero values resolve to named classes in the same schema.
- **Q5** Each field's `type_encoding` is `[byte category][u16 sub_type][optional body]`. 9 category bytes mapped (`0x01` bool, `0x02` u16, `0x04/0x05` u32, `0x06` f32, `0x07` f64, `0x08` string, `0x09` GUID, `0x0b` u64, `0x0e` reference/container).
- **Q5.1** Coverage extended to 84% of fields.
- **Q5.2** Coverage reaches **100%** of fields (13,570 across 11 releases). Generalized `{scalar_base} 0x10 ...` / `{scalar_base} 0x50 ...` as vector/container modifiers; added `0x0d` point-type base; added `0x08 0x60 ...` alternate string encoding; added `ElementIdRef { referenced_tag, sub }` for references that carry a specific target-class tag; added deprecated `0x03` i32-alias seen only in 2016–2018. See `docs/rvt-moat-break-reconnaissance.md` §Q5.2.
- **Q6** `Global/Latest` is **not** an index + heap — it's a flat TLV stream.
- **Q6.1** Instance data is **schema-directed** (tag-less, protobuf-style). Decoding requires schema-first sequential walk from a known entry point.
- **Q7** `Partitions/NN` trailer u32 fields are **not** per-chunk offsets. Gzip-magic scan remains correct.

The full analysis narrative with 12 dated addenda lives in [`docs/rvt-moat-break-reconnaissance.md`](docs/rvt-moat-break-reconnaissance.md). Session-length synthesis in [`docs/rvt-phase4c-session-2026-04-19.md`](docs/rvt-phase4c-session-2026-04-19.md).

## Sample corpus

Integration tests run against 11 versions of Autodesk's public
`rac_basic_sample_family` RFA fixture (one per Revit release from 2016
through 2026). These are distributed via Git LFS in the `phi-ag/rvt`
repository. To pull them:

```bash
cd /path/to/rvt-recon/samples
git clone https://github.com/phi-ag/rvt.git _phiag
cd _phiag && git lfs pull
cd .. && cp _phiag/examples/Autodesk/*.rfa .
```

The integration tests in `tests/samples.rs` skip any year whose RFA file
is absent, so partial corpora are okay — you'll just see
`skipping 2024: sample not present` messages.

## Design choices

- **cfb crate over custom OLE parser** — the `cfb` crate is mature,
  tested against Office documents, and handles both short and regular
  sectors. Faster than writing our own.
- **flate2 over miniz_oxide direct** — `flate2` wraps both `miniz_oxide`
  (pure Rust) and libz backends. We pick the default pure-Rust build to
  avoid a C toolchain dependency.
- **quick-xml over xml-rs** — ~3x faster, zero-copy friendly, and the
  `.from_str` + event-loop pattern is closer to what Go/Python parsers do.
- **encoding_rs over stdlib** — Revit's UTF-16LE streams sometimes have
  malformed pairs at boundaries (single-byte markers get interleaved).
  `encoding_rs` recovers gracefully where stdlib panics.
- **BTreeSet for class names** — deterministic ordering in output (plus
  sorted JSON) matters for diffable CLI output.

## Running the tests

```bash
cargo test --release
```

Expected output (as of 2026-04-21):

```
test result: ok. 697 passed; 0 failed   (lib unit tests)
test result: ok.  38 passed; 0 failed   (fuzz-regression harness, Q-04)
test result: ok.   9 passed; 0 failed   (integration tests, 11-version corpus)
test result: ok.   3 passed; 0 failed   (ifc_roundtrip + ifc_synthetic_project/structural)
...
```

Integration tests are skipped if the sample RFAs are absent. The fuzz-regression harness (`tests/fuzz_regressions.rs`) runs hand-crafted adversarial inputs through each libFuzzer target's entry point — no libFuzzer runtime needed — so any future commit that regresses crash-resistance trips the gate locally.

## License and trademarks

- **Code**: Apache License 2.0. See [`LICENSE`](LICENSE) for the full
  text and [`NOTICE`](NOTICE) for attribution detail.
- **Trademarks**: "Autodesk" and "Revit" are registered trademarks of
  Autodesk, Inc. This project is **not affiliated with, endorsed by,
  or sponsored by Autodesk**. References to "Autodesk" and "Revit" in
  this project identify the file format this reader parses and are
  nominative fair use.
- **Interoperability basis**: reverse engineering for the purpose of
  creating an independently-developed interoperable program is
  recognised as lawful fair use under *Sega Enterprises v. Accolade*,
  977 F.2d 1510 (9th Cir. 1992) and *Sony Computer Entertainment v.
  Connectix*, 203 F.3d 596 (9th Cir. 2000) in the United States, and
  under Article 6 of the EU Software Directive 2009/24/EC in the
  European Union. File formats themselves are not copyrightable
  subject matter (*Baker v. Selden*, 101 U.S. 99 (1879); *Lotus
  Development v. Borland*, 516 U.S. 233 (1996)).
- **No Autodesk proprietary code** is used, referenced, or
  redistributed by this project. All file-format observations were
  made by inspecting the bytes of publicly-shipped Autodesk sample
  content and by parsing the public `RevitAPI.dll` NuGet package's
  exported symbol list. See [`NOTICE`](NOTICE).
