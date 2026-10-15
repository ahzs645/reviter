# Further source-backed rvt-rs integrations

This continuation builds on `codex/rvt-semantic-integration` and pinned upstream
`1c3d337dbd2a6810e9dfad68fe99857843d67387`. It extends bounded source inventories,
adds partial drawing previews and optional IFC semantics, and fixes two measured
native-body selection errors. The UNBC scene intentionally changes; the earlier
unchanged-buffer campaign is prior validation, not a claim about this revision.
The vanilla upstream baseline remains separately built and hash-verified.

| Addition | Measured source/export result | Boundary |
| --- | --- | --- |
| Typed native records | Earlier bounded RAC/School/Snowdon selections projected 211/291/2,283 records and 3,195/4,620/34,553 fields, with matching stored fields/pointers. New adapters add owned annotation, schedule and spatial paths. | Serialized evidence and explicit raw fallbacks; not every Revit typed class or evaluated API field. Snowdon's earlier selection retained 20 graph fallbacks. |
| Parameter definitions and inherited symbol values | Prior inventories retain 774 RAC definitions/543 accepted slots and 1,604 Snowdon definitions/32 slots. RAC now resolves 90 symbol values for 15 instances with zero source-owner/value disagreements. | Exact complete instance→symbol→family and definition/binding proof; conflicting present slots block inheritance. Family defaults, unsupported built-ins, unknown storage and formula evaluation stay unresolved. Raw slots remain separate. |
| Authored schedules | RAC eight schedules/33 fields/246 cached cells; School ten/44/47; Snowdon 79/383/3,274, all with zero projected source-graph disagreements. Four Snowdon calculated fields retain expression trees. | Stored headings/cells and authored field/filter/sort/formula structure, not refreshed rows, grouping/filter execution, formula totals or native layout. Thirteen Snowdon graphs remain unresolved; UNBC 2027 is outside the qualified schedule contract. |
| Complete source table and type diagnosis | Earlier exact upstream declared-ID equality on all four models; UNBC 74,438 rows and Snowdon 84 source aliases. Deferred FIFO reading recovered 201 additional physical-owner symbol references. A complete 246-case exporter-recipe report retains source/IFC digests and withholding reasons. | Complete source table is distinct from scene admission. Embedded-symbol pointers and reference-matching hypotheses do not prove Autodesk instance-geometry summaries or unknown door/window flips. The 246 recipes remain withheld. |
| Partial native drawing previews | Five source-audited views render owned text, straight leaders, tag-head points and finite detail curves; RAC view 958303 supplies three source detail lines. Chromium independently opens all five SVGs. | Every preview is partial. No regenerated sheets, native tag glyphs/labels, evaluated dimensions, view visibility/crop/template equivalence or viewport-to-sheet layout. Snowdon retains 2,048 annotations and reports 595 omitted by budget. |
| Source spatial and project organization | Exact same-source header categories distinguish School's 25 Areas, Snowdon's 101 Areas and Mechanical's nine MEP Spaces. Explicit active-site transforms have survey-point direction witnesses; RAC's 37° and Snowdon's 26° rotations agree within 2.8e-14/6.6e-11 ft. | RoomElem class/name/area scheme cannot classify an element. Five Snowdon room graphs remain raw. Workset visibility is not a named/editable workset registry. No inferred EPSG/datum, evaluated quantities or routing certification. |
| Optional IFC source organization | Exact source inventories can emit Areas as nonhierarchical IfcSpatialZones, MEP Spaces as identity-only IfcSpaces, revision/workset source metadata and proved true north/site metadata. | No fabricated boundaries, placement or quantities. Canonical body placements stay unchanged; optional source metadata is not map conversion/geodetic certification. Six ordinary/expanded IFCs reopen in web-ifc and IFC-Lite: RAC preserves 461 geometry owners/37° north, School 5,507 owners plus 25 Areas, Mechanical 83 owners plus nine MEP Spaces/nine exact source parents; zero property or reopened triangle/material disagreements. |
| Rotation-aware IFC maps | School 78 maps/250 owned products, including four rotation groups; maximum persisted world-coordinate difference 9.73e-11 m and Float32 preview roundoff 1.907 μm. Official Snowdon structural sample: 141 maps/460 products, zero measured triangle/material disagreements. | Native type/geometry identity, proper rigid source basis and full ordered geometry/topology/material agreement required. Scaled, reflected, approximate and nonidentical bodies remain ordinary tessellation. Default off. |
| Structural material-profile writer | Owned-source fixtures independently reopen exact section/profile/material relations. School retains 13 candidates/three proved shape codes; structural Snowdon 287 complete six-metric candidates. **Actual audited models emit zero profiles.** | Exact owned Section Shape enum and eligible occurrence/category/type/material joins required. School lacks eligible occurrence joins; structural Snowdon lacks proved shape codes. Symmetric dimensions never infer I shape; fillets/general profiles remain unresolved. |
| Native body/default-3D selection | UNBC owner audit measures 357 improved surface-area errors and zero worsening beyond relative 1e-5 across 36,048 identical Tag/GlobalId pairs. Triangles change from 901,903 to 858,388, retaining 32 batches. | A qualified own body suppresses its duplicate symbol fallback; only proved descriptor-owned GConditionCut comparisons 6–8 are applied. No reference geometry enters conversion. Unknown view/formula conditions and native wall residuals remain unresolved. |
| Viewpoint v3 | Implementation adds present-source element selection, technical/xray display and explicitly opt-in review markup to source-bound camera/category/section state; v1/v2 imports remain compatible. | 4,096-character fragment, 16 annotations, 128 total points and 256-character text limits. User markup is not native Revit annotation. Twenty current v3 unit checks pass. All 12 current desktop/mobile v3 browser checks pass, including optional markup, selection/display mode and identical restored canvas pixels. The earlier nine-check v2 report remains historical. |

