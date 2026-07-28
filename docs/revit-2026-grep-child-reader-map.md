# Revit 2026 GRep child reader map

This note maps the source-class slots actually present in the certified UNBC
`GElement -> GRep -> GGroup` roots to the local ODA reader and geometry
modules. It is a clean-room interoperability map: it records symbols, call
boundaries, and serialized/runtime distinctions, not proprietary
implementation.

## Inputs and scope

The reader evidence comes from:

| Binary | SHA-256 |
| --- | --- |
| `TB_Format2026Readers.tx` | `09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f` |
| `TB_LoaderBase.tx` | `56c066e2f308dcff123adfe37edaeb6f51cfa67dad8772ee7f804dbc01f4ae56` |
| `TB_Geometry.tx` | `4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f` |
| `libTD_Ge.so` | `bd8821c698f1217df6726efcfe57b45011ebf5ed855f95a77d5ff539022a0c7b` |
| `libOdBrepModeler.so` | `f9ac29574c44060f1e1b5de4c44c9e4110e711d1cb37c79f80d395490b262562` |
| `libTD_BrepBuilder.so` | `23a9481d1d36649b4a230c6e72949ba8a338e80a450b4e6c699ea1f17f77e0e7` |
| `libTD_Br.so` | `c32a077404815e652cd1b55ac44754c8081e6f7c2313c753c423c7ee1ff82e4c` |

The exact UNBC model audit currently decodes 63,820 of 63,955 framed GElement
roots. Those roots contain 148,223 `AllSubNodes` conditional descriptors.
Their source-class histogram is:

| Slot | Count | Release-specific reader target |
| ---: | ---: | --- |
| 1,973 | 21,849 | no release-specific factory symbol |
| 2,213 | 858 | `OdBmGFilling` |
| 2,215 | 40,652 | `OdBmGFlipControl` |
| 2,219 | 214 | `OdBmGHermiteSpline` |
| 2,221 | 268 | `OdBmGImage` |
| 2,244 | 28 | `OdBmGRvtLink` |
| 2,248 | 42,832 | `OdBmGStyle` |
| 2,254 | 22,104 | no release-specific factory symbol |
| 2,256 | 10 | `OdBmGSystem` |
| 2,259 | 8 | no release-specific factory symbol |
| 2,271 | 109 | `OdBmGenericZoneGeomStep` |
| 2,276 | 232 | no release-specific factory symbol |
| 2,283 | 1 | `OdBmGeomOnPlaneRef` |
| 2,285 | 1 | `OdBmGeomPerpPlaneRef` |
| 2,343 | 19,057 | `OdBmSketchGrid` |

The four unresolved rows have neither a
`CustomDirectReader<version2026, slot, ...>` symbol nor a matching immediate
slot registration in
`version2026::Readers::Internals::HostAppServices::initContainer`. They may be
source representations resolved to common/target classes by the per-file
class table. Assigning them a runtime class name before that representation
map is decoded would be an inference, so they remain unresolved here.

Most importantly, the histogram contains none of:

| Slot | Persisted target | Root count |
| ---: | --- | ---: |
| 2,177 | `OdBmGBrep` | 0 |
| 2,210 | `OdBmGFakeBRep` | 0 |
| 2,237 | `OdBmGPolyMesh` | 0 |
| 5,255 | `OdBmFacetedTopology8` | 0 |

## Exact reader inheritance and nested fields

The mapped release-specific readers are:

| Root slot | Reader address | Proven base-reader call | Own persisted fields relevant to geometry |
| ---: | ---: | --- | --- |
| 2,213 | `0x10d2630` | `GNode` slot 1,399 at `0x10d2a5e` | `Face` ID-reference; inline `FillPatternPlacer`; queued `Data`; pattern/style values |
| 2,215 | `0x10c2b00` | `GNode` slot 1,399 at `0x10c2f2e` | arrow width, points, lengths, style and color |
| 2,219 | `0x10e7a44` | `GCurve` slot 1,932 at `0x10e7e88` | periodic flag and spline-node array |
| 2,221 | `0x10dd7b2` | `GNode` slot 1,399 at `0x10ddbd5` | queued `ImageInfo` |
| 2,244 | `0x10e1abc` | `GNode` slot 1,399 at `0x10e1edf` | queued `InstanceInfo` |
| 2,248 | `0x10efb6c` | runtime base is `OdBmObject` | line-pattern/material IDs, pen, color, screen-size flag |
| 2,256 | `0x10eb48a` | `GText` slot 2,257 at `0x10eb8ad` | line width and parameter type; `GText` has inline text fragments |
| 2,271 | `0x10e5550` | `GeomStep` slot 102 at `0x10e5970` | no own payload after the regeneration-step base |
| 2,283 | `0x10fb222` | `GeomOnPlaneRefBase` slot 2,284 at `0x10fb64d` | offset, angle and flip |
| 2,285 | `0x1100b38` | `Ref` slot 438 at `0x1100f75` | two double pairs and a Z basis |
| 2,343 | `0x143c4ce` | `Element` slot 37 at `0x143c8f4` | database-view element ID |

The inherited runtime classes corroborate the same separation. For example,
`OdBmGFilling::rxInit` calls `OdBmGNode::desc` at `TB_Geometry+0x41f12b`,
`OdBmGHermiteSpline::rxInit` calls `OdBmGCurve::desc` at `0x427d7d`, and
`OdBmGStyle::rxInit` calls `OdBmObject::desc` at `0x44e955`. None of these
inheritance chains enters `GPolyMesh`, `GBrep`, or a faceted-topology class.

