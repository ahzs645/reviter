# Reviter and pinned rvt-rs: implemented capabilities and model comparison

Reviter retains its native scene pipeline and adds source semantics and selected
upstream evidence. The integration extends the initial seven priorities with
native graph inspection, parameter/Extensible Storage inventories, source
metadata, CSV schedules, source dimensions, optional pipe reconstruction and
source-bound viewer links. The [continuation](rvt-upstream-continuation.md) adds typed document records, exact stored parameter joins, complete source table inventories, deferred symbol fields, optional IFC maps and category/section exchange. The exhaustive [source inventory](rvt-upstream-capability-inventory.md)
records remaining narrower behavior and unresolved geometry differences. This is
a measured selective integration, not complete parity with every Rust research,
native-writer or typed-view API.

## Independent readers and reproducibility

The upstream baseline is Helen's untouched
[`1c3d337dbd2a6810e9dfad68fe99857843d67387`](https://github.com/helenkwok/rvt-rs/tree/1c3d337dbd2a6810e9dfad68fe99857843d67387)
WASM package. Reviter's optional reader has the same core commit plus the recorded
[native-evidence binding patch](../lib/rvt-wasm/patches/native-evidence.patch).
That patch exposes bounded on-demand stored source graphs, definitions, units,
bindings, saved metadata and ES catalogs; it does not modify the upstream Rust
geometry decoder. The [build provenance](../lib/rvt-wasm/provenance.json) records
both the patch and generated binary hashes. The comparison CLI verifies all
artifact hashes and refuses a patched bundle as the upstream baseline.

Each initial RVT comparison used sequential isolated workers with a 900-second deadline
and 6,144 MiB Node heap setting. Upstream uses its `scaffold` mode and walker
budgets of 128 MiB scan / 100,000 candidates / 16,000,000 trial offsets / 1 MiB
record / 1,000 container rows. Reviter uses its native converter, 12,000 geometry
segments and 256 MiB native-mesh cap, plus the app's optional scaffold enrichment
at 16 MiB / 10,000 / 1,000,000 / 1 MiB / 256. These are different declared
policies; walker budgets do not bound every upstream inflation operation. This
compares the pinned WASM scaffold-to-IFC path, rather than every native Rust CLI
or a geometry/strict-mode campaign. Sparse scaffold output does not establish
that all other upstream recovery paths would fail on the same file.

Comparison IFC export enables source rooms and MEP evidence and retains all
design alternatives. Optional pipe reconstruction and stored GUID overrides
remain off in this batch. Ordinary app export provides explicit controls for
these choices. No paired reference geometry enters either conversion. The
final IFC outputs are independently reopened with `web-ifc`; no RVT is
reconverted for the reopens or reference-ID comparisons. After the continuation source-table and FIFO changes, every Reviter model was freshly reconverted. The
unchanged upstream outputs were reused from the
[prior final report at dd4c6d3](https://github.com/ahzs645/reviter/blob/dd4c6d3672606b5c01ac7162f969b68f3485d133/docs/generated/rvt-reader-comparison-final.json),
with exact input/binary/output hashes and mode/walker settings checked before
copying; reuse provenance and original elapsed times are retained.

```sh
# Build a separate untouched baseline from a pristine pinned checkout.
node scripts/rebuild-rvt-wasm.mjs --vanilla --out /workspace/rvt-rs-vanilla-pkg
npm run compare:rvt-readers -- \
  --input /workspace/models/rac.rvt --input /workspace/models/school.rvt \
  --input /workspace/models/snowdon.rvt --input /workspace/models/unbc.rvt \
  --upstream-wasm /workspace/rvt-rs-vanilla-pkg/rvt.js \
  --reviter-wasm /workspace/reviter/lib/rvt-wasm/rvt.js \
  --baseline-dir /workspace/models \
  --output /workspace/scratch/head-to-head-continuation.json \
  --timeout-ms 900000 --heap-mib 6144
node --experimental-strip-types --max-old-space-size=6144 \
  --import ./scripts/register-test-typescript.mjs \
  scripts/summarize-rvt-reader-comparison.ts \
  /workspace/scratch/head-to-head-continuation.json \
  docs/generated/rvt-reader-comparison-final.json \
  /workspace/models/unbc-reference.ifc
```

The commands above reproduce both readers from scratch. The recorded updated
run additionally passed `--reuse-upstream docs/generated/rvt-reader-comparison-final.json` using that file before replacing it with the new summary; its original SHA-256 is retained in every reuse proof.
that optimization requires its prior external `.artifacts` directory and is
optional when reproducing from a clean checkout.

An earlier owned-enum conflict-preservation fix landed after the archived RAC worker. A
[source-only full RAC page scan](generated/rvt-rac-ifc-enum-conflicts.json)
confirmed the identical source hash, 1,157 pages and zero occurrences/conflicts
of those enum fields, so that archived result remained valid. The current results use fresh Reviter workers.
Stored GUID collision handling is irrelevant to this batch because overrides
are off.

## What changed and how it was checked

| Capability | Resulting Reviter behavior | Evidence and boundaries |
| --- | --- | --- |
| IFC identity | Default native product GlobalIds; original-symbol/type recipes; opt-in validated stored ID overrides | Exact creation-history/element identity joins. Exporter variants, unknown flip evidence and source/reference differences remain visible |
| IFC semantics | Instance/type export settings, broader classes/predefined types, allowlisted common properties and source quantities | Native parameter IDs and strict same-byte pinned model joins. No caption-derived built-ins, hardcoded upstream booleans or guessed Net/Gross meaning |
| Source rooms | Native identities including boxless rooms, stored outlines, exact supported level joins and finishes; opt-in IFC spaces | Source room copies remain separate from reviewed navigation rooms. Stored-outline extrusion does not certify enclosure, ceiling shape or routing |
| MEP | Native systems, physical joins, unconnected ports, ducts/pipes/fitting dimensions and exact supported axes | Mechanical 73/73 paired joins and 150/150 ports; Plumbing 126/126 joins and 260/260 ports plus two source tank joins/four ports absent from its paired IFC; Electrical 53/53 unconnected ports |
| Pipe representations | Opt-in hollow-circle IFC extrusion for eligible missing/proxy pipe bodies | 69 measured pipes; 64-segment independent IFC reopen maximum bound error below 0.072 mm. Reconstruction stays labeled approximate and preserves certified native/reference bodies |
| Source organization | Primary design-option selection, phase IDs/names, supported level/top/base constraints | Unknown options remain visible. Raw created/demolished phase IDs do not establish chronological lifecycle status |
| Source evidence | On-demand worker/CLI inspection of selected stored graphs, parameter registries, units/bindings, saved metadata and ES summary | Budgets/partial/blocked states explicit; unsafe integers use decimal strings. No formula evaluation, ES remapping or drafting reconstruction |
| Metadata and schedules | Safe metadata-only inventory and source element/room/raw parameter CSV downloads | 40/40 project/family metadata fields matched native upstream inspection on supplied models; RAC 14/14 room area values agree within 0.0001 m². CSV is an inventory, not an evaluated authored Revit Schedule |
| Viewer exchange | SHA-256-bound canonical-coordinate camera/category/section URL links | Wrong model/source frame refused; annotation, selected objects and render modes remain separate |
| Validation | Executable capability gates, bounded malformed-input campaigns, isolated same-input reader comparison | Test execution, source inventory completeness and geometric accuracy are reported as different claims |

The positive MEP evidence includes 94 matching native lengths, 69 matching pipe
outside radii, 25 matching duct section/length triplets and 42 matching plumbing
fitting nominal diameters. Source-only values absent from the paired IFC remain
separate. Exact fixture URLs, hashes and measured results are retained in the
[MEP reference report](generated/rvt-mep-reference-validation.json).

## Final supplied-model results

The compact [execution report](generated/rvt-reader-comparison-final.json)
contains source SHA-256, independent reader settings, full binary provenance,
IFC hashes/class/Pset inventories, reopen populations, baseline checks and
identity comparisons. Geometry baselines come from the requested
[`claude/unbc-candidate4-rules` base at `4c13fd03e1ef994311f55e2312ef2590b898fb53`](https://github.com/ahzs645/reviter/tree/4c13fd03e1ef994311f55e2312ef2590b898fb53),
before this integration. The digest covers each mesh's positions, indices,
colors and element ownership buffers in order. Large source models, references
and generated IFCs stay
outside Git. Their hashes make the reported inputs and outputs identifiable.

| Model / release | Upstream IFC products / represented | Reviter IFC products / represented | Reviter triangles | Original scene checks | Independent reopens |
| --- | ---: | ---: | ---: | --- | --- |
| rac.rvt / 2025 | 550 / 478 | 578 / 475 | 195,555 | All 6 exact matches | Both IFCs accepted |
| school.rvt / 2025 | 5,743 / 5,679 | 5,752 / 5,592 | 393,145 | All 6 exact matches | Both IFCs accepted |
| snowdon.rvt / 2024 | 6,854 / 6,253 | 9,825 / 8,978 | 1,596,168 | All 6 exact matches | Both IFCs accepted |
| unbc.rvt / 2027 | 0 / 0 | 40,259 / 36,415 | 901,903 | All 6 exact matches | Both IFCs accepted |

All four independently read input hashes agree. All 24 baseline checks match:
mesh-buffer SHA-256, triangles, meshes, recovered bounds count, scene origin and
scene extents. The UNBC upstream scaffold export contains spatial metadata and
zero products; this is an observed sparse export, not a claim about every
upstream native graphics path.

Product counts include spaces, ports and openings under the documented lexical
classifier. Represented-product counts record a shape reference; they do not
measure complete or accurate geometry. Upstream body-source counts explicitly
identify bounding-box/trimmed-box reconstructions. Reviter's native/reconstructed/
proxy provenance is recorded separately. An extrusion or tessellation count is
not itself an accuracy ranking.

## Identity comparison and remaining disagreements

| Type GlobalIds through products: Reviter against upstream | Compared | Match | Mismatch | Ambiguous |
| --- | ---: | ---: | ---: | ---: |
| rac.rvt | 433 | 414 | 19 | 0 |
| school.rvt | 5,457 | 5,345 | 112 | 0 |
| snowdon.rvt | 5,823 | 5,636 | 187 | 0 |
| unbc.rvt | 0 | 0 | 0 | 0 |

Against the supplied UNBC Autodesk IFC, **35,117/35,117 unambiguous product GlobalIds match**, with zero mismatches. The comparison excludes 2,944 ambiguous product Tag groups; 266 tags are output-only and 126 reference-only.

**Type identity improved to 36,886/37,132 matches (99.34%).** The remaining 246 mismatches are 224 column, 12 door and 10 window relationships. All 6,235 plate and 19,298 member relationships now match. There are 244 output-only and 931 reference-only typed tags. The reference uses IFC2x3 door/window styles while Reviter emits IFC4 types; unknown exporter instance/type variants remain explicit. Reference IDs are never imported as replacements.

The earlier report matched 10,426/37,132 type relationships and left 26,706 differences. The main cause was an incomplete generic element-table inventory: its 16-bit count was narrower than the complete 32-bit native table parsed for validated identity. The corrected original-symbol helper admits an extra owner only with a checksum-verified named FamilyInstance object and validated native identity, requires a complete verified GElement and named symbol, and publishes evidence only for actual source bounds/certified native mesh owners. It retains the 128 MiB checksum cap and leaves other decoder/geometry domains unchanged. The fresh IFC comparison gains 26,460 matching type relationships without changing the scene.

The separate [source-owner proof](generated/rvt-unbc-original-symbol-owner-proof.json) examined 3,666 UNBC pages with the identical source SHA. It retained 27,554 physical references from 30,301 before owner filtering, matched 25,620/25,620 admissible source-only type cases, left 1,931 flip cases and three missing-type cases unresolved, and did not hit the checksum cap. That stricter source-only witness is a different measurement from the final exported product/type relationships above. All actual class-pair counts and remaining mismatch examples are retained in the report.

Type comparisons follow each product's actual `IfcRelDefinesByType` and exact
decimal `Tag`; duplicate product/type relationships are excluded. Matching
native product IDs does not establish complete property or shape recovery.
Differences against upstream are not automatically Reviter defects: exporter
configuration and unresolved source type/flip/ownership evidence can differ.
The paired UNBC Autodesk IFC provides a separate observation, with unresolved
mismatches and ambiguity exclusions retained in the report.

## Validation and remaining scope

The continuation repository suite passed **2,017 tests with three skips**; the final hardened inventories also passed 25 focused checks. Typecheck,
production and GitHub Pages builds passed; four rendered-page and one Pages
artifact checks passed. The native evidence patch also passed seven WASM and
five Rust focused checks. A pristine separate vanilla rebuild reproduced all
four original artifact hashes exactly.

Actual browser checks recovered Mechanical's 150 ports, 73 joins and five
systems; CSV/source-JSON downloads worked. RAC camera capture/restore, wrong
source-hash refusal, initial-link deferral, matching-model restoration and
fragment/query handling passed with zero browser errors. Desktop/mobile layout
checks and final export-control results are recorded in the PR/integration
overview. These runtime checks are separate from the four full-model conversion
and independent IFC reopen results above.

Every one of the pinned repo's 158 Rust source modules, 19 CLIs, 28 binding/viewer
files, 203 research examples and 11 native fuzz entry points is classified in
the source inventory, with zero orphan modules. This does not mean every
function has been ported or works on every release. Important remaining limits
include spatial Area/MEP Space classification, full authored drawings/evaluated schedules,
native shared-coordinate transforms, family formula/inheritance evaluation,
rotated IFC maps/material-profile authoring and annotation/selection URL state,
and owner-level comparison of saved-graphics selection, joins/cuts and
parametric surfaces. Native RVT editing and research remapping contracts remain
outside this source-preserving converter integration.

The continuation additionally matches exact upstream source-table declarations on all four models, normalizes 575 supported stored parameter values with zero serialized-projection disagreements, and verifies 42,368 typed fields across RAC, School and bounded disjoint Snowdon queries. Those source projection checks do not establish Revit API-evaluated semantics. School's optional IFC sharing saves 10,419 bytes with matching independently reopened geometry/placements; its default IFC output remains the ordinary export. UNBC product/type identity results above remain unchanged after recovering 201 additional ambiguous embedded symbol references. The reader outputs were independently reopened again for this continuation.
