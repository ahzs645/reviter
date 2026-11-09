# Reviter and pinned rvt-rs: implemented capabilities and model comparison

Reviter retains its native scene pipeline and adds source semantics and selected
upstream evidence. The integration extends the initial seven priorities with
native graph inspection, parameter/Extensible Storage inventories, source
metadata, CSV and cached HTML schedules, source dimensions, optional pipe reconstruction and
source-bound viewer links. The [continuation](rvt-upstream-continuation.md) now adds authored schedule definitions, exact inherited symbol values, partial native annotation previews, source spatial/site evidence, rotation-aware IFC maps, source-qualified structural profiles and v3 viewer state. A further continuation recovers checksummed large whole-page geometry records, adds circular detail previews and renders verified cached table layouts. It also fixes measured native-body/default-3D selection: the UNBC scene intentionally changes. The exhaustive [source inventory](rvt-upstream-capability-inventory.md)
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
  --baseline-dir /workspace/scratch/large-frame-prior-baseline \
  --output /workspace/scratch/head-to-head-large-whole-frames-priority.json \
  --timeout-ms 900000 --heap-mib 6144
node --experimental-strip-types --max-old-space-size=6144 \
  --import ./scripts/register-test-typescript.mjs \
  scripts/summarize-rvt-reader-comparison.ts \
  /workspace/scratch/head-to-head-large-whole-frames-priority.json \
  docs/generated/rvt-reader-comparison-final.json \
  /workspace/models/unbc-reference.ifc
