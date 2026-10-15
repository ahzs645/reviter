# Further source-backed rvt-rs integrations

This continuation builds on `codex/rvt-semantic-integration` and pinned upstream
`1c3d337dbd2a6810e9dfad68fe99857843d67387`. It extends bounded source inventories,
adds partial drawing previews, cached schedule HTML and optional IFC semantics,
and extends checksum-verified native-body and original-symbol recovery. The
UNBC scene intentionally changes; the earlier
unchanged-buffer campaign is prior validation, not a claim about this revision.
The vanilla upstream baseline remains separately built and hash-verified.

| Addition | Measured source/export result | Boundary |
| --- | --- | --- |
| Typed native records | Earlier bounded RAC/School/Snowdon selections projected 211/291/2,283 records and 3,195/4,620/34,553 fields, with matching stored fields/pointers. New adapters add owned annotation, schedule and spatial paths. | Serialized evidence and explicit raw fallbacks; not every Revit typed class or evaluated API field. Snowdon's earlier selection retained 20 graph fallbacks. |
| Parameter definitions and inherited symbol values | Prior inventories retain 774 RAC definitions/543 accepted slots and 1,604 Snowdon definitions/32 slots. RAC now resolves 90 symbol values for 15 instances with zero source-owner/value disagreements. | Exact complete instance→symbol→family and definition/binding proof; conflicting present slots block inheritance. Family defaults, unsupported built-ins, unknown storage and formula evaluation stay unresolved. Raw slots remain separate. |
| Authored schedules | RAC eight schedules/33 fields/246 cached cells; School ten/44/47; Snowdon 79/383/3,274, all with zero projected source-graph disagreements. Four Snowdon calculated fields retain expression trees. | Stored headings/cells and authored field/filter/sort/formula structure. Cached HTML now preserves qualified row/column dimensions, section visibility and reciprocal merges; it does not refresh rows, execute grouping/filter/formulas/totals or recreate fonts/pagination. Thirteen Snowdon graphs remain unresolved; UNBC 2027 is outside the qualified schedule contract. |
| Complete source table and type diagnosis | Complete schema-validated source table remains distinct from scene admission. Bounded checksum/FIFO recovery adds 14 large-column original-symbol fields. The final retained-evidence census records 38 source-envelope contradiction vetoes: RAC 0, School 18, Snowdon 17, UNBC 3; no previously matching upstream type relationship is lost. UNBC product IDs match 35,117/35,117 and type relationships 36,886/37,132. | The 246 UNBC type recipes remain unproved. Native envelopes do not establish Autodesk GetOriginalGeometry(options)/UsesInstanceGeometry equivalence. The separate 32 MiB historical-symbol envelope budget is reached on UNBC while legacy identity collection remains uncapped, so envelope metadata remains partial. |
| Partial native drawing previews | Five source-audited views render owned text, straight leaders, tag-head points and finite detail curves; RAC view 958303 supplies three source detail lines. Exact native tags/basis/intervals now add full circles and bounded arcs; real RAC owner 941493 supplies a circle with independently sampled Chromium radial error below 0.000003126 ft. Five earlier SVGs retain their own browser audit. | Every preview is partial. No regenerated sheets, native tag glyphs/labels, evaluated dimensions, view visibility/crop/template equivalence or viewport-to-sheet layout. Snowdon retains 2,048 annotations and reports 595 omitted by budget. |
| Source spatial and project organization | Exact same-source header categories distinguish School's 25 Areas, Snowdon's 101 Areas and Mechanical's nine MEP Spaces. Explicit active-site transforms have survey-point direction witnesses; RAC's 37° and Snowdon's 26° rotations agree within 2.8e-14/6.6e-11 ft. | RoomElem class/name/area scheme cannot classify an element. Five Snowdon room graphs remain raw. Workset visibility is not a named/editable workset registry. No inferred EPSG/datum, evaluated quantities or routing certification. |
| Optional IFC source organization | Exact source inventories can emit Areas as nonhierarchical IfcSpatialZones, MEP Spaces as identity-only IfcSpaces, revision/workset source metadata and proved true north/site metadata. | No fabricated boundaries, placement or quantities. Canonical body placements stay unchanged; optional source metadata is not map conversion/geodetic certification. Six ordinary/expanded IFCs reopen in web-ifc and IFC-Lite: RAC preserves 461 geometry owners/37° north, School 5,507 owners plus 25 Areas, Mechanical 83 owners plus nine MEP Spaces/nine exact source parents; zero property or reopened triangle/material disagreements. |
| Rotation-aware IFC maps | Current optional exports have School 79 maps/252 products including four rotation groups; maximum persisted coordinate difference 9.73e-11 m and Float32 preview roundoff 1.907 μm. Official structural Snowdon has 142 maps/463 products, persisted difference below 9.50e-11 m. Zero measured triangle/material disagreements in either audit. | Native type/geometry identity, proper rigid source basis and full ordered geometry/topology/material agreement required. Scaled, reflected, approximate and nonidentical bodies remain ordinary tessellation. Default off. |
| Structural material-profile writer | Current real-model optional exports emit two distinct profiles/eight usages for School and 11 profiles/427 usages for structural Snowdon. Independent reader checks compare all 435 occurrence/profile joins and preserve exact body coordinates/styles against profile-disabled exports; IFC-Lite also parses the complete IFCs. | Family-wide StructuralSectionShape classification requires an exact native symbol→family edge; all six dimensions remain symbol-owned. Present invalid/conflicting symbol/family values withhold classification. Unknown material remains explicit `$` with reader warnings retained. General profiles, fillets and reconstructed profile bodies remain unresolved. |
| Native body/default-3D selection | Current four-model campaign admits 478 checksum-verified large whole frames and independently reopens eight IFCs. Twelve bounds/origin/extents fields remain unchanged; twelve mesh/hash/triangle fields intentionally change. Across the same 36,048 paired UNBC owner identities, 82 area errors improve and eight worsen; maximum current relative error among those eight slabs is 0.0679931%. Wall 1185924 and column 2236110 sampled discrepancies fall below 3.94e-6/1.199e-5 ft. | A 64 MiB raw buffer defers supplemental compilation until ordinary/crossing definitions; existing own definitions and final output priority are preserved. Snowdon still reaches the unchanged output cap. No reference geometry enters conversion, and finite samples do not prove continuous surface equivalence. Wall 801614, unknown conditions and general cut/join semantics remain unresolved. |
| Viewpoint v3 | Implementation adds present-source element selection, technical/xray display and explicitly opt-in review markup to source-bound camera/category/section state; v1/v2 imports remain compatible. | 4,096-character fragment, 16 annotations, 128 total points and 256-character text limits. User markup is not native Revit annotation. Twenty current v3 unit checks pass. All 12 current desktop/mobile v3 browser checks pass, including optional markup, selection/display mode and identical restored canvas pixels. The earlier nine-check v2 report remains historical. |

