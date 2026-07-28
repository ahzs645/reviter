# Revit 2027 per-face material binding

This note resolves one bounded part of exact material assignment: the meaning
of positive `GFace.m_renderStyleId` values in the decoded Revit 2027 geometry
graph. It uses exported native interfaces, small call-site disassemblies, and
identity joins within the RVT. IFC is consulted only after the RVT join.

## Native evidence

`OdBmGFaceInternalImpl::getRenderStyleId` at
`TB_Geometry.tx+0x41a6e6` returns the `OdBmObjectId` stored at `+0x88`;
`setRenderStyleId` at `+0x41a70c` copies one 64-bit object ID into that field.
There is no hidden conversion in either accessor.

More importantly,
`OdBmGeometryImpl::updateMaterialsForIndividualFaces` at
`TB_Geometry.tx+0x388d20` iterates `OdBmGeomMaterialMarker` records:

```text
marker.getGeomTag()
  -> locate the corresponding Face
marker.getMaterialId()
  -> GFaceInternalImpl.setRenderStyleId(materialId)
```

The call from `getMaterialId` at `+0x388e70` to `setRenderStyleId` at
`+0x388e9f` is direct. It does not construct or resolve an `OdBmGStyle`.
Therefore a positive persisted face value can be treated as a direct
`MaterialElem` reference when, and only when, the same element ID is
independently decoded as a framed `MaterialElem`.

This is distinct from the fallback graphics-style path:

```text
GInfo.gStyleElemId
  -> OdBmGNodeImpl::getGStyleId()
  -> OdBmGeometryDatabasePE runtime resolution
  -> OdBmGStyleElem.getGStyle() / getMaterialElemId()
  -> OdBmGStyle.getMaterialElemId()
  -> MaterialElem
```

`OdBmGNodeImpl::getGStyleId` at `TB_Geometry.tx+0x36c544` resolves the persisted
GStyle element ID through `OdBmGeometryDatabasePE` and caches the resulting
runtime style ID. `TB_Database.tx` exports
`OdBmGStyleElem::getGStyle`, `getMaterialElemId`, and corresponding setters;
`TB_Geometry.tx` exports `OdBmGStyle::getMaterialElemId`.

That chain is relevant only when the face has no explicit positive material
ID, or when display/category overrides apply. Its persisted
`GStyleElem -> MaterialElem` field has not yet been decoded.

The builder/rendering split remains unchanged. `OdBrepBuilder::setFacesMaterial`
attaches a database material stub to a face ID, while
`OdBrepRendererImpl::getFaceMesh` returns positions and triangle indices
without a material array. The resolved material must therefore remain on each
face/triangle group in the browser IR.

## Browser-safe adapter

`bindRevit2027FaceMaterial` implements the smallest safe identity join:

- `renderStyleElementId > 0` plus an exact framed `MaterialElem` with the same
  ID becomes `exact-material`;
- `-1` remains explicitly `unassigned`;
- another negative value remains `negative-system-id`;
- an unmatched or unsafe positive ID remains `unresolved-positive-id`.

It does not resolve by name, category, IFC material, byte proximity, or a
guessed graphics-style layout.

## Exact UNBC result

The audit used:

- RVT SHA-256:
  `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC SHA-256:
  `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`

All 5,996 Geometry owners and 40,961 Faces decoded without a reader failure.
The file contains 31 distinct face render-style IDs:

| Binding status | Faces | Distinct IDs |
| --- | ---: | ---: |
| Positive ID exactly matching framed `MaterialElem` | 35,365 | 29 |
| Explicitly unassigned (`-1`) | 5,561 | 1 |
| Negative system ID (`-4000010`) | 35 | 1 |
| Unmatched positive ID | 0 | 0 |

Thus every positive face ID in this RVT binds directly to a decoded
`MaterialElem`; no positive face ID requires a `GStyle` indirection. Those
35,365 faces can now carry exact native material element IDs through
tessellation.

This does not make all 40,961 faces appearance-complete. Among the 5,596 faces
without an explicit positive material:

- 140 carry a positive face `GInfo.gStyleElemId`;
- 247 carry a positive owning-Geometry `GInfo.gStyleElemId`;
- the remainder use `-1` at those observed fallback positions.

The exact missing typed relation is the persisted
`GStyleElem -> MaterialElem` (and applicable category/view override precedence),
not an extra hop for the 29 positive face material IDs.

## IFC output oracle

After completing the RVT identity join, the reference IFC reports:

- 29 distinct `IfcMaterial` names;
- 14,768 `IfcStyledItem` entities;
- 7,554 `IfcRelAssociatesMaterial` relations.

The 29 directly face-bound RVT material definitions have 21 exact name matches
in the IFC. The eight absent names are not treated as failed RVT bindings:
exporters may omit unused definitions, consolidate styles, or choose a
different association path. Name equality is only a cross-format audit signal;
it is not used to assign a Revit face.

Run the corpus audit with:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-face-materials.ts model.rvt reference.ifc
```

