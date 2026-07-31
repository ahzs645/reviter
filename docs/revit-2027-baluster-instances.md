# Baluster instances: the persisted schema

A companion investigation, [`revit-2027-railing-nested-roots.md`](revit-2027-railing-nested-roots.md),
instrumented the nested-mesh composer against this schema and measured which
railing roots the decode below would actually complete — read it before
implementing.

A sweep of the isolated `BmJsonExportEx` tree (re-inventoried 30 July 2026,
byte-identical to the committed ledger — nothing new has appeared in it)
looking specifically for the two decode gaps the railing work opened. Both now
have named, persisted schemas, recovered from the model's own decoded
`Formats/Latest` stream in the tree's parser samples and corroborated by the
unstripped `TB_StairsRamp.tx` symbol table. The decoded samples come from the
same document and the same save as the paired IFC (`NumberOfSaves` 326,
matching GUID lineage), so every field below is a statement about the file we
are already decoding.

## Where balusters live: `BaseRailingSym.m_balusterInstances`

The railing *symbol* — not the railing instance, and not the per-baluster
elements — persists the placed balusters, as GRep nodes:

```text
BaseRailingSym
  m_GRepLoops
  m_balusterInstances        // array; per the binary: OdArray<OdSmartPtr<OdBmGNode>>
  m_paramsAndIds             // array of paramsAndId
  m_oRailingSweepPath
  m_usedBalusterSymIds
  m_approxLength
  m_baseRailingId

paramsAndId                  // keyed parameter/provenance rows, not occurrences
  m_botAngle
  m_famSymId                 // the baluster family symbol — the 12 decodable shapes
  m_height
  m_instId                   // row provenance; not an occurrence element id
  m_slopeAngle
  m_symId
  m_topAngle
  m_deleted
```

The corroborating binary symbols in `TB_StairsRamp.tx`:
`OdBmBaseRailingSymInternalImpl::setBalusterInstances(OdArray<OdSmartPtr<OdBmGNode>>)`,
`::setUsedBalusterSymIds(OdArray<OdBmObjectId>)`, and
`::setDisplayBalustersInGRep(bool)`.

This closes the loop on three measurements made from the geometry side:

- Railing `1842055` draws 83 correct balusters whose faces all carry a
  `nestedTransform` — they came through nested GRep composition, which is
  exactly what "baluster instances are GNodes on the symbol" predicts.
- The ids persisted as `m_instId` own no geometry or placements of their own.
  Phase 3 measurement below shows that they are per parameter row, not per
  placed station, and therefore cannot identify separately pickable balusters.
- The twelve baluster family symbols all have decodable local shapes — they
  are the `m_famSymId`/`m_usedBalusterSymIds` targets.

So the railings still drawn as swept ribbons are the ones whose
`BaseRailingSym` GRep did not resolve — the "incomplete recursive roots remain
on the proxy path" bucket — and completing them is a matter of following
`m_balusterInstances` under the symbol, not of writing a distribution decoder.
The pattern description that *generates* those instances is also persisted,
for reference rather than for reimplementation:

```text
BalusterInfo:      m_balusterName, m_spaces, m_balusterTypeId, m_botOffset,
                   m_normOffset, m_topOffset, m_baseReferenceId,
                   m_topReferenceId, m_isPost
BalusterPattern:   m_balusters, m_endSpace, m_leftOverFill, m_leftOverSpace,
                   m_patternAngle, m_breakPattern, m_leftOverJustify
BalusterPlacement: m_oBalusterPattern, m_oPostPattern
BaseRailingAttr:   m_oBalusterPlacement, m_pRailStructure, ...,
                   m_balusterPatternIsDefault
```

Reading the instances is strictly better than reading the pattern: the
instances are what Revit actually placed, stair-stepping and corner posts
included.

### Correction: `m_paramsAndIds` is not one row per instance

