# Cached source schedule tables

Reviter can download a standalone HTML preview of a selected stored schedule. It presents owned cached cell text using native row heights and column widths, applies proven rectangular cover groups, and honors stored section visibility. The document identifies the source RVT/schema hashes, schedule element ID, inventory status and its cached-source scope. It contains no scripts or external resources. This extends the authored-schedule inventory without recalculating Revit schedule contents.

`makeNativeScheduleHtml(inventory, { scheduleId, includeHiddenSections?: boolean })` in `lib/reviter/native-schedule-html.ts` returns a scoped preview result with `html`, status, rendered section/cell/merge counts, source-hidden section count, omitted-section reasons and diagnostics. A blocked or unsupported result has no HTML. Source-hidden sections are omitted by default; callers can explicitly include them while preserving their stored visibility flag in the document.

The inventory additionally projects `ScheduleSectionData.m_rows → TableRowData.m_dHeight` and `m_cols → TableColumnData.m_dWidth`. Every dimension keeps its exact owned pointer witness and source value in feet. A section requires complete pointer sequences, supported finite positive lengths, and a boolean stored visibility flag. CSV exports include separate `stored-section` rows. Missing dimensions preserve the raw stored cells while marking the layout incomplete.

## Proven cover topology

For each stored cell at row `r`, column `c`, native `m_coverTop/Bottom/Left/Right` values are relative cover offsets. A candidate rectangle is:

```
top    = r + m_coverTop
bottom = r + m_coverBottom
left   = c + m_coverLeft
right  = c + m_coverRight
```

Reviter promotes that rectangle to an HTML span only when all of these hold:

- The entire dense, zero-based cell grid matches the owned row/column sequences, with no missing or duplicate cell coordinates.
- Every rectangle lies inside that grid and contains its originating cell.
- Every coordinate in a candidate rectangle has exactly one stored cell with the same reciprocal rectangle.
- Covered cells other than the top-left anchor have empty stored text. A merge cannot discard retained text.

A missing reciprocal member, overlapping cover claim, out-of-range offset or covered non-anchor text leaves the section unresolved. Qualified sibling sections can still be exported with explicit omission reasons. Empty native sections remain empty. These rules qualify the measured stored-grid contract; the public API's `FirstRowNumber`/`FirstColumnNumber` values cannot be guessed for an arbitrary unsupported table.

The exporter writes `rowspan`/`colspan` only for qualified rectangles. It preserves exact source dimensions as data attributes and expresses their paper lengths in CSS inches (`feet × 12`). Browser CSSOM decimal serialization introduces small presentation rounding; source dimension attributes retain the original JavaScript values. Fonts, cell styles, row expansion caused by wrapped text, print pagination and refreshed Revit layout are outside this preview's contract.

## Scope and research

Autodesk's [Schedule Classes guide](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Views/View_Types/TableView/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Views_View_Types_TableView_Schedule_Classes_html.html), retrieved 15 October 2026, describes TableData sections and TableSectionData's rows/columns/cells. It states that ViewSchedule cell contents are generated from the schedule definition and parameters, that body data is read-only, and that some section indices start at one rather than zero. Its examples call `Regenerate()` and `RefreshData()` before manipulating generated table data. This distinguishes stored serialized cell caches from current Revit evaluations.

The source format contract remains the exact file-local schema and pinned rvt-rs graph decoder at `1c3d337dbd2a6810e9dfad68fe99857843d67387`, qualified for Revit 2024–2026. The private native function/operator/source/filter codes have no independently established mapping in that pinned source or the public API guide. Formula ASTs and their internal units remain serialized evidence. No schedule membership, filter execution, sorting, grouping totals, linked-model joins, fresh parameter values or formula results are fabricated. Source cell text that looks like a formula remains literal text.

HTML escapes schedule names and cell text, preserves carriage returns as character references, and rejects NUL text. A restrictive content-security policy forbids resources, scripts, base URLs and form submission. Qualifying limits remain 64 sections, 10,000 cells, 1,024 columns, 10,000 rows, 16,384 characters per cell and supported paper lengths up to 1,000 feet. A conservative markup/text preflight bounds the HTML to 4 MiB before document concatenation; the final UTF-8 document is checked again.

## Actual-model validation

The raw-field audit independently reopens source dimensions and cover offsets, reconstructs each native reciprocal group, and compares every rectangle and member object index with the qualified layout. The source body text and graph identities continue to pass their authored-inventory audits.

| Model | Schedules | Sections | Native row heights | Native column widths | Reciprocal merges | Cells covered by merges | Source topology disagreements |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RAC 2025 | 8 | 16 | 67 | 50 | 9 | 33 | 0 |
| School 2025 | 10 | 20 | 12 | 47 | 9 | 40 | 0 |
| Snowdon 2024 | 79 | 158 | 751 | 638 | 186 | 681 | 0 |

All 97 complete schedules qualify with no omitted sections when source-hidden sections are explicitly included. Source-hidden section counts are six RAC, two School and 54 Snowdon. Snowdon's 13 unsupported source graphs remain outside the qualified layouts. UNBC 2027 remains outside the graph release contract.

Durable reports are `docs/generated/rvt-native-cached-schedules-layout-{rac,school,snowdon}.json`. Chromium independently reopened all **97 actual-model artifacts plus one synthetic adversarial-text artifact**, compared every visible DOM cell's text/object identity/span with direct native-graph expectations, checked source dimensions/visibility, and observed **zero page errors and zero network requests**. The synthetic case renders script/image-like text and CR/LF literally without executing it. The durable [browser report](generated/rvt-native-cached-schedule-html-browser-validation.json) records exact artifact digests and measured CSS dimension rounding. These checks establish source-cache fidelity and escaped browser presentation; they do not establish agreement with a refreshed Revit schedule.

Nine additional synthetic mutations of actual RAC/School/Snowdon layouts remove an owned cached cell, add covered non-anchor text or break a native dimension pointer token. Every case explicitly omits the affected section; partial sibling exports never silently render that section. `docs/generated/rvt-native-cached-schedule-negative-validation.json` records these negative checks. The recorded hashes identify the original positive source models, not modified native files.

Eighteen focused tests cover source/pointer qualification, ordered dimensions, reciprocal rectangles, dense-grid refusal, covered-text preservation, source-hidden inclusion, invalid dimensions, empty sections, literal unevaluated formula text, HTML escaping, size limits and partial section omissions.

## Reproduction

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/inspect-native-schedules.ts model.rvt --evidence source-evidence.json --out inventory.json --html schedule.html --schedule-id 123 --preview-json preview.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/audit-native-schedules.ts model.rvt --evidence source-evidence.json --out layout-audit.json --negative-layouts
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs scripts/prepare-native-schedule-html-browser.ts model.rvt --evidence source-evidence.json --out-dir local-html --manifest local-manifest.json --adversarial-text
node scripts/validate-native-schedule-html-browser.mjs --manifest local-manifest.json --out browser-audit.json
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs --test tests/native-schedule-inventory.test.ts tests/native-schedule-html.test.ts
```

Add `--include-hidden-sections` to the HTML export when explicitly reviewing stored hidden sections. Evidence reuse and browser-fixture preparation both require the supplied RVT bytes to match the evidence SHA-256. Full native graphs, generated HTML files and manifests containing local paths remain outside Git.
