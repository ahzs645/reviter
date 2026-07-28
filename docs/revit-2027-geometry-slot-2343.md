# Revit 2027 source slot 2343: Geometry/GBRep boundary

This checkpoint identifies and decodes the complete selector-free static body
of source slot 2,343 in the exact UNBC Revit 2027 model. It does not decode a
same-numbered class from another release and it does not infer a class from
payload resemblance.

## Exact class identity

Source slot 2,343 is `Geometry`, not `GeometryBender`.

The exact `Formats/Latest` source order is anchored at the already certified
Revit 2027 `GPolyMesh` slot 2,277. It remains aligned with the available Revit
2026 class order through `GeoSite`, then Revit 2027 inserts these three records:

| Revit 2027 source slot | Class | Schema offset |
| ---: | --- | ---: |
| 2,314 | `GeographicalCoordinate` | 273,501 |
| 2,315 | `GeolocationBoundingBox` | 273,603 |
| 2,316 | `GeolocationControlPoint` | 273,673 |

The complete ordered ladder from `GPolyMesh` through the geometry records,
including the embedded `std::pair` source records, then places:

| Revit 2027 source slot | Class | Schema offset |
| ---: | --- | ---: |
| 2,341 | `TagPair` | 276,274 |
| 2,342 | `GeometricAssemblyComponentDescriptor` | 276,354 |
| 2,343 | `Geometry` | 276,470 |
| 2,344 | `GeometryAugmentationCell` | 276,596 |
| 2,345 | `std::pair< ExternalGeometryId, Trf >` | 276,672 |
| 2,346 | `GeometryBender` | 276,873 |

This also explains the cross-release native evidence without abusing it. The
available unstripped Revit 2026 reader has:

- source slot 2,300:
  `CustomDirectReader<..., OdSmartPtr<OdBmGeometry>>::read` at
  `TB_Format2026Readers.tx+0x1103efa`;
- source slot 2,303:
  `CustomDirectReader<..., OdSmartPtr<OdBmGeometryBender>>::read` at
  `TB_Format2026Readers.tx+0x10fda60`.

The three Revit 2027 insertions change the local shift from +40 to +43.
Therefore 2,300 maps to 2,343, while `GeometryBender` maps to 2,346. The exact
slot-2,343 bytes independently match the `Geometry` reader grammar below.

## Complete static body

The exact schema declares:

```text
GBRep version 1
  m_pFaces             0e 51 00 00

Geometry version 3
  m_flags              04 00 00 00
  m_geometryTag        04 00 00 00
  m_tessEpsCntrl       0e 00 00 00 a0 08
  m_pEdges             0e 51 00 00
  m_sharedSurfInfo     0e 51 00 00
```

Static inspection of the Revit 2026 reader corroborates the same
base-to-derived call order: `GBRep`, two int32 values, `TessEpsCntrl`, and two
`CondInt16` collections. The common `TessEpsCntrl` reader consumes exactly two
int32 values.

The resulting Revit 2027 body is:

```text
GNode/GInfo                         20 bytes
GBRep.m_pFaces count                int32
each face descriptor               int32 token + int16 source slot
Geometry.m_flags                   int32
Geometry.m_geometryTag             int32
TessEpsCntrl.type                  int32
TessEpsCntrl.version               int32
Geometry.m_pEdges count             int32
each edge descriptor               int32 token + int16 source slot
Geometry.m_sharedSurfInfo count     int32
each shared-surface descriptor      int32 token + int16 source slot
```

`decodeRevit2027GeometryStatic` is release-gated to 2027, bounds every
collection, returns the exact static end, and returns face, edge, and
shared-surface properties in native append order. It stops before their queued
bodies. It does not scan for a plausible end or call queued records triangles.

The audit uses the corrected replay envelope: the 16 live FIFO bytes following
the echoed object length are included in `dynamicPayloadEndOffset`. No geometry
boundary is certified against the former shortened envelope.

## Exact-model audit

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-geometry.ts \
  "UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

Results:

