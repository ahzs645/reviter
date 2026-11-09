# Native document record inventory

Reviter now projects saved views, schedules, viewports, view/sheet sets, grids,
reference planes, text notes, base points, revisions, area schemes and spatial-element fields into a typed
inventory. It uses the bounded native graph bridge from pinned rvt-rs
`1c3d337dbd2a6810e9dfad68fe99857843d67387`; no second rendering pipeline is introduced.

`lib/reviter/native-record-inventory.ts` exports `buildNativeRecordInventory`,
`NATIVE_RECORD_INVENTORY_CLASSES` and `makeNativeRecordInventoryCsv`. Each row
retains its exact decimal element ID, native class, record digest and stream,
field/object index and any owned pointer path. Admission requires a positive
record body, exact consumed-byte count, a nonempty root field span within that
body and an explicitly null record diagnostic. The containing evidence report
retains raw graphs through `rawRecordIndex`. Unsupported graphs, source contexts
and conflicting owner records remain explicit fallbacks. The adapter currently
accepts structurally decoded 2024–2026 records and the declared pinned reader.

Native class names differ from illustrative upstream typed aliases. The measured
classes include `DBViewPlan`, `DBView3d`, `DBViewSchedule`, `DBViewDrafting`,
`DBViewSection`, `DBViewProject`, `DBViewLegend`, `RefPlane`, `ProjectRevision`,
`AreaMeasureElem` and `RoomElem`. `DBViewDrafting` can carry a sheet number, which
is retained without claiming that the class or geometry constitutes a sheet.
`AreaMeasureElem` describes an area **scheme**, not a bounded spatial area.
`RoomElem` retains shared spatial fields without guessing its API room/MEP-space
classification. Workset visibility IDs do not imply recovered workset names or
collaboration permissions.

`Viewport` preserves the explicit view/drawing IDs, detail number, offset,
label origin, scale ratio and orientation code. `ViewSheetSet` retains its name
and ordered saved drawing IDs through the exact inline
`m_orderedViewSheetList.m_dbDrawingIds` field. These links do not establish a
rendered sheet, visibility state or a synthesized drawing transform.

Field values preserve their saved semantics. View scale is the stored ratio
(RAC Level 1 stores `0.01`), rather than an invented denominator. Sentinel clip
elevations and negative reference IDs remain visible. The base point's transformed
position and its explicitly owned `GPoint.m_coord` remain separate stored values;
neither creates a project-to-survey transform. Text notes retain bounded RTF bytes
only through `m_oSavedRtfData` → `RtfData`, without executing or parsing markup.
Schedule category and flags come through `m_pSchema` → `ScheduleSchema`; rows and
formulas are not recalculated. Grid/reference-plane surface fields require the
exact `m_pSurface` → `Plane` edge and are not promoted into drawing geometry.

CSV exports quote every cell, neutralize spreadsheet formulas, retain source
pointer columns and expose status/scope/counts even when no fields are projected.

Reproduce against local source models (private full graphs and CSV stay outside
the repository):

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/inspect-native-records.ts /workspace/models/rac.rvt \
  --max-records 512 --out /workspace/scratch/rac-record-inventory.json \
  --csv /workspace/scratch/rac-record-inventory.csv

node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-native-record-inventory.ts /workspace/scratch/rac-record-inventory.json \
  --source /workspace/models/rac.rvt --out /workspace/scratch/rac-record-audit.json
```

The CLI accepts `--classes` for targeted extraction and `--max-records` up to
2048. Existing bridge limits on per-record bytes, total output, graph values,
objects, inflation and decoded records still apply. Large documents can therefore
produce `partial` inventories, which do not mean all document records were
retained. Use targeted class selections to investigate additional records.

Measured source projection checks:

| Source | Retained records | Typed records | Fields compared | Owned pointer edges | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| RAC, 2025 | 211 | 211 | 3195 | 262 | Complete selection, zero mismatches |
| School, 2025 | 291 | 291 | 4620 | 154 | Complete selection, zero mismatches |
| Snowdon, 2024, five disjoint queries | 2303 | 2283 | 34553 | 3475 | All selected records retained, 20 graph fallbacks, zero mismatches |

An initial Snowdon broad query (before adding layout classes) decoded 1813
selected records with 20 unsupported graphs; its 512-record retention cap
dropped 1301. The follow-up splits context/spatial records, plan/section views,
other views, schedules and layouts into disjoint class queries. These retained
all 2303 selected records under the same graph/output budgets, including 20
explicit unsupported graphs. The class selection defines this count, which is
not an inventory of every element in the complete model. The five-query auditor
rejects overlapping projected owner IDs before aggregation. Compact results and
exact input hashes are in
`docs/generated/rvt-native-record-inventory-{rac,school,snowdon-all}.json`.

The auditor independently reopens the graph JSON, verifies the original RVT's
SHA256 and compares every projected field and pointer with its source object.
This validates the serialized projection. These supplied paired conversions do
not supply API drawing, sheet, workset or shared-coordinate truth, so those forms
of fidelity remain unmeasured. Scene geometry and indoor/navigation semantics
are unaffected by this on-demand inventory.

Nine targeted tests check owner/class/byte-context disagreement, conflicting
records, exact large IDs, disconnected/ambiguous/contradictory pointers, release
limits, malformed root spans and record diagnostics, preserved native ratios/sentinels, exact inline view/sheet-set ordering,
budget status and CSV neutralization. The WASM output budget applies to the raw
bridge response; typed inventory and CSV are additional application projections.
Upstream attribution remains in `docs/rvt-semantic-attribution.md` and the
preserved Apache-2.0 notices.
