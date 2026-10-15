# Reviter and pinned rvt-rs: implemented capabilities and model comparison

Reviter retains its native scene pipeline and adds source semantics and selected
upstream evidence. The integration extends the initial seven priorities with
native graph inspection, parameter/Extensible Storage inventories, source
metadata, CSV schedules, source dimensions, optional pipe reconstruction and
source-bound viewer links. The [continuation](rvt-upstream-continuation.md) now adds authored schedule definitions, exact inherited symbol values, partial native annotation previews, source spatial/site evidence, rotation-aware IFC maps, gated material-profile writing and v3 viewer state. It also fixes measured native-body/default-3D selection: the UNBC scene intentionally changes. The exhaustive [source inventory](rvt-upstream-capability-inventory.md)
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
and is supplemented by the separate pristine geometry-policy campaign below. Sparse output does not establish
that all other upstream recovery paths would fail on the same file.

Comparison IFC export enables source rooms and MEP evidence and retains all
design alternatives. Optional pipe reconstruction and stored GUID overrides
remain off in this batch. Ordinary app export provides explicit controls for
these choices. No paired reference geometry enters either conversion. The
current campaign IFC outputs were independently reopened with `web-ifc`; no RVT is
reconverted for the reopens or reference-ID comparisons. All four Reviter models were freshly converted after the body-selection changes. The
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
  --output /workspace/scratch/head-to-head-final-geometry-selection.json \
  --timeout-ms 900000 --heap-mib 6144
node --experimental-strip-types --max-old-space-size=6144 \
  --import ./scripts/register-test-typescript.mjs \
  scripts/summarize-rvt-reader-comparison.ts \
  /workspace/scratch/head-to-head-final-geometry-selection.json \
  docs/generated/rvt-reader-comparison-final.json \
  /workspace/models/unbc-reference.ifc