| Measure | Result |
| --- | ---: |
| Partition chunks decoded | 3,666 |
| Failed chunks | 0 |
| Roots with an initial slot-2,343 Geometry | 19,045 |
| Initial Geometry bodies reached with currently certified preceding readers | 13,568 |
| Initial-body coverage | 71.2418% |
| First GGroup child slot-2,343 candidates | 7,395 |
| First nested Geometry bodies positioned and decoded | 7,395 |
| First-nested coverage | 100% |
| Remaining first-nested routes | 0 |
| Decoded Geometry static bodies in this audit | 20,963 |
| Static body-size range | 48–2,778 bytes |
| Queued source-slot-1,825 face records | 117,054 |
| Queued source-slot-1,423 edge records | 426,393 |
| Non-empty shared-surface collections | 0 |

Every decoded body also passes the global FIFO append-token sequence. The
7,395 nested bodies split into 7,376 bodies with one face and four edges and
19 bodies with four faces and sixteen edges. All have zero shared-surface
records; their static bodies are 78 and 168 bytes, respectively. Initial bodies
range from 0–126 faces and 0–419 edges.

The last 19 routes are now positioned by the release-certified 84-byte source
slot 1,973 `GLine` reader. This closes the first-GGroup-child Geometry
candidate class without inferring a boundary.

The remaining 5,477 initial Geometry roots are not malformed Geometry bodies.
They have another still-uncertified initial sibling before or after Geometry,
so the audit refuses to guess the body start.

## Tessellator and IFC parity

This is the first release-certified route in this branch to the model's actual
`Geometry`/`GBRep` carrier. It gives the tessellator layer an owned FIFO route:

```text
GRep owner -> Geometry -> queued faces and edges -> curves/surfaces/loops
```

That is where the supplied native layer becomes relevant:

- `TB_Geometry` adapts Revit geometry objects;
- `libTD_Ge` supplies curve/surface mathematics;
- `libOdBrepModeler` reconstructs solid topology;
- `libTD_BrepBuilder` builds faces, loops, and edges;
- `libTD_Br` traverses the BRep;
- the renderer/tessellator turns those surfaces into draw-ready triangles.

Those Linux native binaries are evidence for call order and semantics, not a
browser runtime. A client-side implementation still needs browser-safe
TypeScript or WebAssembly equivalents for the queued face/edge classes,
surface evaluation, trimming, triangulation, and tolerance handling.

The supplied IFC contains:

| IFC oracle | Count |
| --- | ---: |
| `IFCFACETEDBREP` | 9,371 |
| `IFCCLOSEDSHELL` | 9,371 |
| `IFCFACE` | 93,749 |
| `IFCPOLYLOOP` | 93,874 |
| `IFCSTYLEDITEM` | 14,768 |
| `IFCMATERIAL` | 30 |

The 116,978 reachable RVT face descriptors are not claimed to equal the 93,749
IFC faces. Revit can retain hidden, duplicated, intermediate, instance, or
non-exported geometry. Parity requires decoding those face bodies, assembling
owned shells, tessellating them, and comparing element-level topology, bounds,
and triangles against the IFC. At this checkpoint this route produces zero of
9,371 tessellated IFC-equivalent solids.

## Remaining semantic gaps

This reader intentionally does not overstate the other goals:

- **Native Revit UniqueId:** no UniqueId is decoded here. IFC GlobalIds are
  not substitutes.
- **Genuine model-tree membership:** the route retains its framed GRep owner,
  but adds no browser/project hierarchy relationship. The IFC oracle has 1,945
  `IFCRELAGGREGATES` and 13
  `IFCRELCONTAINEDINSPATIALSTRUCTURE` relationships to match independently.
- **Full family regeneration:** this is persisted geometry, not constraints,
  formulas, type parameters, or regeneration logic. IFC does not certify full
  Revit family regeneration either.
- **General BRep/tessellation:** face and edge descriptors are now owned and
  bounded, but their bodies, loops, curves, surfaces, and triangles remain
  undecoded.
- **Exact material assignment:** `GInfo.gStyleElementId` is retained, but no
  per-face render-style/material assignment is resolved. This route currently
  matches zero of the IFC's 14,768 styled items and 30 material definitions.

The next bounded transition is source slot 1,825 for faces, followed by the
edge/curve/surface records needed to close loops.