The original “one per baluster instance” annotation above was an assumption
from the type name and the isolated schema. A complete scan of the persisted
UNBC frames disproves it, so the annotation has been corrected explicitly
rather than left as an apparently harmless comment.

All 214 marker-605 `BaseRailingSym` frames decode to 9,045
`m_balusterInstances` but only 2,675 `m_paramsAndIds` rows. The sharpest
counterexample is owner `1833658`: 258 GInstances, one params row, and 258
InstanceInfo bodies all targeting `m_symId` 1,266,931. Across the full census:

- every frame has one unique, instance-count-sized GInstance body block and
  one unique, instance-count-sized InstanceInfo block;
- in every frame, the set of InstanceInfo symbol ids equals the set of
  `m_paramsAndIds.m_symId` values;
- params rows need not themselves have unique `m_symId` values: 2,675 rows
  reduce to 2,612 distinct symbol ids within their owning frames;
- all 1,775 distinct `m_famSymId`/instance-symbol targets resolve to complete
  existing symbol meshes;
- every `m_usedBalusterSymIds` array in this file is empty, so that optional
  field supplies no stronger join.

The bounded decoder therefore sizes both dynamic body arrays from
`m_balusterInstances`, requires exact symbol-set equality against
`m_paramsAndIds`, and permits duplicate params rows. `m_instId` remains
provenance only. It is never used as a placement or adjacency rule.

### Phase 3 correction: the stations are instance-owned, but not element-tagged

The Phase 2 phrase “155 swept railings link to station frames” conflated a
record carrying `railPath` with a proxy that survives native admission. The
converter has 156 railing records with a rail path, but 154 finish with native
render provenance. Only `1833657` and `1856525` finish on reconstructed
geometry. Native admission already removes the other 154 rail-path proxies
before scene batching.

The station ownership itself is exact and per railing, not shared type state.
Of the 156 rail-path records, 155 have a marker-605 frame whose own
`m_baseRailingId` equals that railing id. In the marker-2246 graph each sampled
railing reaches that frame by one exact nested edge. Coordinate comparison
against the owning railing's independently recovered path gives:

| Railing | marker-605 owner | Stations | Distance to own path, min / median / max (ft) | Nearest other path (ft) |
| ---: | ---: | ---: | ---: | ---: |
| 1833657 | 1833658 | 258 | 0 / 0 / 3.18e-14 | 0.304 |
| 1270456 | 1270457 | 36 | 0.083 / 0.150 / 0.383 | 6.150 |
| 1629844 | 1629845 | 6 | 8.88e-16 / 7.16e-15 / 7.16e-15 | 0.115 |
| 1806032 | 1806033 | 27 | 0 / 0 / 0 | 2.010 |
| 1991771 | 1991772 | 21 | 0 / 7.11e-15 / 1.42e-14 | 6.482 |
| 2164226 | 2164227 | 149 | 0 / 0 / 7.11e-15 | 2.994 |

The sloped `1270456` distances are lateral/vertical offsets inside its own
envelope; every one of its station origins remains inside that envelope. The
other samples coincide with their persisted paths to floating-point precision.
For target `1833657`, the station-origin AABB is
`[-32.0286149287076, 128.342400921351, 14.435695538057743]` to
`[127.82446351713195, 153.667906815786, 14.435695538057743]`, inside the
railing's own envelope and spanning its path.

The tempting per-baluster element route is nevertheless disproved by the
complete census:

- all 9,045 station GInstances persist `GInstance.m_tagElementId = -1`;
- the 2,675 `m_instId` values are all distinct, one per `m_paramsAndIds` row,
  not one per station;
- none of those ids has a recovered geometry/bounds record;
- none has a persisted `Global/ElemTable.OwningElementId` equal to its frame's
  exact `m_baseRailingId`; 1,688 have no decoded owner at all; and
- target `1833658` has 258 stations but one `m_instId`, `1834272`, whose
  persisted owner is `1833656`, not base railing `1833657`.