```

The commands above reproduce both readers from scratch with the same local inputs. The private `large-frame-prior-baseline` directory contains authenticated same-source geometry snapshots from `2d42a9c`; its original external artifacts or an equivalent conversion of that commit are needed for the preservation comparison. The recorded updated
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
| Metadata and authored schedules | Safe metadata and generated CSVs plus stored schedule field/order/filter/sort definitions, formula trees and cached cell text | RAC/School/Snowdon recover 8/10/79 complete schedules with zero source-graph disagreement. 97 cached HTML tables preserve exact text, reciprocal merged cells and owned dimensions; native operator codes remain raw and rows/formula totals are not recalculated |
| Viewer exchange | V3 source/review-bound camera/category/section links add present-source selection, technical/xray mode and opt-in user markup; v1/v2 compatible | Bounded whitelist/4,096-character fragment, 16 annotations/128 total points/256 text characters. Wrong source/frame refused; 20 current v3 unit checks and all 12 desktop/mobile browser checks pass; selected markup is opt-in |
| Partial source drawings | Exact-view SVG previews of supported owned text/straight leaders/tag-head points/detail lines and qualified circles/arcs | Five prior SVGs and new actual circle/offset-arc witnesses are independently source-audited and opened in Chromium. Partial annotations only: no native tag glyphs/labels, evaluated dimensions, full visibility/crop/template or regenerated sheets |
| IFC maps and structural profiles | Optional verified translation/rotation maps and owned section-shape/profile/material writer | School emits eight profile usages/two I sections; structural Snowdon emits 427 usages/11 I sections. All 435 reopen with unchanged bodies/colors. Unknown profile materials remain `$`; general profiles/fillets are withheld |
| Native body/default-3D selection | Qualified own bodies suppress duplicate fallback; descriptor-owned GConditionCut 6–8 selects saved representations; verified large whole frames now enter bounded admission | Primary-first output preserves prior owners and recovers the measured UNBC wall/column bodies. Unknown predicates/formulas, remaining cuts and unproven physical completeness remain explicit |
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
source SHA-256 values agree. The [large-frame report](generated/rvt-native-large-frame-validation.json)
compares the current output with the previous continuation at `2d42a9c`:
recovered bound counts, origins and scene extents remain identical, while mesh
hashes, triangle counts and batch counts intentionally change. The original
RVT bytes are preserved.

| Model / release | Upstream scaffold products / represented | Current Reviter products / represented | Previous → current triangles | Previous → current mesh batches |
| --- | ---: | ---: | ---: | ---: |
| rac.rvt / 2025 | 550 / 478 | 578 / 475 | 195,167 → 209,174 | 97 → 94 |
| school.rvt / 2025 | 5,743 / 5,679 | 5,758 / 5,598 | 378,957 → 438,508 | 47 → 49 |
| snowdon.rvt / 2024 | 6,854 / 6,253 | 9,831 / 9,003 | 1,594,784 → 1,759,255 | 143 → 148 |
| unbc.rvt / 2027 | 0 / 0 | 40,259 / 36,434 | 858,388 → 898,491 | 32 → 31 |

The strict baseline check returns exit 1 for these twelve expected changed
fields; all twelve bounds/origin/extent checks pass. The source-based changes
are reviewed independently of the byte-preservation check. The earlier
[body-selection campaign](generated/rvt-native-geometry-four-models.json)
retains its own sixteen preserved fields and eight expected changes against
[`claude/unbc-candidate4-rules` at `4c13fd03e1ef994311f55e2312ef2590b898fb53`](https://github.com/ahzs645/reviter/tree/4c13fd03e1ef994311f55e2312ef2590b898fb53).
Its original triangle counts were 195,555 / 393,145 / 1,596,168 / 901,903.
The digest covers positions, indices, colors and element ownership buffers in
order; a changed digest also reflects grouping/order changes.

RAC, School and Snowdon retain all prior mesh owners and their identities.
School gains six represented owners; Snowdon adds bodies to nineteen existing
products and emits six additional products. The first large-record experiment
exhausted Snowdon's output admission budget and displaced thirteen trees and
several railings. Primary-first bounded admission now restores all thirteen
tree IDs with identical triangle counts/bounds and all seven affected railing
bodies. New raw candidates have a separate 64 MiB buffer; existing definition,
byte and output-triangle limits remain in force. Snowdon still reports output
truncation; successful conversion does not imply every source body was admitted.

For these three models, prior IFCs establish preservation observations.
Supplied GLBs contain Autodesk database/fragment IDs without a proved Revit
external-ID mapping, so no approximate name/shape/nearest-owner mapping is used.
UNBC has an actual paired Autodesk IFC and the separate owner measurements
below. Full models/reference/IFC artifacts remain outside Git; exact hashes
and execution scopes are retained in compact reports.

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
| school.rvt | 5,463 | 5,351 | 112 | 0 |
| snowdon.rvt | 5,839 | 5,574 | 265 | 0 |
| unbc.rvt | 0 | 0 | 0 | 0 |

In the current full-export comparison against the supplied UNBC Autodesk IFC, **35,117/35,117 unambiguous product GlobalIds match**, with zero mismatches. The comparison excludes 2,944 ambiguous product Tag groups; 266 tags are output-only and 126 reference-only.

**Current type identity matches 36,886/37,132 relationships (99.34%).** The remaining 246 mismatches are 224 column, 12 door and 10 window relationships. All 6,235 plate and 19,298 member relationships now match. There are 244 output-only and 931 reference-only typed tags. The reference uses IFC2x3 door/window styles while Reviter emits IFC4 types; unknown exporter instance/type variants remain explicit. Reference IDs are never imported as replacements.

The earlier report matched 10,426/37,132 type relationships and left 26,706 differences. The main cause was an incomplete generic element-table inventory: its 16-bit count was narrower than the complete 32-bit native table parsed for validated identity. The corrected original-symbol helper admits an extra owner only with a checksum-verified named FamilyInstance object and validated native identity, requires a complete verified GElement and named symbol, and publishes evidence only for actual source bounds/certified native mesh owners. It retains the 128 MiB checksum cap and leaves other decoder/geometry domains unchanged. That earlier semantic-only correction gained 26,460 matching type relationships while preserving its scene. The current saved-body selection changes are measured separately.

The separate [source-owner proof](generated/rvt-unbc-original-symbol-owner-proof.json) examined 3,666 UNBC pages with the identical source SHA. It retained 27,554 physical references from 30,301 before owner filtering, matched 25,620/25,620 admissible source-only type cases, left 1,931 flip cases and three missing-type cases unresolved, and did not hit the checksum cap. That stricter source-only witness is a different measurement from the final exported product/type relationships above. All actual class-pair counts and remaining mismatch examples are retained in the report.

The [further source audit](generated/rvt-native-identity-envelope-validation.json)
recovers 14 previously missing large-record original-symbol references. Embedded
geometry still prevents promoting them to Autodesk's API geometry-summary
recipe. Independently verified original-symbol envelopes now veto a flip when
they contradict the existing world-envelope candidate; neither envelope is
claimed equivalent to `GetOriginalGeometry` with exporter-selected options.
The three investigated window contradictions are withheld rather than assigned
the opposite flip from the reference. Historical-envelope checks reach their
separate 32 MiB checksum budget on UNBC; production warnings and
`stats.nativeOriginalSymbolDiagnostics` expose this partial coverage while
preserving earlier identity evidence.

Type comparisons follow each product's actual `IfcRelDefinesByType` and exact
decimal `Tag`; duplicate product/type relationships are excluded. Matching
native product IDs does not establish complete property or shape recovery.
Differences against upstream are not automatically Reviter defects: exporter
configuration and unresolved source type/flip/ownership evidence can differ.
The paired UNBC Autodesk IFC provides a separate observation, with unresolved
mismatches and ambiguity exclusions retained in the report.

## Validation and remaining scope

The completed repository suite passed **2,131 tests with three skips and zero
failures** (2,134 total). Current typecheck, all 36 changed/new script and test
sources under scoped lint, production and GitHub Pages builds passed, together
with four rendered-page checks and the Pages artifact check. A final reporting-only truncation flag refinement passed four focused FIFO checks, lint, typecheck and both builds after that whole-suite run; it changes diagnostics while preserving geometry, ordering and IFC identity. The independently
recorded native WASM/Rust/rebuild results retain their earlier execution
scope because those binaries and native harnesses remain unchanged. A fresh seeded malformed-input CLI campaign passes all 2,560 target runs across 256 cases after the priority correction; four positive FIFO regressions separately exercise queue, cache and output limits.

Actual browser checks recovered Mechanical's 150 ports, 73 joins and five
systems; CSV/source-JSON downloads worked. RAC camera capture/restore, wrong
source-hash refusal, initial-link deferral, matching-model restoration and
fragment/query handling passed with zero browser errors. Desktop/mobile layout
checks and final export-control results are recorded in the PR/integration
overview. These earlier runtime checks precede v3 and the latest body-selection changes. The current [v3 browser report](generated/rvt-viewpoint-v3-browser-validation.json) passes all 12 desktop/mobile checks with zero errors, including selection, display mode, optional markup and exactly restored canvas pixels. The [source export browser report](generated/rvt-native-inventory-browser-validation.json) verifies records/definitions/schedules/organization CSVs, source JSON, True North IFC, a selected-view annotation SVG and mobile controls/downloads with zero errors or horizontal overflow. The [new production-app browser report](generated/rvt-native-source-continuation-browser-validation.json) additionally verifies eight loaded RAC schedules, desktop/mobile HTML downloads and exact-source circular detail SVG. All 97 actual cached schedule artifacts and one adversarial text artifact independently reopen without page errors or network requests; nine corrupted-layout cases explicitly omit their affected sections. These are stored-source previews, not refreshed schedules or full drawings.

## Paired geometric evidence and remaining limits

The earlier body-selection audit joined 36,048 unique decimal Tag/GlobalId pairs
without coordinate fitting. Surface-area agreement within 1% improved from
9/311 to 249/311 columns and 145/202 to 198/202 railings; 357 owner area errors
improved and none worsened beyond relative 1e-5. Four small corner residuals
increased but remained below 0.00311 ft. Two source-trimmed column witnesses have
bidirectional sampled distances below 0.000014 ft. These are finite samples,
not continuous Hausdorff guarantees, and diagnostic closed-shell volume is not
validated non-overlapping material-union volume. The zero-worsening statement refers to significant **surface-area errors**, not
material/color mismatches. Separate optional source-organization exports reopen
six actual IFCs in web-ifc and IFC-Lite with zero measured source-property or
world-triangle/material disagreements (RAC 461 owners, School 5,507 and Mechanical
83); map exports retain their separately scoped color/placement checks.

The current large-frame continuation is measured against commit `2d42a9c`,
separately from that earlier selection audit. Across the same 36,048 paired
owners, 82 surface-area errors improve and eight slab area errors worsen; the
largest current error among those slabs is 0.0679931% of reference area. No owner-bound error worsens
by more than 0.0001 ft. These area comparisons do not establish local surface
agreement. Eleven separately checked material witnesses retain their prior
assignment state: the eight slabs and one column still lack materials that
exist in the reference IFC. This is an unresolved assignment gap, not proof of
complete material parity.

Missed complete large records caused the earlier residuals for wall 1185924
(23.30 ft) and column 2236110 (0.4867 ft / 16.54% area error). Their recovered
source bodies now have maximum bidirectional sampled distances of
0.00000394 ft and 0.00001199 ft respectively. These finite samples and the
82/eight area-error results are recorded in the
[current large-frame report](generated/rvt-native-large-frame-validation.json).
Wall 801614 still retains an extra portion with an approximately 0.8002-ft
sampled discrepancy. No reference surface or guessed
record-box cut is used as a repair. The [selection contract](rvt-native-geometry-selection.md)
retains unknown view filters, family formulas, shared-occurrence ambiguity and
exact admission/output-budget gates.

The [Autodesk exporter contract](revit-ifc-exporter-identity-contract.md) and
[246-case triage](generated/rvt-ifc-type-recipe-triage.json) document why the
remaining type recipes are withheld. All 224 column reference IDs match an
instance-subelement hypothesis, but saved embedded geometry does not prove
Autodesk’s API geometry-summary comparison. Twenty-one door/window reference
IDs match flip hypotheses; reference matches never select a decoder recipe.
The fresh current export retains the paired UNBC product/type match counts after these scene changes. The [four-model envelope census](generated/rvt-native-type-envelope-census.json) records 38 conservative type-recipe vetoes: 18 School, 17 Snowdon and three UNBC. The three UNBC cases already mismatched the reference; no previously matching UNBC relationship is withheld. School and Snowdon have no paired IFC identity ground truth. Earlier Snowdon comparison prose overstated matches: the archived machine report has 5,558/5,823 matches and 265 differences; the current output adds 16 matching stair-type relationships, giving 5,574/5,839 with the same 265 differences.

Every pinned upstream source module (158), CLI (19), binding/viewer file (28),
research example (203) and native fuzz entry point (11) is classified in the
[source inventory](rvt-upstream-capability-inventory.md). This is inventory
coverage, not complete behavior or release parity. Remaining limits include
unknown native formula/operator semantics and refreshed schedules, complete
sheet/tag/dimension interpretation, unsupported family/storage definitions,
full workset semantics, geodetic CRS/datum, unresolved material assignments and general profiles/fillets, unknown saved graphics/view conditions,
and native wall/beam/layer cuts and selected parametric surfaces. Snowdon's
changed stair flights agree with source run elevations; three further stair
symbols and two appliances replay their complete stored BReps, with no missing
nested references found. Their physical equivalence remains unproven without
a paired IFC; open/nonmanifold diagnostics remain visible. Source completeness
and contained bounds alone do not establish physical completeness. Native RVT
editing and research remapping contracts remain outside this converter.