The Exports panel retains **Source records CSV**, **Parameter definitions CSV**
and enriched **Source evidence JSON**. The JSON now includes schedule and spatial
inventories from its selected graphs. Source schedules, drawing previews and
larger targeted selections have dedicated CLI paths; a broad default query is
not a complete source-document inventory. Empty blocked inventories preserve
status rows, and missing/contradictory owner evidence is not silently replaced.

```sh
npm run inspect:rvt-evidence -- /path/model.rvt --out evidence.json \
  --records-csv source-records.csv --definitions-csv definitions.csv
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-schedules.ts /path/model.rvt --out schedules.json --csv schedules.csv
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/export-native-drawing.ts /path/model.rvt --view-id 245424 \
  --out annotations.svg --report drawing.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-spatial-organization.ts /path/model.rvt \
  --out spatial.json --csv spatial.csv --summary spatial-validation.json
```

The WASM input/inflation/graph/output budgets and separately declared TypeScript
projection/CSV budgets all apply. They bound work and retained output, not total
RSS. Qualified schedule/parameter layouts are 2024–2026; spatial categories/site
queries and drawing/record fields retain their own explicit release gates.
Private models, full graphs and generated IFC/SVG/CSV outputs remain outside Git;
compact source-hash-bound reports are retained in `docs/generated`.

## Current validation and prior results

The current final repository suite passes **2,097 tests, three skips, zero
failures** (2,100 total). Current typecheck, changed-source lint, production and
GitHub Pages builds and four rendered-page checks pass. Subsequent source CSV
coordinate/scope refinements pass 14 focused checks and eight updated coordinate/CSV unit checks.
Focused drawing/v3/source-organization contracts retain their own scopes; six
actual source-organization IFCs reopen in two readers. The [current v3 browser report](generated/rvt-viewpoint-v3-browser-validation.json) passes all 12 desktop/mobile checks, including selection/display state, optional markup, matching-file reload and exactly restored canvas pixels. The [source export browser report](generated/rvt-native-inventory-browser-validation.json) verifies records, definitions, stored schedules and organization CSVs, source JSON, True North IFC, selected-view annotation SVG and mobile controls/downloads. Both report zero browser errors and zero mobile horizontal overflow; earlier v2 restoration remains prior evidence.

Four fresh model conversions and eight population reopens are complete. Across
all four models, mesh counts, recovered bounds counts, origins and extents are
preserved (16 checks). Digests and triangle counts intentionally change (eight
checks): RAC 195,555→195,167; School 393,145→378,957; Snowdon
1,596,168→1,594,784; UNBC 901,903→858,388. Exact-owner/identity coverage is
unchanged. The [current geometry report](generated/rvt-native-geometry-four-models.json)
separates three earlier-Reviter preservation comparisons from the actual UNBC
Autodesk accuracy diagnostic. Product GlobalIds remain 35,117/35,117 matched and
type relationships 36,886/37,132, with the same 246 recipes withheld.

The [additional pristine WASM geometry-policy audit](rvt-upstream-geometry-mode-comparison.md)
also completes all four inputs and eight independent reader reopens. It reports
native bounding-box-body counters and finite tessellation separately from
accuracy. WASM applies the requested content policy without calling the core
quality validator; CLI/Python callers invoke it. UNBC’s sparse API result fails
the independently checked geometry contract, while the first three pass.

The [owner geometry audit](generated/rvt-owner-geometry-audit.json) intentionally
changes UNBC's geometry digest. Surface-area agreement within 1% improves from
9/311 to 249/311 columns and 145/202 to 198/202 railings. Four curved-column corner
residuals increase but remain below 0.00311 ft; two source-trimmed columns have
bidirectional sampled distances below 0.000014 ft. These finite samples are not
continuous Hausdorff bounds. Wall 1185924 still has a 23.30-ft sampled discrepancy
despite similar bounds; wall 801614 retains a 0.8003-ft extra portion. No guessed
wall cut or reference-based repair is admitted. The final owner audit also retains column 2236110’s 16.54% area error and 0.4867-ft sampled discrepancy. “Zero worsening” here means significant **surface-area error** worsening, not a material/color counter. Source-organization and map audits separately verify their own reopened material/geometry preservation; they do not establish a global palette claim for the body-selection change.

Detailed source contracts and scoped proof:

- [Native record inventory](native-record-inventory.md) and [authored schedules/inherited values](native-authored-schedules.md)
- [Parameter definitions and values](native-parameter-inventory.md)
- [Complete element table](full-elem-table-inventory-audit.json)
- [Deferred symbol fields](native-ifc-type-field-evidence.md) and [Autodesk exporter identity contract](revit-ifc-exporter-identity-contract.md)
- [Partial source drawings](native-source-drawings.md) and [spatial organization](native-spatial-organization.md)
- [Rotation-aware maps and material profiles](native-ifc-maps-profiles.md)
- [Native body/default-3D selection](rvt-native-geometry-selection.md)
- [Viewpoint links](viewpoint-links.md) and [reader comparison](rvt-upstream-comparison.md)

Remaining work needs explicit source/reference semantics: the 246 unresolved IFC
type recipes; native wall joins/cuts and selected parametric surfaces; complete
sheet/tag/dimension interpretation; recalculated schedules and unknown formula
codes; unsupported family/storage definitions; general authored profiles and
real-model positive profile ownership; geodetic CRS/datum; unknown saved view
filters and family formulas. Native RVT editing, Python packaging and research
remapping contracts remain outside this browser converter integration.