The Exports panel provides source record, definition, authored-schedule and
organization CSVs, enriched source JSON, selected-view partial annotation SVGs,
and source organization IFC controls. It now loads a source schedule selector
and downloads bounded cached HTML, with source-hidden sections omitted unless
explicitly included. Dedicated CLI paths support larger targeted selections;
a broad default query is not a complete source-document inventory. Empty blocked
inventories preserve status rows, and missing/contradictory owner evidence is
not silently replaced.

The [cached schedule HTML audit](native-cached-schedule-html.md) independently
opens all **97 real schedules plus one adversarial-text fixture** in Chromium,
checking raw-graph text, owner IDs, dimensions, visibility and merge spans. Nine
mutated real-layout cases omit the invalid section explicitly. This proves
cached layout projection, not fresh Revit evaluation or print fidelity.

```sh
npm run inspect:rvt-evidence -- /path/model.rvt --out evidence.json \
  --records-csv source-records.csv --definitions-csv definitions.csv
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-schedules.ts /path/model.rvt --out schedules.json --csv schedules.csv \
  --html cached-schedule.html --schedule-id SOURCE_ID
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

## Final validation and measured campaign

The final repository suite passes **2,131 tests, three skips, zero failures**
(2,134 total). Typecheck, scoped changed-source lint, production and Pages builds,
and four rendered-page checks pass. A subsequent reporting-only truncation flag
passed four focused geometry tests plus typecheck/lint and both builds; it changes
neither geometry/order nor IFC identities. The freshly rerun seeded TypeScript
malformed-input campaign completes 256 cases/2,560 target runs with zero failures.
The unchanged native WASM/Rust checks and vanilla rebuild retain their separately
recorded earlier executions. Repository-wide lint is not claimed clean. Exact
validation scopes are in the [final checks](generated/rvt-integration-checks-final.json).

The [large-frame campaign](generated/rvt-native-large-frame-validation.json)
completes four fresh Reviter conversions, four hash/settings-verified pristine
upstream reuses and eight independent IFC reopens. It admits 478 large frames:
RAC 30, School 23, Snowdon 316 and UNBC 109. All prior product GlobalIds/Tags
remain; School adds six products and Snowdon adds six. Bounds counts, origins
and extents pass 12 preservation checks; mesh counts, triangles and geometry
hashes intentionally change in 12 checks. The strict unchanged-baseline command
therefore exits 1, despite completed conversion/reopen: it is not a passing
unchanged-geometry claim.

| Model | Prior triangles/batches (`2d42a9c`) | Current triangles/batches |
| --- | --- | --- |
| RAC | 195,167 / 97 | 209,174 / 94 |
| School | 378,957 / 47 | 438,508 / 49 |
| Snowdon | 1,594,784 / 143 | 1,759,255 / 148 |
| UNBC | 858,388 / 32 | 898,491 / 31 |

The priority correction preserves ordinary/split bodies before supplemental
large definitions and protects original owners under output pressure. It restores
13 planting owners and seven railings displaced by the rejected intermediate
Snowdon run. Snowdon still reaches the unchanged output cap; zero checksum,
buffer and deferred-definition skips do not imply complete scene recovery.

The [final type-envelope census](generated/rvt-native-type-envelope-census.json)
retains all 38 contradiction vetoes and exact source/output hashes. No previously
matching upstream type relationship is lost. School adds six matching proxy
relationships and Snowdon 16 matching stair relationships. The committed machine
baseline for Snowdon is 5,558/5,823 matches, now 5,574/5,839 with 265 mismatches;
an older prose table's 5,636/187 values were incorrect. Paired UNBC identity
agreement remains 35,117/35,117 product IDs and 36,886/37,132 type relationships.
Its three envelope vetoes were already paired-reference mismatches; those type
recipes remain withheld rather than selected from reference identities.

The new scoped reports independently verify 97 cached schedule HTMLs, one
adversarial-text artifact, nine invalid-layout refusals, one actual RAC source
circle and 435 real material-profile usages. [V3 browser evidence](generated/rvt-viewpoint-v3-browser-validation.json)
passes 12 desktop/mobile checks including opt-in markup, selection/display,
matching-file reload and identical restored canvas pixels. The [source export
report](generated/rvt-native-inventory-browser-validation.json) covers stored CSVs,
source JSON, True North IFC, annotation SVG and mobile controls. The [production
source-continuation report](generated/rvt-native-source-continuation-browser-validation.json)
separately verifies three cached-HTML downloads with identical desktop/mobile
content and source circle 941493 in the downloaded SVG, with zero browser errors,
remote artifact requests or mobile overflow. Selected schedule 959491 has no
hidden section, so its inclusion option leaves two sections unchanged; actual
hidden-section fidelity is proved by the separate 97-schedule corpus audit.

Earlier body-selection results (357 improved owner area errors, zero significant
area-error worsening and 16 preserved/eight changed scene fields) remain historical
in their original reports. They do not describe the newer large-frame campaign.

The [additional pristine WASM geometry-policy audit](rvt-upstream-geometry-mode-comparison.md)
also completes all four inputs and eight independent reader reopens. It reports
native bounding-box-body counters and finite tessellation separately from
accuracy. WASM applies the requested content policy without calling the core
quality validator; CLI/Python callers invoke it. UNBC’s sparse API result fails
the independently checked geometry contract, while the first three pass.

The current paired UNBC audit retains the same **36,048 exact Tag/GlobalId
owner pairs**, with 82 improved and eight worsened area errors beyond relative
1e-5. Those eight slabs have maximum current relative area error **0.0679931%**;
none has a bounds-error worsening above 0.0001 ft. Local slab surfaces were not
sampled, so small aggregate error is not a bound on local cuts. Selected wall
1185924 improves from 23.30 ft to **3.94e-6 ft** maximum bidirectional sampled
distance; column 2236110 improves from 0.4867 ft to **1.199e-5 ft**. Finite samples
are not continuous Hausdorff bounds. Wall 801614 still retains a **0.8002203-ft**
extra portion; no guessed cut or reference-based repair is admitted. Eleven
separately checked product-material witnesses preserve assignments, while nine
still lack reference material associations. These checks do not establish global
surface-style/color or material-layer thickness agreement.

Detailed source contracts and scoped proof:

- [Native record inventory](native-record-inventory.md) and [authored schedules/inherited values](native-authored-schedules.md)
- [Cached schedule HTML](native-cached-schedule-html.md) and [actual layout browser checks](generated/rvt-native-cached-schedule-html-browser-validation.json)
- [Parameter definitions and values](native-parameter-inventory.md)
- [Complete element table](full-elem-table-inventory-audit.json)
- [Deferred symbol fields](native-ifc-type-field-evidence.md) and [Autodesk exporter identity contract](revit-ifc-exporter-identity-contract.md)
- [Partial source drawings](native-source-drawings.md) and [spatial organization](native-spatial-organization.md)
- [Rotation-aware maps and material profiles](native-ifc-maps-profiles.md)
- [Native body/default-3D selection](rvt-native-geometry-selection.md)
- [Viewpoint links](viewpoint-links.md) and [reader comparison](rvt-upstream-comparison.md)

Remaining work needs explicit source/reference semantics: unresolved IFC type
recipes (246 in the current paired UNBC comparison, with source-envelope vetoes reported separately); native wall joins/cuts and selected parametric surfaces; complete
sheet/tag/dimension interpretation; recalculated schedules and unknown formula
codes; unsupported family/storage definitions; general authored profiles, fillets
and unsupported section classifications; geodetic CRS/datum; unknown saved view
filters and family formulas. Native RVT editing, Python packaging and research
remapping contracts remain outside this browser converter integration.
