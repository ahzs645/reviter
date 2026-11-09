# Stored native schedules and type parameter resolution

Reviter exports source-authored schedule definitions and owned stored table-cell text through `lib/reviter/native-schedule-inventory.ts`. This complements the existing generated element/room CSVs: it preserves the original schedule's field IDs and ordering, hidden fields, parameter IDs, headings, widths, formatting, sort/group codes, filter slots and formula-expression trees.

The binary contract is the same file-local structural schema and pinned rvt-rs graph decoder at `1c3d337dbd2a6810e9dfad68fe99857843d67387`. Complete source graphs require exact source/schema SHA-256, qualified Revit 2024–2026, a restated root element ID, source body bounds and every owned pointer's matching edge, token, class and byte range. Fields join to their stored field IDs by the aligned schema ID/pointer arrays. Captions never identify parameters. Filters and sorting must reference successfully projected field IDs. Duplicate owners, pointers or cell coordinates remain unresolved. Empty cached cell text is preserved as empty text.

The adapter projects `DBViewSchedule → ScheduleSchema → ScheduleField/ScheduleSortField/ScheduleFilter` and `DBViewSchedule → ScheduleData → ScheduleSectionData → TableRowCellData → TableCellData`. It retains signed `storedCoverOffsets`. A separate [cached schedule HTML exporter](native-cached-schedule-html.md) derives rectangular spans only when every covered cell proves the same reciprocal in-bounds rectangle and no non-anchor text would be lost. Public Revit API enum numbers are not assumed to equal the private native serialization codes. Source/type/filter/sort/operator/function/storage codes remain named numeric evidence. All filter storage slots are retained without selecting a slot from an unverified storage-code mapping.

Formula trees retain source class/object indices, numeric literals with their specification IDs, field-ID references, native operator/function codes and proven child pointers. Unsupported expression classes, cycles, ambiguous edges and depth/node overruns remain partial. Neither arithmetic operators nor native function code `20` are executed: the reader supplies no measured correspondence between these private codes and the public Revit formula language. Executing a guessed mapping would fabricate evaluated values. Expressions keep `serialized-not-evaluated` semantics.

Stored cells include authored titles, headings and other cached table text, including empty cells. They do not establish refreshed body values, element row membership, linked-model quantities, embedded-schedule definitions, sorting/filter execution, formula totals or a Revit layout. Owned row/column dimensions and visibility also support a qualified cached HTML table; this does not regenerate body rows. The original complete graphs remain available separately. CSV exports use distinct schedule, field, sort, filter, stored-section and stored-cell rows and neutralize spreadsheet formulas in authored text.

## Public-source research

Autodesk's [Working with ViewSchedule guide](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Views/View_Types/TableView/ViewSchedule/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Views_View_Types_TableView_ViewSchedule_Working_with_ViewSchedule_html.html), retrieved 14 October 2026, establishes that a schedule definition owns fields, field order, filtering, sorting/grouping, hidden columns, formatting and optional embedded definitions. It explicitly distinguishes calculated Formula/Percentage fields and view-dependent values from ordinary instance/type parameters. Its public examples do not define the native binary enum encodings. This supports preserving authored definitions while keeping evaluated rows and private numeric codes unresolved.

Autodesk's [Parameter guide](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Parameters/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Parameters_Parameter_html.html), retrieved 14 October 2026, distinguishes storage types, definitions, internal numerical values and formatted display strings. Negative ElementIds can represent non-element choices. Reviter retains exact stored values and source specifications; a display-unit identifier does not numerically convert a value or evaluate a formula.

## Same-model validation

Each audit validates the exact model digest and independently reopens every projected field/cell/filter/sort object in the stored graph. Durable reports are in `docs/generated/rvt-native-authored-schedules-{rac,school,snowdon}.json`.

| Model | Complete schedules | Fields | Sort/group entries | Filters | Stored cells | Nonempty stored text | Source disagreements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RAC 2025 | 8 | 33 | 9 | 1 | 246 | 33 | 0 |
| School 2025 | 10 | 44 | 8 | 1 | 47 | 6 | 0 |
| Snowdon 2024 | 79 | 383 | 102 | 7 | 3,274 | 1,051 | 0 |

RAC and School were freshly scanned with `selectedClasses: ["DBViewSchedule"]`. Snowdon's prior exact-byte class-selected evidence retained 92 records; 79 complete graphs produce the table above and 13 unsupported graphs remain unresolved. Four Snowdon calculated fields retain expression trees. UNBC 2027 is outside the qualified graph contract. These are source-graph agreement checks, not independent Revit API evaluations or visual comparisons of recalculated schedule bodies.

Limits include 4,096 retained records, 4,096 graph objects, 1,024 fields/columns per schedule, 10,000 cells per schedule, 256 expression nodes per schedule, depth 24, 16,384 characters per authored string and 256 diagnostics. Native graph/stream/inflation/output limits also apply. The direct CLI requests at most 512 schedule records; truncation remains visible through the evidence/inventory status.

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/inspect-native-schedules.ts model.rvt --out schedules.json --csv schedules.csv --evidence-out source-evidence.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/audit-native-schedules.ts model.rvt --evidence source-evidence.json --out audit.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs --test tests/native-schedule-inventory.test.ts tests/native-parameter-inventory.test.ts
```

`--evidence source-evidence.json` can reuse a report only when its source digest matches the supplied RVT. Full source graphs, model bytes and CSV inventories stay outside Git.

## Exact inherited symbol values

The parameter inventory separately exposes `ownerRelations` and `resolvedValues`; its original `values` remain present-owner serialized slots. A resolved value identifies its value owner, original value index, resolution kind and retained relationship witnesses. Scalar relationship field byte offsets are explicitly null because the graph bridge supplies object bounds and pointer offsets, not scalar field offsets.

An inherited value requires a unique complete retained FamilyInstance with `m_masterSymbolId`, the exact retained FamilySymbol with `m_familyId`, the exact retained Family root, agreement with the native symbol/family registry and an accepted symbol value. Type semantics require either a matching family definition with a stored false instance flag, or a backlink-validated symbol category binding matching the native family category. True instance flags or instance definitions prohibit inheritance. A present instance value takes precedence; a conflicting or malformed present slot blocks fallback. Missing families/symbols, contradictory links, mismatched categories and missing binding backlinks cannot supply values. Family default values are never substituted for a missing symbol value. A formula-bearing type slot retains its stored result and expression pointer without recalculation.

The bounded RAC evidence resolves **90 serialized symbol values across 15 instances**, with zero retained-owner/value disagreements, alongside the unchanged 543 accepted raw slots. `docs/generated/rvt-native-parameter-inheritance-rac.json` records these checks. The inherited values carry explicit source identity and scope rather than being silently added to converted element properties. Parameter CSVs include distinct `resolved-value` rows and relationship witnesses.

[Cached source schedule tables](native-cached-schedule-html.md) documents the later reciprocal-cover qualification, owned dimensions, standalone HTML export, browser check of 97 source schedule artifacts and remaining formula/evaluation limits.
