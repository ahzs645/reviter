# Clean-room Geometry-to-BRep browser contract

This note identifies the smallest browser-side boundary that is still missing
after Revit `Geometry` face and edge bodies are decoded. It is based on public
ELF symbol metadata in `BmJsonExportEx-isolated`, Reviter's existing neutral
tessellator, and the supplied UNBC IFC as an audit oracle. It does not reproduce
ODA implementation code, infer an undocumented native ABI, or use IFC data to
decode the RVT.

## What the example actually contributes

The supplied files are x86-64 Linux ELF binaries, so they cannot run directly
in a browser. More importantly, `TB_JsonExport.tx` is not a geometry exporter.
Its exported `BM_JSON_EXPORT` symbols cover model-tree traversal, parameters,
and writing tree objects. It exposes no exporter-owned face, edge, BRep, mesh,
or tessellation entry point. The geometry capability is supplied by the
adjacent native libraries.

The exact inspected files include:

| File | SHA-256 | Relevant role visible in exported symbols |
| --- | --- | --- |
| `BmJsonExportEx` | `70eee86109eec2ff98f8d36495819e988e215421d682cd89f8268e1b32f6ea83` | Native Linux command host |
| `TB_JsonExport.tx` | `ca4843ae55cbd56eb2c4a6fd0a4bff91a1e9c8167eb3c11e1228e0abbb5b6382` | Tree and parameter JSON |
| `TB_Geometry.tx` | `4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f` | Revit geometry graph and BRep bridge |
| `libTD_Ge.so` | `bd8821c698f1217df6726efcfe57b45011ebf5ed855f95a77d5ff539022a0c7b` | Curves, surfaces, matrices, and mesh containers |
| `libOdBrepModeler.so` | `f9ac29574c44060f1e1b5de4c44c9e4110e711d1cb37c79f80d395490b262562` | Native modeler bodies |
| `libTD_BrepBuilder.so` | `23a9481d1d36649b4a230c6e72949ba8a338e80a450b4e6c699ea1f17f77e0e7` | Topology construction |
| `libTD_Br.so` | `c32a077404815e652cd1b55ac44754c8081e6f7c2313c753c423c7ee1ff82e4c` | Read-only topology traversal |
| `libTD_BrepRenderer.so` | `88df6dba62c629c60a599f0f0bf6bef38041cc7f9c6ef68aabb7503f3b58d1c3` | Trimmed-surface tessellation |

The useful clean-room artifact is therefore a data contract, not any of these
binaries.

## Exact conceptual contract exposed by the native stack

The exported symbols establish the following concepts without establishing
their persisted RVT byte layouts:

| Conceptual input | Native symbol evidence | Required browser representation |
| --- | --- | --- |
| Body transform | `OdBrBrep::getTransformation` | One explicit affine `BrepMatrix4` |
| Face surface | `OdBrFace::getSurface`, `getSurfaceType`, `getSurfaceAsNurb` | A decoded analytic or NURBS `BrepSurface` |
| Face direction | `OdBrFace::getOrientToSurface` | `NeutralBrepFace.orientation` |
| Face regions | `getFirstFaceRegion`, `getNextFaceRegion` | One neutral face per exact region, or an exact region-to-loop mapping |
| Face material | `getMaterialID`, `getMaterialString`, material mapper/color/opacity accessors | Stable material reference retained on the face group |
| Face loops | `OdBrFaceLoopTraverser`, `OdBrLoop::getType` | Exact ordered outer and hole loops |
| Coedges | `OdBrLoopEdgeTraverser` | Ordered edge use plus explicit direction |
| Surface p-curves | `getParamCurve`, `getParamCurveAsNurb` | A 2D curve in the owning surface's parameter space |
| Oriented 3D edge | `getOrientedCurve`, `getEdgeOrientToLoop` | The same edge use's directed 3D curve |
| Edge geometry | `OdBrEdge::getCurve`, `getCurveType`, `getCurveAsNurb` | Shared 3D curve definition |
| Edge endpoints | `OdBrEdge::getVertex1`, `getVertex2`; `OdBrVertex::getPoint` | Shared vertices and exact edge incidence |
| Tessellation controls | `wrTriangulationParams`, renderer setters, modeler LOD controls | Explicit bounded semantic options, separate from topology |
| Triangle output | `OdBrepRendererImpl::getFaceMesh(GeMesh::OdGeTrMesh&, faceMarker, ...)` | Positions and three-index triangles grouped by source face |

The renderer symbols also show that surface parsing, edge sampling, p-curve
recovery, loop classification, loop triangulation, degenerate-triangle removal,
and normal generation are separate operations. `getFaceMesh` selects one face
marker and returns mesh coordinates and triangle indices; it does not return a
parallel material array. Material and marker association must therefore survive
outside the raw triangle container.

