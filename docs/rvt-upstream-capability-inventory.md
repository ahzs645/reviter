# Pinned rvt-rs capability inventory and reader comparison

This inventory covers Helen's `rvt-rs` commit
[`1c3d337dbd2a6810e9dfad68fe99857843d67387`](https://github.com/helenkwok/rvt-rs/tree/1c3d337dbd2a6810e9dfad68fe99857843d67387)
against Reviter's semantic integration branch. The machine-readable
[inventory](rvt-upstream-capability-inventory.json) enumerates **all 158 Rust
source modules, all 19 CLIs, 28 WASM/Python/viewer package files, 203 Rust research
examples and 11 native fuzz entry points**. Every source module has a disposition,
source hash, declaration/public-symbol witnesses and links to its capability
group. The generator rejects an unclassified source module.

Source declaration excerpts retain their upstream attribution under the
[Apache-2.0 licence](third-party/rvt-rs/LICENSE) and
[NOTICE](third-party/rvt-rs/NOTICE); integration provenance is recorded
[separately](rvt-semantic-attribution.md).

That is inventory completeness, not a claim that all upstream behavior has been
ported, that a typed accessor works on every model, or that either converter
recovers all geometry. Different portions of the same upstream module can supply
already present functionality and still expose a semantic gap. Local source and
test availability are recorded separately from actual test/conversion results.

The original seven priorities were a useful first pass. The broader review adds
source metadata-only inspection, schedules, deeper native MEP graph ports and
dimensions, stored/type IFC identity cases, additional entity/property mappings,
and phase/room/level metadata. It also adds an on-demand bounded source-graph bridge for native definitions,
units/bindings, saved metadata and Extensible Storage catalogs. Its partial
graphs remain source evidence rather than evaluated model semantics.

## What remains beyond the selective integrations

| Upstream behavior | Reviter comparison | Requirement for a faithful port |
| --- | --- | --- |
| General structural native records, `ObjectGraph` and ADocument typed fields | On-demand patched WASM exposes selected upstream native records and partial graphs, with explicit namespaces/budgets | Preserve pointer/owner evidence and raw fallbacks; the selected dump is not complete document recovery or evaluated Revit API values |
| Custom/shared parameter definitions, binding tables and family value slots | Native-evidence summary exposes upstream parameter registries, units and binding context alongside raw values | Individually join stored slots by native definition identity; no formula evaluation or caption-based storage guessing |
| File-local Extensible Storage schema catalogs and owner-attached payload inventories | Source-evidence bridge exposes catalog/owner payload summary state and diagnostics | Respect selected-record/output budgets; catalog presence is not evaluated entities or verified cross-document remapping |
| Native View/Sheet/Schedule/Grid/Dimension/Tag/TextNote/ReferencePlane fields | Reviter's user markup, CSV inventory and DWG tools serve different purposes | Recover owner/view-scoped source records. Do not claim a source drawing or native schedule formula from a user annotation or exported CSV |
| Native Area/MEP Space, Workset/Revision and survey/base-point typed semantics | Rooms, option selection, source phase references, partition labels and explicit GIS control-point alignment are narrower | Add exact class/field/namespace joins. Partition labels are not verified worksets; a reviewed WGS84 fit is not a decoded Revit shared-coordinate transform |
| IFC profile/material-profile descriptors and reusable mapped representations | Reviter emits recovered tessellation, source-room extrusions, materials/layers/constituents, typed entities and opt-in measured hollow-pipe reconstruction | Reuse proven source type/symbol geometry and profile dimensions; do not derive named parametric profiles from envelopes. This can improve authoring semantics/file size without replacing native scene geometry |
| Full URL-fragment camera/category/section/annotation state | New source-hash-bound camera viewpoint links supplement preferences/review bundles; complete upstream filter/clip/annotation interchange remains narrower | Retain the versioned model hash/coordinate conventions when adding non-camera state; do not pass upstream state into incompatible coordinates |

Important source entry points are
[`native_document.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_document.rs),
[`native_parameters.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_parameters.rs),
[`native_parameter_definitions.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_parameter_definitions.rs),
[`native_metadata.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_metadata.rs),
[`native_es_catalog.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_es_catalog.rs),
[`native_extensible_storage.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/native_extensible_storage.rs),
[`elements/drafting.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/elements/drafting.rs),
[`ifc/entities.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/ifc/entities.rs)
and [`ifc/share.rs`](https://github.com/helenkwok/rvt-rs/blob/1c3d337/src/ifc/share.rs).

The untouched pinned WASM bindings expose IFC/metadata/scene/schedule operations.
Reviter records a separate local binding patch for on-demand native source
evidence. This invokes the pinned core parser without modifying its Rust decoder,
adds explicit input/inflation/record/output budgets, and retains partial/blocked
status. The independent comparison uses the untouched bundle for upstream.

## Covered behavior and narrower portions

The detailed evidence and limitations for each row are in the JSON; “present”
here means overlapping behavior, not the same parser, release coverage or output.

| Domain | Existing or newly added Reviter behavior | Limits that remain explicit |
| --- | --- | --- |
| Container/release/compression | CFB inventory, checksum stripping, truncated-gzip inflation, bounded salvage and release decoding | Rust and JS can refuse different malformed CFB envelopes; scan and inflation limits differ |
| Schema/tags/identity | File-local schema fields, class-tag translation, Identifier widths, ownership and creation-history/native IFC ID joins | Native graph namespaces/pointer values and all exporter-specific GUID configurations are separate |
| Project/family metadata | Geometry-independent safe metadata inventory, Atom/ProjectInformation local-header ZIP recovery, transmission references and partition names | Safe sharing omits local paths/users; linked-model graphs and verified workset semantics remain unresolved |
| Native semantic records | Instance/type values, family/type names, hosts, levels, category evidence, broader IFC mappings and on-demand stored graph/definition/catalog inspection | Generic raw rows are not every upstream typed class's field contract or API-evaluated values |
| Rooms/phases/options | Source rooms including boxless identities, measured stored outlines, phase/level references and primary-option selection | Source room extrusion is approximate evidence; no routing certification, lifecycle order guess or hidden unresolved option |
| MEP | System membership references, measured counted joins, pinned native graph projection, unconnected ports and source dimension readers | Unknown direction/placement/classification and incomplete graphs remain explicit; no proximity-generated joins |
| Materials | Native material identity, source face/type assignments, compound layers and constituent sets | Unjoined WASM definitions do not alter the scene by name; material assets and exact per-layer join visualization need separate evidence |
| Geometry | Native queue replay, analytic surfaces, BRep/mesh recovery, instancing, sketch holes, stairs/rails and repairs | Independent saved-graphics selection, UV meshing, column/beam cuts, wall/layer joins and roof slope/axis semantics need owner-level comparison |
| Exports | Typed IFC, GLB, plan/floor SVG, JSON evidence and element/room/raw-parameter CSV | CSV is an inventory, not a native authored Schedule; representation count is not shape accuracy |
| Viewer | Local-file workers, trees/picking/categories, sections, camera/walk, measurements, markup and hash-bound camera links; richer floor/campus/DWG/routing/review flows | Native source drawings/annotations and complete camera/filter/clip/annotation fragment interchange are separate |
| Validation | Coverage/limit diagnostics, capability contracts, adversarial tests, seeded bounded TS fuzzing and paired IFC audits | Upstream strict/scaffold modes describe its own model. TS fuzzing excludes arbitrary CFB allocation metadata and native Rust fuzz targets |

Upstream `partition_*` helpers use measured, release-specific byte protocols.
Reviter frequently obtains the displayed shape through an independent saved BRep,
analytic surface or instance path. Applying upstream's untrimmed-record-box wall,
column or beam repairs to an already trimmed body can double-trim it. A same-owner
comparison must establish the actual missing shape before a geometry port is useful.

The following upstream surfaces are accounted for but are outside this read-only
browser converter integration:

- Native RVT CFB copy/stream patching/recompression/writer round trips. IFC/GLB
  export and shared-parameter text writing are different operations.
- Python wheel/host bindings. Their underlying decoder capabilities are covered
  by the core source inventory; porting Python packaging into a browser is not
  an additional recovered model capability.
- Corpus byte-delta inference, compound marker probes, research evidence/SCC
  relation contracts, oracle tooling and example programs. Exported research
  helpers are not production geometry or verified ES remapping.
- Build styles/configuration, staged demo assets and viewer tests. They are
  enumerated as package assets, separate from native decoder coverage.

## Reproducible reader comparison

The new comparison command runs the exact input through independent child
processes, then inventories the emitted IFCs. Its default Reviter branch uses
`convertRvtBytes` plus the same optional standards-reader enrichment used by the
app. It does not feed reference IFC geometry into either reader.

```sh
node scripts/rebuild-rvt-wasm.mjs --vanilla --out /workspace/rvt-rs-vanilla-pkg
npm run compare:rvt-readers -- \
  --input /workspace/models/rac.rvt \
  --upstream-wasm /workspace/rvt-rs-vanilla-pkg/rvt.js \
  --reviter-wasm /workspace/reviter/lib/rvt-wasm/rvt.js \
  --output /workspace/scratch/rac-head-to-head.json \
  --timeout-ms 600000 --heap-mib 6144 --baseline-dir /workspace/models

npm run compare:rvt-readers -- \
  --input /workspace/models/unbc.rvt \
  --upstream-wasm /workspace/rvt-rs-vanilla-pkg/rvt.js \
  --reviter-wasm /workspace/reviter/lib/rvt-wasm/rvt.js \
  --reference-ifc /workspace/models/unbc-reference.ifc \
  --output /workspace/scratch/unbc-head-to-head.json
```

Repeat `--input` for a batch; an optional `--reference-ifc` must be paired with a
single input. Each result records the independently read source SHA-256 and
byte length, detected release, mode/limits, exact pinned WASM/JS artifact hashes,
elapsed time and error/refusal/worker-failure/timeout state. Source identity
comparison is withheld if the two input hashes differ. Worker reports and both
generated IFC documents live beside the report in its `.artifacts` directory.
If a worker stops before reporting its hash, the hash comparison is explicitly
unavailable rather than a claim that the files differ.

When only Reviter changes, `--reuse-upstream` accepts a previous independently
reopened summary from `scripts/summarize-rvt-reader-comparison.ts`. It verifies
exact input SHA-256/length, all vanilla artifact hashes, export mode/walker
settings and the recorded upstream IFC SHA-256/length before copying that IFC
into new artifacts. It runs a fresh Reviter worker for every model and carries
its reuse proof/hash and original upstream elapsed time forward. Changed input,
binary, settings or IFC bytes are refused; old Reviter outputs are never reused.

The upstream branch requires the exact untouched vanilla bundle hashes. The app
may use a separately built optional reader with declared local binding patches;
both full provenance records and all artifact hashes are checked and saved.
Passing the patched app reader as `--upstream-wasm` fails before conversion, so
the comparison cannot accidentally benchmark Reviter against its own modified
upstream bundle. Keep a vanilla snapshot before rebuilding the optional reader.

The upstream default is `scaffold` with the pinned reader's 128 MiB walker scan
budget, 100,000 candidates, 16,000,000 trial offsets, 1 MiB per-record decode
budget and 1,000 container rows. App enrichment uses its independently bounded
16 MiB/10,000/1,000,000/1 MiB/256 settings. Those walker limits constrain specific
scans; they do not bound every upstream partition inflation or exporter operation.
Both branches have isolated worker deadlines and recorded Node heap budgets.
`--upstream-mode typed-no-geometry|geometry|strict` changes the upstream acceptance
bar; a stronger mode can legitimately refuse rather than emit a sparse model.

The comparison tool explicitly enables native-room IFC evidence by default;
the ordinary exporter remains opt-in. Optional pipe reconstruction remains off
in this standard comparison, so source scene and reconstructed IFC behavior are
measured separately. Use `--native-rooms false`, `--mep false`
or `--design-options main-and-primary` to compare a different declared export
policy. A reader's quality gate is not another reader's geometry support contract.

The report includes actual instance/entity/product class counts, represented
product counts, duplicate root IDs, Pset names, geometry representation kinds,
upstream body-source diagnostics, Reviter geometry-source/final-provenance
breakdowns and GlobalId/decimal Element.Tag intersections. Type-ID comparison
follows each product's actual `IfcRelDefinesByType` relationship, with exact Tag
joins, source/output type-class pairs, ambiguities and mismatch samples rather
than joining every projected type by a repeated native type Tag. Tag joins deliberately
exclude source IDs present only in properties, and the lexical product classifier
is not a complete IFC EXPRESS implementation. The STEP scanner handles escaped
quotes, multiline strings, nested lists and comments so descriptive text cannot
invent fake entity records.

These are observations. **Matching counts, IDs, or representation types do not
prove geometry or semantic accuracy.** World placements, trim topology, area,
volume, source ownership and authored parameter meaning need independent paired
model checks. Bounding-box body counts are kept separate from measured/native
geometry provenance instead of being presented as exact shape recovery.

```sh
npm run test:reader-comparison
python scripts/inventory-rvt-upstream-capabilities.py --upstream-root /workspace/rvt-rs-upstream
```

Use `--baseline-dir` to compare the exact mesh-buffer digest, triangle/mesh/bounds
counts, scene origin and extents with pre-integration snapshots. The final
[model comparison](rvt-upstream-comparison.md) records the actual executions.

Regenerate the inventory after the final sibling integrations. Its pending
local-source/test lists make unfinished wiring visible, while final build,
typecheck, runtime comparison and model-specific validation remain separate evidence.
