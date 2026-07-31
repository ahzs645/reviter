# Baluster instances: the persisted schema

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
  m_instId                   // the per-baluster ElemTable child element
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
- The 885 baluster ElemTable children own no geometry and no placements of
  their own — because `m_instId` inside the symbol's `paramsAndId` is the only
  thing that ties them to a drawn baluster.
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
elevations. They do not prove a vertical section: the frame contains no
section-profile reference and no standalone vertical profile dimension.
Consequently the curve reader publishes the exact paths but does not turn them
into a solid sweep. A rectangular or other top-rail section would add geometry
the bytes do not state.

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