## Mapping to `brep-tessellator.ts`

Reviter already has the destination half of this contract:

- `NeutralBrep` carries body faces, body transform, and provenance.
- `NeutralBrepFace` carries a surface, oriented trim loops, face direction,
  material reference, object marker, face transform, and provenance.
- `BrepTrimLoop` carries an outer/hole role and ordered curves.
- `BrepTrimCurve` can carry line/polyline 3D trims and explicit line/polyline
  surface p-curves, with arc and NURBS placeholders.
- `NeutralFaceMesh` returns positions, normals, triangle indices, and contiguous
  per-face groups retaining material, marker, transforms, and provenance.

The implemented tessellation subset is intentionally smaller than the IR:

| Decoded topology | Current browser result |
| --- | --- |
| Planar face, one exact region, line/polyline 3D trims, any valid holes | Supported |
| Cylindrical face, one non-wrapping rectangular p-curve region, no holes, explicit policy | Supported |
| Multiple native face regions | Must be split into exact neutral faces before tessellation |
| Cone, sphere, torus, general cylinder regions, or NURBS surface | Explicitly unsupported |
| Arc/NURBS edge requiring approximation | Explicitly unsupported |
| Missing p-curve on a curved surface | Explicitly unsupported |
| Missing loop role/order/direction | Invalid topology; must not be inferred |

`Revit2027GeometryStatic` currently proves the owning geometry's queued face,
edge, and shared-surface collections, `geometryTag`, and `TessEpsCntrl`
selector/version. It does not yet decode the queued bodies or their graph.
`TessEpsCntrl` is not a numeric distance or angular tolerance and must not be
substituted for the semantic options accepted by the tessellator.

## The smallest missing neutral-topology adapter

Once the queued face, edge, vertex, and shared-surface bodies are decoded, the
smallest new component should be a pure, fail-closed adapter. Conceptually its
input is:

```ts
type DecodedTopology = {
  bodyId: string;
  transform?: BrepMatrix4;
  faces: ReadonlyMap<string, {
    surfaceId: string;
    orientation: 1 | -1;
    regions: readonly {
      id: string;
      outerLoopId: string;
      holeLoopIds: readonly string[];
    }[];
    materialId: string | number | null;
    objectMarker?: number;
    provenance: BrepProvenance;
  }>;
  loops: ReadonlyMap<string, {
    orderedCoedgeIds: readonly string[];
  }>;
  coedges: ReadonlyMap<string, {
    edgeId: string;
    direction: 1 | -1;
    pcurve?: DecodedCurve2d;
  }>;
  edges: ReadonlyMap<string, {
    startVertexId: string;
    endVertexId: string;
    curve: DecodedCurve3d;
  }>;
  vertices: ReadonlyMap<string, BrepPoint3>;
  surfaces: ReadonlyMap<string, DecodedSurface>;
  provenance: BrepProvenance;
};
```

These are portable design names, not claims about proprietary class layouts.
The adapter should return `NeutralBrep` or structured adapter issues. It should
not return triangles and should not consult the IFC.

Its bounded responsibilities are:

1. Resolve every face's exact surface.
2. Split each exact native face region into one `NeutralBrepFace`, retaining a
   stable native-face/region identity.
3. Resolve outer and hole loop membership from decoded topology. Do not infer
   roles from winding or projected area.
4. Traverse coedges in persisted order and apply their explicit direction to
   both the shared 3D edge curve and the face-local p-curve.
5. For the current planar subset, emit the directed 3D line/polyline trim. For
   the current cylindrical subset, emit the directed 2D p-curve. Retain the
   paired edge/coedge identities in provenance.
6. Preserve face orientation separately; do not bake it into both loop order
   and triangle winding.
7. Preserve the exact face material reference and object/face marker before
   tessellation creates triangle ranges.
8. Reject missing references, duplicated coedges, open chains, conflicting
   endpoints, unknown direction, unsupported curve conversion, invalid
   transforms, and ambiguous material ownership.

That adapter is the smallest missing layer because the tessellator already
validates loop closure, planarity, hole containment, transforms, face limits,
vertex limits, triangle area, normals, and material-preserving groups. A second
mesh API, a direct native ABI wrapper, or category-specific solid generator is
not needed at this boundary.

There are three small but important representation constraints:

- A coedge owns the face-local p-curve while an edge owns the shared 3D curve.
  They are paired concepts. The adapter may select the representation required
  by the currently supported surface, but the decoded graph must retain both.
- Native face regions cannot be flattened into several `outer` loops on one
  current neutral face because the current tessellator accepts exactly one
  outer loop per face. Exact region membership must drive the split.
