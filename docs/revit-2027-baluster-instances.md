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

paramsAndId                  // one per baluster instance
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
