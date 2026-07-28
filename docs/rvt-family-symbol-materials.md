# Revit 2027 FamilySymbol geometry-tag materials

The largest remaining exact UNBC material population after shared geometry and
compound walls was `IfcDoor`: 1,912 of the 3,094 IFC-only assigned numeric
Revit Tags. The relevant RVT carrier is general, not door-specific:

```text
placed instance
  -> InstInfoBase.m_symbolId
  -> FamilySymbol.m_geomTag2MaterialId
  -> geometry tag + MaterialElem id
```

The browser-safe implementation is
`lib/reviter/family-symbol-materials.ts`. It does not read IFC at runtime.

## Native and schema evidence

The supplied RVT's inflated `Formats/Latest` stream defines `FamilySymbol` at
offset `0x3d391`. The exact field `m_geomTag2MaterialId` begins at `0x3da28`;
its descriptor at `0x3da3c` is:

```text
0e 50 00 00 89 01
```

The field is a map/container whose value contract is corroborated by the
following exported `TB_Family.tx` symbols:

| RVA | Native contract |
| ---: | --- |
| `0x4bb5fe` | `OdBmFamilySymbolInternalImpl::getGeomTag2MaterialId() const` |
| `0x4bb606` | `OdBmFamilySymbolInternalImpl::getGeomTag2MaterialId()` |
| `0x4c3f68` | `OdBmFamilySymbol::getGeomTag2MaterialId(std::map<int, OdBmObjectId>&) const` |
| `0x4c3fac` | `OdBmFamilySymbolInternalImpl::setGeomTag2MaterialId(std::map<int, OdBmObjectId> const&)` |
| `0x39d794` | `OdBmFamilySymbolImpl::getMaterialIdForGeometryTag(int, OdBmObjectId&) const` |
| `0x3b69c0` | `OdBmFamilySymbolImpl::getMaterialIds(...) const` |

The persisted wire grammar is:

```text
u32 entryCount
entry[entryCount]:
  i32 geometryTag
  u64 materialElementId
```

The 12-byte stride is visible across variable-width FamilySymbol bodies. Three
representative UNBC records are:

- symbol `2492275`, map at `+699`, count 3:
  tags `27/46/65` → materials `26/182549/182549`;
- symbol `2476307`, map at `+987`, count 3:
  tags `132/133/134` → materials `10429/30200/30200`;
- symbol `2466351`, map at `+788`, count 4:
  tags `63/98/117/136` →
  materials `617540/617540/617544/617544`.

These offsets vary because earlier FamilySymbol fields contain dynamic
collections. The decoder therefore does not use an absolute map offset.

## Fail-closed browser reader

The decoder first records compact object-id references only from independently
length/echo-framed Revit 2027 FamilySymbol objects with marker `0x0810`.
Resolution is deferred until all framed `MaterialElem` definitions are known.

A map is published only when:

- the selected release is Revit 2027;
- the source marker is exactly `0x0810`;
- the count is between 1 and 512 and the full map fits the bounded object;
- every entry follows the exact 12-byte stride;
- geometry tags are nonnegative, bounded, and unique;
- every 64-bit target has a zero high word and resolves to an independently
  decoded `MaterialElem`;
- the symbol contains exactly one distinct resolved map;
- duplicate frames for the same symbol agree.

The placement join also fails closed when one element has conflicting symbol
references. Repeated geometry tags using one material are retained on the map
and collapsed to one element-material assignment carrying all applicable tags.

## Exact UNBC audit

Run:

```sh
node --experimental-strip-types \
  scripts/audit-rvt-family-symbol-materials.ts \
  --rvt "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  --ifc "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc" \
  --json /tmp/unbc-family-symbol-materials.json
```

The exact result is:

| Measure | Result |
| --- | ---: |
| Inflated partition chunks | 3,666 |
| Framed FamilySymbol reference sets | 2,365 |
| Unambiguous resolved material maps | 361 |
| Geometry-tag/material map entries | 1,336 |
| Distinct mapped MaterialElem IDs | 21 |
| Placed element-material relations | 3,911 |
| Distinct assigned elements | 1,952 |
| New elements beyond the current 33,132 | 1,952 |
| New IFC-assigned numeric Tags | 1,931 |
| Exact comparable material-name relations | 3,862 / 3,862 |

The 1,931 IFC-correlated additions are 1,911 doors and all 20 windows. All
1,931 comparable elements have every decoded material name in their IFC
material association. IFC is an audit oracle only; the resolver uses neither
IFC class nor IFC names.

Adding this carrier projects:

- 35,084 distinct native material-assigned elements;
- 34,979 matches among 36,142 unique IFC-assigned numeric Tags, or 96.78%;
- 1,163 IFC-only Tags remaining;
- 105 RVT assignments outside the IFC material set.

The remaining IFC-only material population is led by members (352), columns
(311), railings (215), stair flights (108), slabs (107), and coverings (46).
Those require other typed carriers. The one remaining door symbol has no
resolvable geometry-tag material map and is intentionally not inferred from its
category or siblings.

## Tessellation boundary

This map is more specific than an element-level material set: it preserves the
native geometry tag that selects a material. It still cannot assign a material
to a triangle until native geometry tags are recovered on the corresponding
BRep faces or generated mesh primitives.

`TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`, `libTD_BrepBuilder`, and
`libTD_Br` corroborate where native topology is tessellated. They are not a
browser reader by themselves. The remaining exact join is:

```text
persisted BRep face / geometry tag
  -> FamilySymbol.m_geomTag2MaterialId
  -> MaterialElem
  -> tessellated primitive
```

Until the BRep/topology reader preserves that face tag, this checkpoint is an
exact symbol/element material carrier with geometry-tag provenance, not a claim
of per-triangle assignment.