- A geometry style or `geometryTag` is not automatically a face material.
  When no exact face/material relation is decoded, the adapter must emit
  `materialId: null` rather than turn a style, category, or IFC association into
  a native face assignment.

## Tolerances and transforms

The topology adapter should only perform finite-value and incidence validation
with a caller-provided model-space comparison tolerance. It must not choose a
display LOD or sample unsupported curves.

The tessellator remains responsible for:

- distance, angular, and area tolerances;
- maximum face and vertex safety bounds;
- the explicit native-derived cylinder policy where its strict subset applies;
- body/face transform composition;
- inverse-transpose-equivalent normal handling and face winding.

Every effective option should be recorded with the mesh provenance. Choosing a
fixed native LOD from the binary defaults would be a new policy guess, not a
decoded property of the RVT.

## Exact UNBC IFC oracle population

The reference IFC has SHA-256
`adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`.
The existing browser `web-ifc` audit reports:

| Oracle measure | Count |
| --- | ---: |
| IFC elements | 41,312 |
| Products with drawable geometry | 36,282 |
| Unique numeric Revit Tags with drawable geometry | 36,144 |
| Geometry placements | 56,728 |
| Unique geometry definitions | 29,984 |
| Tessellated triangles | 934,123 |
| Vertex references | 2,394,161 |
| `IfcMappedItem` occurrences | 27,776 |
| `IfcRepresentationMap` definitions | 5,944 |

A one-pass count of the IFC topology/CSG entities gives:

| IFC representation entity | Count |
| --- | ---: |
| `IfcFacetedBrep` / `IfcClosedShell` | 9,371 / 9,371 |
| `IfcFace` / `IfcFaceOuterBound` | 93,749 / 93,749 |
| Additional `IfcFaceBound` hole bounds | 125 |
| `IfcPolyLoop` | 93,874 |
| `IfcExtrudedAreaSolid` | 21,982 |
| `IfcBooleanClippingResult` / `IfcBooleanResult` | 76 / 44 |
| `IfcStyledItem` | 14,768 |
| `IfcAdvancedFace`, `IfcEdgeLoop`, `IfcEdgeCurve`, `IfcPCurve` | 0 each |

The IFC is therefore a strong final-shape oracle but not a byte-for-byte oracle
for Revit's analytic BRep graph. Its exported boundary representation is almost
entirely faceted polyloops, and much of the source model is represented as
extrusions or mapped geometry. The absence of IFC p-curves or advanced faces
must not be used to conclude that the RVT has no analytic surfaces.

## Element-level comparison strategy

Geometry acceptance should operate in two linked domains:

1. **Definition domain:** hash the decoded neutral topology independently of
   placement; compare each shared geometry definition once; record face,
   region, loop, edge, material-group, triangle, and watertightness counts.
2. **Occurrence domain:** apply every persisted RVT instance transform and
   compare the resulting world mesh with all IFC geometry for the same numeric
   Revit `Tag`.

The numeric `Tag` is the join key. IFC products sharing one numeric Tag must be
unioned for comparison rather than selecting the first product. The two
drawable untagged `IfcRampFlight` products remain a separately reported,
unjoinable population.

For each of the 36,144 joinable drawable Tags, report:

- RVT decode/adapter/tessellation status and explicit issue codes;
- world-space bounds centre and per-axis extent error;
- connected-component count and closed-edge incidence where a closed body is
  expected;
- surface area and signed volume where both meshes are watertight;
- symmetric sampled point-to-triangle distance, at least median, 95th
  percentile, and maximum in model feet;
- optional bounded voxel occupancy intersection-over-union for openings and
  disconnected detail;
- face-group material references separately from geometric distance;
- source definition id and occurrence transform, so a bad shared definition is
  not counted as thousands of unrelated decoder failures.

Bounds within 0.5 ft remain the coarse placement gate. Triangle equality is
diagnostic only: different valid tolerances can tessellate the same surface
differently. Surface distance, occupancy, openings, placement, and preserved
material groups are the geometry criteria.

IFC must remain audit-only throughout this process. Decoder or adapter choices
are certified from RVT framing, topology incidence, and independent fixtures;
the IFC is used afterwards to measure whether the emitted result improved or
regressed.

## Implementation gate

Do not implement the adapter against collection descriptors alone. Its minimum
lawful input is:

- decoded face bodies with exact region and loop membership;
- decoded ordered coedges with explicit direction;
- decoded shared edge curves and vertices;
- decoded face surfaces and p-curves;
- exact body/face transforms;
- exact face material/marker relation or an explicit null.

Once those fields exist, a standalone `brep-topology-adapter.ts` can be small:
graph resolution, orientation normalization, supported-curve conversion, and
structured rejection. The existing tessellator should remain unchanged until
an adapter corpus demonstrates a missing validated behavior.