### Conditional fields are typed, not hidden mesh selectors

Three mapped readers contain their own `OdBmCondInt16Reader`, but their exact
property lookups and public types rule out a hidden mesh body:

| Owning reader | Conditional call | Property lookup | Runtime property type |
| --- | ---: | --- | --- |
| `GFilling` | `0x10d2cdc` | compile-time `Data` | `OdSmartPtr<OdBmFillPatternData>` |
| `GImage` | `0x10ddcc4` | compile-time `ImageInfo` | `OdSmartPtr<OdBmImageInfoBase>` |
| `GRvtLink` | `0x10e1fce` | compile-time `InstanceInfo` | `OdSmartPtr<OdBmInstInfoBase>` |

`GFilling.Face` is not a nested body at this location. Its reader uses
`StaticIntegerReader` at `0x10d2b4c`; that reader calls
`DynamicQueue::addIdReference` at `TB_LoaderBase+0x1738f7`. The persisted value
is therefore an object-ID reference, while the separate conditional `Data`
property owns fill-pattern data.

`GeomOnPlaneRefBase` is the only mapped inheritance chain with a syntactically
open conditional object:

| Conditional call | Property | Runtime property type |
| ---: | --- | --- |
| `0x10fb0b6` | `RawPlaneInLinkCache` | `OdSmartPtr<OdBmObject>` |
| `0x10fb165` | `FacePointRef` | `OdSmartPtr<OdBmFacePointRef>` |

The first type could technically accept a scoped derived object, so static
typing alone cannot exclude slot 2,237 beneath it. It is not positive
geometry evidence: the property is explicitly a link cache, and the one UNBC
root containing slot 2,283 has three outer queue entries, in order 2,254,
2,343, and 2,283. Its dynamic payload therefore cannot be assigned to the
generic cache field using the current single-property replay certificate.

## Where a persisted BRep would enter

The release does contain a genuine persisted BRep reader, but the certified
UNBC root descriptors do not select it:

```text
slot 2177 OdBmGBrep reader                         0x10ca5b6
  -> GNode base reader                            0x10ca9ee
  -> property lookup "Faces"                      0x10caa5a
  -> collection<CondInt16> read                   0x10cabb8
```

This is an RVT object graph: the BRep owns queued polymorphic face objects.
It is not an opaque `libOdBrepModeler` binary body. A persisted route to
general BRep geometry must first produce a certified slot-2,177 object (or a
proven source representation targeting it), then replay and bind its `Faces`
collection.

The corresponding stored-mesh route remains:

```text
slot 2237 OdBmGPolyMesh
  -> conditional topology property
  -> slot 5255 OdBmFacetedTopology8
```

No certified root descriptor currently enters either route.

## Persisted objects versus runtime tessellation

The solid-modeling libraries operate after Revit objects have been loaded.
They do not resolve RVT source-class slots:

1. `OdBmGeometryImpl::brepBuilder` at `TB_Geometry+0x3891c6` obtains an
   `OdBmModelerGeometryPE` and delegates BRep construction through that
   protocol extension.
2. `OdBmGeometryImpl::brep` at `0x389408` obtains the in-memory modeler
   geometry.
3. `OdBmModelerGeometryImpl::brep` at
   `TB_Database+0x221aba0` passes the internal modeler pointer to
   `OdBrBrep::set` at `0x221abae`.
4. `OdBmModelerGeometryImpl::createBrepRendererImpl` constructs
   `OdBrepRendererImpl` at `0x221cf5b`. Its face-mesh entry points are
   `0x221d9d6` and `0x221da7c`.
5. `libTD_BrepRenderer.so` implements
   `OdBrepRendererImpl::getFaceMesh` at `0x116968` and
   `wrRenderBrep::renderBrep` at `0x17364a`.

`libTD_BrepBuilder.so` exposes the in-memory construction API, including
`OdBrepBuilder::addEdge` at `0x53648`, `addFace` at `0x53794`, `addLoop` at
`0x53810`, and `finish` at `0x54178`. `libTD_Br.so` exposes traversal through
`OdBrBrep::set` at `0x2b72c`. `libTD_Ge.so` supplies analytic curves and
surfaces, while `libOdBrepModeler.so` supplies solid-modeler operations and
consumes the builder/traversal APIs.

None of those four kernel libraries exports an `OdBm` format reader,
`CustomDirectReader`, `OdBmCondInt16Reader`, `GPolyMesh`, or
`FacetedTopology` symbol. They can turn an already reconstructed in-memory
BRep into a drawable mesh, but they cannot identify or deserialize an RVT
root child on their own.

## Result

There is currently no proven persisted path from the certified UNBC GRep
roots to `GPolyMesh`, `FacetedTopology8`, or `GBrep`.

The remaining bounded reader work is:

1. decode the four unresolved source-representation targets (1,973, 2,254,
   2,259, and 2,276);
2. implement exact multi-property FIFO replay for a complete GRep queue;
3. use that replay to classify the one generic `RawPlaneInLinkCache` value;
4. only invoke the browser mesh/BRep layer after an owned slot-2,237 or
   slot-2,177 object has been certified.

The native tessellator kernels are downstream runtime machinery, not a
substitute for those persisted ownership and reader boundaries.