There is consequently no byte-proven station-to-element-id bijection. Emitting
9,045 separately pickable child elements would require duplicating per-row ids
or inventing ids, so the production bridge does neither.

Railing `1856525` remains the single rail-path record without an exact
marker-605 owner. Its root links to `1857537 -> 1857538` and separately to
`1856526`; neither target is a marker-605 frame. Nearby marker-605 owners
`1859595`, `1860487`, and `1860618` belong exactly to railings `1859594`,
`1860486`, and `1860617` and are unreachable from `1856525`. Their stations
are not borrowed.

## Top-rail curve evidence

The same full census contains 214 marker-967 frames. Of those, 209 have the
certified two-`RailingCurveLoopData` prefix; five fail it and are left opaque.
The 209 exact curve tails consist of two `RailingCurveLoopData` bodies, two
`CurveLoop` bodies, and schema-complete curve bodies ending precisely at the
enclosing frame echo. 199 are GLine-only, six mix GLine with GArc, and four
mix GLine with GHermiteSpline. For target `1834274`, the first pair stores 60
and 64 finite heights, the
CurveLoops declare 30 and 32 consecutive source-slot-1,973 records, and the 62
schema-complete 84-byte GLine bodies occupy frame-relative bytes
22,839..28,047.

Those curves prove two plan boundaries 0.164041994750656 feet apart and their
elevations. Phase 3 bounds the previously opaque middle bytes
`+4,925..+22,457` between the two complete
`RailingCurveLoopData.m_heights` arrays and the two complete CurveLoop bodies.
The internal replay grammar is not assigned without a reader, but an exhaustive
non-null ObjectId scan finds no project element id that could be a section
profile.
Although the schema-declared `ContinuousRailType` fields include
`m_profileId`, the complete `1834274` frame contains only its own id (at `+0`
and `+60`) and owning TopRail `1834273` (at `+165`); no profile target is
persisted. The element-parameter reader likewise finds no table for
`1834273` or `1834274`, so neither
`CONTINUOUSRAIL_PROFILE_TYPE_PARAM` nor a height parameter supplies a fallback
section.

The 60 and 64 values in `RailingCurveLoopData.m_heights` are endpoint
elevations, not section heights. Every value is exactly
18.04461942257218 ft, while every raw GLine endpoint has z=0. For owning
railing `1833657`, the recovered path elevation
14.435695538057743 ft plus its persisted guard height
3.6089238845144394 ft equals the height-array value. The arrays lift the plan
curves to the rail elevation; they do not provide section thickness.

The target therefore still does not prove a vertical section. The curve reader
publishes the exact paths but does not turn them into a solid sweep. A
rectangular or other top-rail section would add geometry the bytes do not
state.

## Where nested-material transparency lives: `AppearanceAsset.m_transparency`

The same schema stream also names the field behind the other open gap. The
direct material layout's transparency (`MaterialId.m_transparency`, decoded in
`material-records.ts`) has a sibling for appearance-backed materials:

```text
AppearanceAsset : PropertySetBase
  m_transparency
  m_color
  m_Name
  m_Asset
  m_sLibrary, m_sScene, m_oImage, m_eAssetType

AppearanceAssetElem
  m_pAppearanceAsset
  m_pThumbnail
  m_materialPathMap
```

This is why the nested record layout stores `ff` bytes where the direct layout
keeps the transparency: the nested records are `AppearanceAssetElem`-backed,
and their transparency sits inside the asset's property set. On the supplied
model every export-matched nested material is opaque, so nothing is currently
mis-drawn — but this names the field a transparent appearance-backed material
would need, and turns "nested-layout transparency remains unresolved" from a
shrug into an address.

## What was checked and found already spent

The rest of the isolated tree is fully accounted for: the fresh recursive
inventory matches the committed ledger byte for byte, the parser prototype was
already reviewed in `rvt-parser-prototype-review.md`, and the decoded stream
samples are the UNBC document at the very save the paired IFC was exported
from — useful as pre-inflated probe inputs, but not a second building.
