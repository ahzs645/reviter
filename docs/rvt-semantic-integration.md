# rvt-rs integration and comparison

This branch starts from `claude/unbc-candidate4-rules` at `4c13fd0`. The source review covers Helen Kwok's rvt-rs commit `1c3d337dbd2a6810e9dfad68fe99857843d67387`. Reviter keeps its own geometry pipeline and imports source-backed semantics through measured native readers and a pinned optional WASM reader.

The [upstream comparison](rvt-upstream-comparison.md) contains the final four-model export populations, exact geometry baseline checks, identity matches and disagreements. The [complete inventory](rvt-upstream-capability-inventory.md) accounts for every upstream Rust module, CLI, binding/viewer asset, research example and fuzz target, with a machine-readable source/test disposition. Inventory completeness does not imply that every upstream behavior is implemented or every shape is accurate.

## Implemented capabilities

| Capability | Result and evidence |
| --- | --- |
| IFC product/type identity | Creation-history product IDs, original family-symbol type IDs, supported type projections and measured door/window variants. Raw stored GUID overrides are optional; conflicting witnesses and root collisions retain safe native/default identity. [Source-only type validation](generated/rvt-family-type-source-validation.json) reports 25,723/25,723 source-only compared family type IDs matching their Revit IFCs; unresolved flips and absent relations are excluded explicitly. |
| IFC classes and properties | Instance/type export overrides, predefined types, curtain-wall refinement, broader architectural/MEP mappings, typed common property sets, source type values and explicitly named native computed quantities. Conflicting values remain unresolved; producer default booleans do not become source facts. |
| Rooms, phases and levels | Source room identities, stored outlines, exact associated levels, floor finishes, native creation/demolition phase references and level constraints. Default IFC can include source rooms through a control; source outlines remain separate from reviewed room and navigation boundaries. Lifecycle status needs proven phase order and a selected phase. |
| MEP graph and dimensions | Source system reference candidates, measured ports/joins, same-byte native graph projection, unconnected ports and release-bounded duct/pipe/fitting dimensions. All 73 mechanical and 126 plumbing connections represented by the positive paired IFCs are recovered; two additional plumbing joins have a native owner absent from the reference. [Detailed validation](native-mep-integration.md) records the distinction. |
| Optional IFC pipe bodies | Verified native axes and inner/outer diameters can reconstruct eligible proxy or missing pipe bodies as hollow sweeps. Certified native/reference bodies stay intact. All 69 source pipe witnesses reopen and tessellate; explicit 64-segment tessellation has a worst six-face bounds error of 0.071 mm. These bodies remain reconstructed, never exact native BReps. |
| Design options | Source option sets and primary selections, with all-options or main-and-primary IFC export. Unresolved alternatives remain included. |
| Document metadata and CSV | Geometry-independent safe BasicFileInfo/Atom metadata, project properties, element inventory, native room schedules and raw instance/type parameter CSV. CSV text is formula-neutralized and source units are explicit. These inventories do not claim native authored schedule/formula evaluation. |
| Native source evidence | A declared WASM-only patch exposes bounded selected owner graphs, saved metadata, parameter definitions, units, bindings and stored extensible-storage catalogs. RAC yields 774 definitions; Snowdon yields 1,604 and nine stored ES schemas. [Inspector documentation](native-source-evidence.md) describes actual witnesses and partial/unsupported states. |
| Browser workflow | Desktop/mobile IFC controls and CSV/evidence downloads, source properties/report inspection, and exact-source-SHA-bound portable camera links. Capture uses the live camera; links defer until the matching RVT opens and refuse different bytes. Production worker construction is fixed so Vite emits compiled worker modules. |
| Validation | Executable release/capability contracts, seeded bounded malformed-input testing and an isolated reader comparison command with separate original/patched WASM provenance, exact source hashes, resource limits and timeout/failure reporting. |

## Reproduction

```sh
npm run compare:rvt-readers -- --input model.rvt \
  --upstream-wasm /path/to/vanilla/rvt.js \
  --reviter-wasm /path/to/reviter/lib/rvt-wasm/rvt.js \
  --reference-ifc paired.ifc --output comparison.json

npm run inspect:rvt-evidence -- model.rvt --out evidence.json
npm run inspect:rvt-evidence -- model.rvt --ids 123,456 --out owners.json
npm run inspect:rvt-evidence -- model.rvt --classes TextNote,Dimension --out annotations.json

node scripts/rebuild-rvt-wasm.mjs
node scripts/rebuild-rvt-wasm.mjs --vanilla --out /path/to/vanilla
npm run test:capabilities
npm run test:fuzz
npm run fuzz:rvt -- --seed 5396052 --cases 256 --output fuzz.json
```

The vanilla rebuild uses a clean pinned upstream checkout and a separate output directory. The vendored package records the exact local patch and generated file hashes. Uploaded source RVTs, paired IFC/GLB exports and raw native graph dumps remain outside Git. [Licence and attribution](rvt-semantic-attribution.md) identify upstream inputs and substantive adaptations.

The initial seven-area audit reports remain under `docs/generated/rvt-semantic-integration-2026-10-14/` as earlier evidence. Their initial MEP counts and unsupported-feature statements are superseded by the expanded comparison and witnesses above.

## Remaining limits

Final [checks](generated/rvt-integration-checks-final.json): 1,976 unit tests passed, two skipped; typecheck, production/GitHub Pages builds, four rendered-HTML checks and the Pages check passed. The seeded malformed-input run has 256 cases, 2,560 target runs and zero failures. [Desktop/mobile export checks](generated/rvt-export-browser-validation.json) and [RAC camera-link checks](generated/rvt-viewpoint-browser-validation.json) passed. Changed-source lint has no new diagnostics; one unchanged auto-open effect error in the touched DWG component is confirmed against the base. Repository-wide lint remains an inherited baseline limitation.

UNBC matches all 35,117 unambiguous shared product GlobalIds. Full product-to-type identity parity remains incomplete: 36,886 of 37,132 relationships match Revit's paired IFC (99.34%), with 246 differences. The source-only original-symbol proof remains separate from full type parity. The remaining 224 column and 22 door/window differences need additional geometry-bearing type or flip decoding; the comparison retains their populations and examples.

Full native drawing reconstruction, native schedule/formula evaluation, every parametric/mapped IFC representation and complete filter/section/annotation URL state remain narrower or unresolved. General native graph access preserves serialized evidence and diagnostics; it does not turn unknown graph fields into evaluated BIM facts. Native RVT writing, Python packaging and research-only oracle/remapping tools are accounted for separately from this browser converter. See the inventory for each remaining gap.

The [further integration report](rvt-upstream-continuation.md) covers typed source records, exact parameter-slot joins, complete table inventories, deferred symbol fields, optional IFC maps and viewpoint v2. Their source/model/browser evidence is retained separately from the original reader comparison.