```

The commands above reproduce both readers from scratch. The recorded updated
run additionally passed `--reuse-upstream docs/generated/rvt-reader-comparison-final.json` using that file before replacing it with the new summary; its original SHA-256 is retained in every reuse proof.
That optimization requires its prior external `.artifacts` directory and is
optional when reproducing from a clean checkout.

An earlier owned-enum conflict-preservation fix landed after the archived RAC worker. A
[source-only full RAC page scan](generated/rvt-rac-ifc-enum-conflicts.json)
confirmed the identical source hash, 1,157 pages and zero occurrences/conflicts
of those enum fields, so that archived result remained valid. The current results use fresh Reviter workers.
Stored GUID collision handling is irrelevant to this batch because overrides
are off.

## Implemented behavior and scoped evidence

| Capability | Resulting Reviter behavior | Evidence and boundaries |
| --- | --- | --- |
| IFC identity | Default native product GlobalIds; original-symbol/type recipes; opt-in validated stored ID overrides | Exact creation-history/element identity joins. Exporter variants, unknown flip evidence and source/reference differences remain visible |
| IFC semantics | Instance/type export settings, broader classes/predefined types, allowlisted common properties and source quantities | Native parameter IDs and strict same-byte pinned model joins. No caption-derived built-ins, hardcoded upstream booleans or guessed Net/Gross meaning |
| Source rooms | Native identities including boxless rooms, stored outlines, exact supported level joins and finishes; opt-in IFC spaces | Source room copies remain separate from reviewed navigation rooms. Stored-outline extrusion does not certify enclosure, ceiling shape or routing |
| MEP | Native systems, physical joins, unconnected ports, ducts/pipes/fitting dimensions and exact supported axes | Mechanical 73/73 paired joins and 150/150 ports; Plumbing 126/126 joins and 260/260 ports plus two source tank joins/four ports absent from its paired IFC; Electrical 53/53 unconnected ports |
| Pipe representations | Opt-in hollow-circle IFC extrusion for eligible missing/proxy pipe bodies | 69 measured pipes; 64-segment independent IFC reopen maximum bound error below 0.072 mm. Reconstruction stays labeled approximate and preserves certified native/reference bodies |
| Source organization | Primary options and phase/level constraints; exact revision membership/issued fields, Areas/MEP Spaces, workset visibility and active-site/survey direction proof | Areas/MEP Spaces use exact native header categories, not RoomElem names. No full workset registry, evaluated boundaries/quantities, EPSG/datum or routing certification |
| Source evidence and inheritance | Bounded stored graphs/registries; exact instance→symbol→family inheritance resolves 90 RAC symbol values for 15 instances | Raw values remain separate. Present conflicts block inheritance; no family-default substitution, formula evaluation, guessed storage or ES remapping |
| Metadata and authored schedules | Safe metadata and generated CSVs plus stored schedule field/order/filter/sort definitions, formula trees and cached cell text | RAC/School/Snowdon recover 8/10/79 complete schedules with zero source-graph disagreement. Native operator codes remain raw; no recalculated rows, formula totals or layout |
| Viewer exchange | V3 source/review-bound camera/category/section links add present-source selection, technical/xray mode and opt-in user markup; v1/v2 compatible | Bounded whitelist/4,096-character fragment, 16 annotations/128 total points/256 text characters. Wrong source/frame refused; 20 current v3 unit checks and all 12 desktop/mobile browser checks pass; selected markup is opt-in |
| Partial source drawings | Exact-view SVG previews of supported owned text/straight leaders/tag-head points/detail lines | Five SVGs source-audited and opened in Chromium. Partial annotations only: no native tag glyphs/labels, evaluated dimensions, full visibility/crop/template or regenerated sheets |
| IFC maps and structural profiles | Optional verified translation/rotation maps and owned section-shape/profile/material writer | School 78 maps/250 products including four rotation groups; structural Snowdon 141/460. **Real audited models emit zero profiles**; profile emission only qualified in owned-source fixtures |
| Native body/default-3D selection | Qualified own bodies suppress duplicate symbol fallback; descriptor-owned GConditionCut 6–8 selects stored representations | UNBC 357 area-error improvements, zero area worsening above relative 1e-5; triangles 901,903→858,388. Unknown predicates/formulas and native wall residuals remain unresolved |
| Validation | Executable capability gates, bounded malformed-input campaigns, isolated same-input reader comparison | Test execution, source inventory completeness and geometric accuracy are reported as different claims |

The positive MEP evidence includes 94 matching native lengths, 69 matching pipe
outside radii, 25 matching duct section/length triplets and 42 matching plumbing
fitting nominal diameters. Source-only values absent from the paired IFC remain
separate. Exact fixture URLs, hashes and measured results are retained in the
[MEP reference report](generated/rvt-mep-reference-validation.json).

## Current supplied-model results

The compact [current execution report](generated/rvt-reader-comparison-final.json)
records four fresh Reviter conversions, verified reuse of the unchanged pristine
upstream scaffold IFCs and eight independent IFC population reopens. All four
source SHA-256 values agree. The [four-model geometry report](generated/rvt-native-geometry-four-models.json)
records sixteen preserved baseline fields and eight expected changes: every
model retains its mesh count, recovered bounds count, origin and scene extents;
its mesh-buffer digest and triangle count change under qualified own-body and
saved-representation selection. Native source bytes are preserved.

| Model / release | Upstream scaffold products / represented | Current Reviter products / represented | Prior → current Reviter triangles | Baseline review | Independent reopens |
| --- | ---: | ---: | ---: | --- | --- |
| rac.rvt / 2025 | 550 / 478 | 578 / 475 | 195,555 → 195,167 | 4 preserved; 2 expected changes | Both IFCs accepted |
| school.rvt / 2025 | 5,743 / 5,679 | 5,752 / 5,592 | 393,145 → 378,957 | 4 preserved; 2 expected changes | Both IFCs accepted |
| snowdon.rvt / 2024 | 6,854 / 6,253 | 9,825 / 8,978 | 1,596,168 → 1,594,784 | 4 preserved; 2 expected changes | Both IFCs accepted |
| unbc.rvt / 2027 | 0 / 0 | 40,259 / 36,415 | 901,903 → 858,388 | 4 preserved; 2 expected changes | Both IFCs accepted |

Original baselines come from
[`claude/unbc-candidate4-rules` at `4c13fd03e1ef994311f55e2312ef2590b898fb53`](https://github.com/ahzs645/reviter/tree/4c13fd03e1ef994311f55e2312ef2590b898fb53).
The digest covers positions, indices, colors and element ownership buffers in
order. The strict CLI returned exit 1 because those eight digest/triangle checks
intentionally differ; all conversions, input identities and reopens succeeded.
The expected changes are independently reviewed rather than presented as
unchanged geometry.

For RAC, School and Snowdon, exact-owner comparisons use the preceding Reviter
IFCs as preservation observations. Owner/identity coverage is unchanged; this
does not establish geometric accuracy against Autodesk. Supplied GLBs contain
Autodesk database/fragment IDs without a proved Revit external-ID mapping, so
no approximate name/shape/nearest-owner mapping is substituted. UNBC has an
actual paired Autodesk IFC and the separately measured owner improvements below.
Large model/reference/IFC artifacts remain outside Git; their exact hashes are
retained in the compact reports.

Product counts include spaces, ports and openings under the documented lexical
classifier. Represented-product counts record a shape reference; they do not
measure complete or accurate geometry. Upstream body-source counts explicitly
identify bounding-box/trimmed-box reconstructions. Reviter's native/reconstructed/
proxy provenance is recorded separately. An extrusion or tessellation count is
not itself an accuracy ranking.

## Additional pristine upstream geometry-policy results

The [separate geometry-policy campaign](rvt-upstream-geometry-mode-comparison.md)
uses four fresh isolated calls to the untouched pinned WASM bundle and verifies
all source/binary/output hashes. All four API calls return IFCs. Product and
represented-product counts equal the scaffold column above; the native producer
reports bounding-box-body counters of **354 / 5,128 / 3,295 / 0** for RAC,
School, Snowdon and UNBC respectively. These are explicit producer counters,
not a guess that any eight-vertex shape is a proxy. Geometry-policy IFCs retain
their own hashes and are not assumed identical to scaffold outputs.

All four IFCs reopen in both web-ifc and IFC-Lite. Web-ifc streams finite mesh
products for **438 / 5,481 / 5,934 / 0** owners and **6,296 / 70,822 / 117,464 / 0**
triangles. These counts establish readable finite tessellation, not native
shape completeness, common-frame placement or global surface agreement with
Autodesk or Reviter.

**Content policy and quality validation are separate.** The pinned WASM binding
parses `geometry` but does not call `ExportQualityMode.validate`; native CLI and
Python callers do. An independent check of that source-defined geometry contract
passes RAC/School/Snowdon and fails UNBC because it has no typed building elements
or geometry. UNBC is therefore an observed sparse WASM success, not an API
refusal or an automatic harness downgrade. The core geometry contract itself
requires some geometry rather than exact/native bodies for every element. Exact
source references, modes, warnings and independent checks are retained in the
[39-KiB report](generated/rvt-upstream-geometry-mode-validation.json).

## Current identity validation and still-withheld recipes

| Type GlobalIds through products: Reviter against upstream | Compared | Match | Mismatch | Ambiguous |
| --- | ---: | ---: | ---: | ---: |
| rac.rvt | 433 | 414 | 19 | 0 |
| school.rvt | 5,457 | 5,345 | 112 | 0 |
| snowdon.rvt | 5,823 | 5,636 | 187 | 0 |
| unbc.rvt | 0 | 0 | 0 | 0 |

In the current full-export comparison against the supplied UNBC Autodesk IFC, **35,117/35,117 unambiguous product GlobalIds match**, with zero mismatches. The comparison excludes 2,944 ambiguous product Tag groups; 266 tags are output-only and 126 reference-only.

**Current type identity matches 36,886/37,132 relationships (99.34%).** The remaining 246 mismatches are 224 column, 12 door and 10 window relationships. All 6,235 plate and 19,298 member relationships now match. There are 244 output-only and 931 reference-only typed tags. The reference uses IFC2x3 door/window styles while Reviter emits IFC4 types; unknown exporter instance/type variants remain explicit. Reference IDs are never imported as replacements.

The earlier report matched 10,426/37,132 type relationships and left 26,706 differences. The main cause was an incomplete generic element-table inventory: its 16-bit count was narrower than the complete 32-bit native table parsed for validated identity. The corrected original-symbol helper admits an extra owner only with a checksum-verified named FamilyInstance object and validated native identity, requires a complete verified GElement and named symbol, and publishes evidence only for actual source bounds/certified native mesh owners. It retains the 128 MiB checksum cap and leaves other decoder/geometry domains unchanged. That earlier semantic-only correction gained 26,460 matching type relationships while preserving its scene. The current saved-body selection changes are measured separately.

The separate [source-owner proof](generated/rvt-unbc-original-symbol-owner-proof.json) examined 3,666 UNBC pages with the identical source SHA. It retained 27,554 physical references from 30,301 before owner filtering, matched 25,620/25,620 admissible source-only type cases, left 1,931 flip cases and three missing-type cases unresolved, and did not hit the checksum cap. That stricter source-only witness is a different measurement from the final exported product/type relationships above. All actual class-pair counts and remaining mismatch examples are retained in the report.

Type comparisons follow each product's actual `IfcRelDefinesByType` and exact
decimal `Tag`; duplicate product/type relationships are excluded. Matching
native product IDs does not establish complete property or shape recovery.
Differences against upstream are not automatically Reviter defects: exporter
configuration and unresolved source type/flip/ownership evidence can differ.
The paired UNBC Autodesk IFC provides a separate observation, with unresolved
mismatches and ambiguity exclusions retained in the report.

## Validation and remaining scope

The completed repository suite passed **2,097 tests with three skips and zero
failures** (2,100 total). Current typecheck, changed-source lint, production and
GitHub Pages builds passed, together with four rendered-page checks. After that
whole-suite run, source CSV coordinate/scope refinements passed 14 focused
checks and eight updated coordinate/CSV unit checks. Current drawing reader, v3 and source
organization checks retain their separately recorded scopes; the source
organization audit opens six actual exports in web-ifc and IFC-Lite. The pristine
vanilla rebuild reproduces all four original artifact hashes.

Actual browser checks recovered Mechanical's 150 ports, 73 joins and five
systems; CSV/source-JSON downloads worked. RAC camera capture/restore, wrong
source-hash refusal, initial-link deferral, matching-model restoration and
fragment/query handling passed with zero browser errors. Desktop/mobile layout
checks and final export-control results are recorded in the PR/integration
overview. These earlier runtime checks precede v3 and the latest body-selection changes. The current [v3 browser report](generated/rvt-viewpoint-v3-browser-validation.json) passes all 12 desktop/mobile checks with zero errors, including selection, display mode, optional markup and exactly restored canvas pixels. The [source export browser report](generated/rvt-native-inventory-browser-validation.json) verifies records/definitions/schedules/organization CSVs, source JSON, True North IFC, a selected-view annotation SVG and mobile controls/downloads with zero errors or horizontal overflow.

## Current geometric evidence and limits

The independent UNBC owner audit joins 36,048 unique decimal Tag/GlobalId pairs
without coordinate fitting. Surface-area agreement within 1% improves from
9/311 to 249/311 columns and 145/202 to 198/202 railings; 357 owner area errors
improve and none worsen beyond relative 1e-5. Four small corner residuals
increase but remain below 0.00311 ft. Two source-trimmed column witnesses have
bidirectional sampled distances below 0.000014 ft. These are finite samples,
not continuous Hausdorff guarantees, and diagnostic closed-shell volume is not
validated non-overlapping material-union volume. The zero-worsening statement refers to significant **surface-area errors**, not
material/color mismatches. Separate optional source-organization exports reopen
six actual IFCs in web-ifc and IFC-Lite with zero measured source-property or
world-triangle/material disagreements (RAC 461 owners, School 5,507 and Mechanical
83); map exports retain their separately scoped color/placement checks.

Native walls and an additional column remain unresolved: owner 1185924 has a 23.30-ft maximum sampled
surface discrepancy despite almost identical bounds; owner 801614 retains an
extra portion with a 0.8003-ft discrepancy. Column 2236110 retains a 16.54% area error and a 0.4867-ft sampled discrepancy. No reference surface or guessed
record-box cut is used as a repair. The [selection contract](rvt-native-geometry-selection.md)
retains unknown view filters, family formulas, shared-occurrence ambiguity and
exact admission/output-budget gates.

The [Autodesk exporter contract](revit-ifc-exporter-identity-contract.md) and
[246-case triage](generated/rvt-ifc-type-recipe-triage.json) document why the
remaining type recipes are withheld. All 224 column reference IDs match an
instance-subelement hypothesis, but saved embedded geometry does not prove
Autodesk’s API geometry-summary comparison. Twenty-one door/window reference
IDs match flip hypotheses; reference matches never select a decoder recipe.
The fresh current export retains those same product/type identity results after the scene changes.

Every pinned upstream source module (158), CLI (19), binding/viewer file (28),
research example (203) and native fuzz entry point (11) is classified in the
[source inventory](rvt-upstream-capability-inventory.md). This is inventory
coverage, not complete behavior or release parity. Remaining limits include
unknown native formula/operator semantics and refreshed schedules, complete
sheet/tag/dimension interpretation, unsupported family/storage definitions,
full workset semantics, geodetic CRS/datum, real-model positive material-profile
ownership and general profiles/fillets, unknown saved graphics/view conditions,
and native wall/beam/layer cuts and selected parametric surfaces. Native RVT
editing and research remapping contracts remain outside this converter.
