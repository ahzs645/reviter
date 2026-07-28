# Revit BRep-to-mesh tessellator: clean-room static analysis

This report maps the public/native interfaces around the tessellator in
`BmJsonExportEx-isolated`. It is based only on ELF metadata, exported/imported
symbols, strings, and small call-site disassemblies. It does not reproduce ODA
source, decode a licensed proprietary body format from implementation details,
or bypass `libOdTrial.so`.

The central finding is that the five named files are **not a self-contained
tessellator**. They define the Revit geometry bridge, geometric primitives,
BRep topology, BRep construction, and the solid-modeling kernel. The actual
BRep-to-triangle implementation is in the adjacent
`libTD_BrepRenderer.so`, invoked through `TB_Database.tx` and configured by
`TB_ModelerGeometry.tx`.

## Exact binary inventory

All files below are dynamically linked, unstripped, x86-64 Linux ELF shared
objects. None can be loaded directly in a browser or mechanically converted to
WebAssembly.

| File | Bytes | SHA-256 | Observed role |
| --- | ---: | --- | --- |
| `TB_Geometry.tx` | 8,321,224 | `4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f` | Revit geometry graph, faceted topology, BRep bridge, face material markers |
| `libTD_Ge.so` | 18,228,832 | `bd8821c698f1217df6726efcfe57b45011ebf5ed855f95a77d5ff539022a0c7b` | Points, vectors, matrices, curves/surfaces, triangle mesh containers |
| `libOdBrepModeler.so` | 14,721,832 | `f9ac29574c44060f1e1b5de4c44c9e4110e711d1cb37c79f80d395490b262562` | Solid-modeling bodies, topology/geometries, operations, native body serialization |
| `libTD_BrepBuilder.so` | 586,520 | `23a9481d1d36649b4a230c6e72949ba8a338e80a450b4e6c699ea1f17f77e0e7` | Incremental construction of BRep topology |
| `libTD_Br.so` | 427,032 | `c32a077404815e652cd1b55ac44754c8081e6f7c2313c753c423c7ee1ff82e4c` | Read-only BRep topology traversal and face attributes |
| `libTD_BrepRenderer.so` | 2,824,096 | `88df6dba62c629c60a599f0f0bf6bef38041cc7f9c6ef68aabb7503f3b58d1c3` | The general BRep surface/loop tessellator |
| `TB_Database.tx` | 61,757,968 | `712af67aee47941fd54c613394e392050618f8bfebcc8ffd08512c5bed513f17` | Element geometry entry point and modeler-to-renderer dispatch |
| `TB_ModelerGeometry.tx` | 87,472 | `f15c4ba415cb1d9a520b9a6363d99c3c0fbdaf4bd3396e53d55327d28170f19e` | Global triangulation, mesh-tolerance, LOD, and cache configuration |

`objdump -p` confirms the separation. `TB_Geometry.tx` depends on
`TB_ModelerGeometry.tx`, `libTD_BrepBuilder.so`,
`libTD_BrepRenderer.so`, `libOdBrepModeler.so`, `libTD_Br.so`, and
`libTD_Ge.so`. `libOdBrepModeler.so` depends on the builder, BRep traversal,
and geometry libraries. `libTD_BrepBuilder.so` and `libTD_Br.so` depend on
`libTD_Ge.so`.

The focused audit is reproducible without loading any target binary:

```sh
node scripts/audit-native-tessellator-stack.mjs \
  "/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated" \
  > /tmp/reviter-native-tessellator-stack.json
```

For the exact hashes above, the audit verifies all nine files, all required
role-defining symbols, and the local dependency edges. The six main targets
are Linux x86-64 ELF shared objects with an Itanium C++ ABI. `TB_Geometry.tx`
and `libOdBrepModeler.so` also depend on `libOdTrial.so`; all main modules
depend on native runtime libraries such as `libstdc++`, `libc`, and/or
`libpthread`.

The isolated tree contains zero `.wasm` or `.wat` artifacts. The target bytes
contain none of the audited WebAssembly/Emscripten/Node binding markers. This
is an absence-of-evidence result for this supplied build, not a claim about
every ODA product: no browser-callable ABI or supplied WASM build exists here.
The browser implementation therefore cannot wrap these particular files.

## Native call chain

The exported symbol and call-site evidence gives this pipeline:

```text
OdBmElement::getGeometry(OdBmGeometryOptions, ...)
  -> OdBmGeometry / OdBmGeometryImpl
     -> existing OdBmGPolyMesh::getFacetedTopology()
        -> points + triangle indices + optional normals/edge visibility
     or
     -> OdBmGeometryImpl::brep(OdBrBrep&)
        / OdBmGeometryImpl::brepBuilder(OdBrepBuilder&, BrepType)
        -> OdBmModelerGeometryImpl::getFaceMesh(...)
           -> OdBrepRendererImpl::getFaceMesh(...)
              -> wrRenderBrep::renderBrep(...)
                 -> surface tessellation + loop triangulation
                 -> OdGeTrMesh: point positions + three-index triangles
```

Relevant exported functions and addresses include:

- `TB_Database.tx`
  - `OdBmElement::getGeometry(OdBmGeometryOptions const&, OdSmartPtr<OdBmObject>&) const`
    at `0x1367848`
  - `OdBmModelerGeometryImpl::getFaceMesh(GeMesh::OdGeTrMesh&, long,
    wrTriangulationParams const&)` at `0x221da7c`
- `TB_Geometry.tx`
  - `OdBmGeometry::brep(OdBrBrep&)` at `0x38767c`
  - `OdBmGeometryImpl::brepBuilder(OdBrepBuilder&, BrepType) const` at
    `0x3891c6`
  - `OdBmGeometryImpl::brep(OdBrBrep&) const` at `0x389408`
  - `OdBmGeometry::getFaceMesh(..., wrTriangulationParams const&)` at
    `0x3876cc`
- `libTD_BrepRenderer.so`
  - `OdBrepRendererImpl::getFaceMesh(GeMesh::OdGeTrMesh&, long,
    wrTriangulationParams const&)` at `0x116968`

The `TB_Database.tx` call site at `0x221da7c` dispatches through the renderer
interface with the output mesh, face marker, and triangulation parameters. The
renderer clears the output, runs `wrRenderBrep::renderBrep`, selects cached
records for the requested face marker, copies point positions and three-index
triangle records, and applies an `OdGeMatrix3d` transform to every output
point. No material array is copied into `OdGeTrMesh` by this method.

`TB_Geometry.tx` also handles an `OdBmFace` that contains multiple face
regions by meshing the regions and appending their `OdGeTrMesh` values before
returning. A browser implementation must preserve this aggregation behavior
or expose the regions as separate primitives.

## Two distinct geometry paths

### 1. Stored faceted topology

This is the most promising client-side path because its records are already
tessellated. Exported APIs include:

- `OdBmGPolyMesh::getMaterialID`, `getInteriorGStyleID`, and
  `getFacetedTopology`
- `OdBmFacetedTopol::getPointsArr`, `getNormVecsArr`, `getNormalsFlag`,
  `getEdgeVisFlags`, and `getFacets`
- `OdBmFacetInternalImpl::getVertices()`, returning a three-index array
- `OdBmFloatFacetedTopology`, `OdBmDoubleFacetedTopology`, and
  `OdBmOffsetFloatFacetedTopology`
- `OdBmFloatNormalsFacetedTopology`
- versioned `OdBmFacetedTopology0` through `OdBmFacetedTopology13`

The versioned types show two index-width families: alternating variants use
unsigned-short or integer facet indices. Later variants add edge-visibility
byte arrays; offset-float topology stores an origin/offset separately from
float positions. Normal storage can be absent, common to a mesh, or array
based. These are data-shape contracts, not proof that Reviter already knows
the release-specific serialized record layout.

A decoder should therefore retain:

```ts
interface MeshPrimitive {
  positions: Float64Array | Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
  edgeVisibility?: Uint8Array;
  materialRef?: bigint | string;
  sourceGeometryMarker?: bigint | string;
  transform?: Float64Array; // column/row convention declared by the IR
}
```

Index widening to `Uint32Array` is lossless. Offset-float points should be
reconstructed in double precision before optional GPU-relative rebasing.

### 2. Parametric/modeler BRep

`libTD_Br.so` exposes the neutral topological graph:

```text
BRep -> complexes -> shells -> faces -> loops -> coedges/edges -> vertices
```

Its interfaces expose vertex points, edge curves, face surfaces, orientation,
NURBS conversions, and face attributes. `libTD_BrepBuilder.so` exposes the
inverse construction contract: add complexes, shells, faces, loops, vertices,
edges, and coedges; associate p-curves and directions; finish each level; then
obtain the result.

`libTD_BrepRenderer.so` contains adapters for planes, spheres, cylinders,
elliptical cylinders/cones, cones, tori, NURBS, and unknown surfaces. Its
symbols show face parsing, edge sampling, surface tessellation, profile/loop
triangulation, triangle validation, normal calculation, and degenerate
triangle removal.

The missing step is not a TypeScript wrapper. It is the lawful decoding of the
RVT/modeler body into that neutral graph, followed by a robust trimmed-surface
tessellator. `libOdBrepModeler.so` exports native binary-body loaders and
serializers (`OdMdBinFile::load`, entity/geometry loaders,
`OdMdSerializer::writeBody`, and `OdMdDeserializer::readBody`), but the
serialized body format and implementation remain proprietary.

## Builder-filler topology contract

The adjacent `libTD_BrepBuilderFiller.so` supplies a useful clean-room handoff
contract even though it is not a browser dependency:

- `performFace` at `0x93a2c` maps `OdBrFace::getOrientToSurface()` directly to
  builder `Forward`, otherwise `Reversed`; `OdBrepBuilder::addFace` at
  `0x53794` converts the reversed enum to the backend boolean.
- `performLoop` at `0x93f3e` emits a forward coedge exactly when
  `getEdgeOrientToLoop() == OdBrEdge::getOrientToCurve()`;
  `OdBrepBuilder::addCoedge` at `0x535c0` carries only loop ID, edge ID,
  reversed boolean, and the optional p-curve.
- In this Revit bridge, `OdBmBrEdge::getOrientToCurve()` at
  `TB_Database.tx:0x22230dc` is always true.
  `OdBmBrEdge::isOrientToLoop()` at `0x2225478` combines the face-reference
  side with `OdBmGEdgeImpl::isFlipped()`. `isFlipped()` at
  `TB_Geometry.tx:0x346502` is flags bit zero. The exact browser rule is
  therefore forward when `(flags & 1) !== 0` equals `faceSide === 1`, and
  reversed otherwise.
- The other observed GEdge flag bits are independent of direction: bits 1 and
  2 mark the first and last endpoints, and bit 3 marks a 3D arc. Thus `0x6`
  and `0xe` have the same orientation.
- `splitOuterLoops` at `0x8df26` classifies UV inclusion, reverses selected
  coedge arrays, toggles every affected coedge direction, and duplicates face
  metadata when one persisted Face produces multiple filled regions.

The browser Plane, Cylinder, Cone, and SurfRev owner paths now share that
persisted coedge-direction rule. This removes endpoint-order inference,
including 17 two-edge planar contours where both curves share both endpoint
pairs.

The same paths now share the native coedge-order rule. At
`TB_Database.tx:0x22210a8`/`0x2221208`,
`OdBmBrCoedge::GetNext/GetPrev` selects the current loop Face's index in the
edge's two-face array and calls `GEdge.getNextItem/getPrevItem` with that
index. The accessors at `TB_Geometry.tx:0x413f0a`/`0x413f3e` directly index
the persisted next/previous arrays. This makes face-local ordered coedges,
including the loop-sentinel transition, exact RVT evidence rather than an
endpoint-derived ordering.

`OdBmGEdgeImpl::getCurveType()` at `TB_Geometry.tx:0x347812` provides a
separate bounded curve classifier: two total points are a 3D line segment;
otherwise flags bit 3 selects a 3D circular arc; all remaining cases enter
surface-dependent logic. Applied to the exact owner replay, this yields 84,097
line segments, 372 circular arcs, and 30 surface-derived edges. The browser
exposes only those proven kinds. It does not promote sampled arc points into
exact center/radius/parameter data.

The filler also proves why a raw UV epsilon is not a general repair policy.
`getParamCurveFixed` at `0x8bb34` validates an existing p-curve, clears an
invalid one, and conditionally projects a replacement through
`createParamCurve` at `0x8b288`. Its adaptive tolerance is local to
`restoreUvCurveAsNurb`: it samples ten points, combines surface distance,
`min(curve-extent diagonal * 1e-4, 0.01)`, and a `1e-6` floor, then makes at
most three attempts. That tolerance never enters `addCoedge`, `finishLoop`, or
the modeler validator.

Separately, `checkCoedgeLoop` at `0x8f124` evaluates p-curve endpoints through
the face surface into 3D and uses the filler-wide `0.01` distance tolerance;
it may intersect and retime p-curves. Final modeler validation instead checks
directed 3D edge-curve endpoints with its default `1e-6` resource tolerance.
UV coordinates can be angles or other surface parameters, so neither number
may be copied into a raw-UV continuity gate. A portable repair must evaluate
the analytic surface or decode the 3D edge curve; otherwise it remains
explicitly unsupported.

## Mesh, materials, and transforms

`libTD_Ge.so` exposes `GeMesh::OdGeTrMesh` operations such as `clear`,
`append`, `removeDegenerateTriangles`, `removeUnusedVertices`, adjacency
construction, and normal calculation. `GeMesh::OdGeTr` is a triangle with
three integer indices. This supports a portable mesh IR of positions and
indexed triangles; computed normals are a post-process when source normals are
not retained.

Exact materials require more than the returned mesh:

- `OdBrFace` exposes material ID/string, material mapper, color, opacity, fill
  data, and attributes.
- `TB_Geometry.tx` exposes `OdBmGPolyMesh::getMaterialID`,
  `OdBmGeomMaterialMarker` geometry-tag-to-material-ID mappings, face-type
  markers, and per-face material update functions.

Because `getFaceMesh` does not place material IDs in `OdGeTrMesh`, each face or
geometry marker must remain associated with its emitted triangle range. A
client implementation should create one render primitive per material/face
marker or maintain explicit triangle groups. Merging all triangles first
would make exact material assignment unrecoverable.

Transforms appear at geometry node, instance, BRep, builder, and renderer
boundaries. Use explicit 4x4 transforms in the portable IR. Apply points with
`w = 1`; transform normals with the inverse transpose and renormalize; reverse
winding under a negative-determinant transform. The normal and winding rules
are standard rendering requirements inferred for the portable design, not
recovered proprietary behavior.

## Tolerance and level of detail

The named native controls establish the concepts that the portable API needs:

- `OdBrMeshControl`: distance tolerance, maximum node spacing, maximum
  subdivisions, and angular tolerance
- `OdBrMesh2dControl`: maximum aspect ratio and element shape
- `OdBmGeometryOptions`: detail level, reference computation, visibility, and
  view context
- `TB_ModelerGeometry`: triangulation parameters, mesh tolerance, cache use,
  and level of detail

`wrTriangulationParams` is a 51-byte native structure in this build. Static
analysis shows scalar and boolean fields and two different default sets, but
the symbols do not recover authoritative field names or units. Those offsets
must not be promoted into a public TypeScript contract based on guesses.
`TB_ModelerGeometry` clamps its normalized mesh tolerance/LOD inputs and
derives scale-dependent internal values.

Use a semantic, engine-independent browser contract instead:

```ts
interface TessellationOptions {
  chordTolerance: number;
  angleToleranceRadians: number;
  maxEdgeLength?: number;
  maxSubdivisions: number;
  maxTriangles?: number;
  detailLevel?: "coarse" | "medium" | "fine";
}
```

Document units in model space, clamp unsafe values, and include the effective
options in geometry provenance. Revit view/detail/visibility filtering occurs
before tessellation and must not be conflated with triangle density.

## Portable versus proprietary boundary

| Safe clean-room implementation target | Still native/proprietary in this evidence set |
| --- | --- |
| A neutral mesh/BRep/material/transform IR | ODA ELF binaries and ABI |
| Version-aware decoding of independently identified RVT records | ODA trial activation and runtime loading |
| Stored faceted-topology decoding | Undocumented modeler binary-body decoding |
| Analytic tessellation written from public mathematics | ODA `wrRenderBrep` implementation |
| A separately licensed/open-source WASM tessellator behind the IR | ODA family regeneration and database semantics |
| Native Revit `UniqueId` reconstruction and the currently decoded genuine ownership/host/level/stairs graph | Complete model-tree membership and full family regeneration |
| Per-element mesh validation against the supplied IFC | Treating IFC geometry or semantics as RVT decoder input |

The useful artifact to reproduce is the **contract**, not the binary code:
geometry graph in, face-aware indexed mesh out, with explicit tolerances,
transforms, provenance, and material groups.

## Reconciliation with the exact UNBC converter

The named layer clarifies ownership of BRep work, but several project gaps sit
before or beside tessellation:

| Project capability | Exact current checkpoint | Relationship to the named layer |
| --- | --- | --- |
| Native Revit `UniqueId` | 74,437 persisted identities decoded; all 38,187 numeric IFC Tags with an element-table join have a native identity | Already solved upstream; no tessellator dependency |
| Genuine model tree | 50,205 owning-element, 27,568 host, and 37,503 associated-level relations decoded | Core persisted relations are solved; full view/family/nested hierarchy remains upstream of geometry |
| Certified browser geometry | 13,236 complete owners retained; 32,411 scene elements and 503,217 native triangles emitted; 4,137 elements retain proxies | Current TypeScript replay supplies a bounded subset of the graph the native builder/renderer would consume |
| Family regeneration | 327 unreplayed shared owners account for 2,019 IFC Tags at the recorded parity checkpoint | `GeomTable` retains generator-ID indirection, not a drawable graph; the dynamic `GeomStepList`/history state or an actual `m_geometry` BRep must be reconstructed first, and none of the named BRep entry points accepts a `FamilySymbol` record |
| General BRep/tessellation | Planes plus bounded cylinder/cone/surface-of-revolution paths are certified; general p-curves, regions, transforms, NURBS, and trimmed surfaces remain incomplete | Builder/traversal/renderer exports define the needed neutral contract, but supply no browser ABI or documented body decoder |
| Exact materials | 133,482 of 139,106 decoded Faces carry positive IDs bound to 36 framed `MaterialElem` records; 5,624 faces remain unassigned/system-style cases | Face/material grouping must be retained around `OdGeTrMesh`; the mesh carrier itself has no material array |

The `GStyle` fallback audit found that every selected positive style in the
remaining direct-owner set stores material `-1`, so it adds no exact material
assignments. Category, type/family geometry-tag, view, and system override
precedence remain separate semantic work.

Most importantly, the observed triangle handoff is
`OdBrepRendererImpl::getFaceMesh(GeMesh::OdGeTrMesh&, ...)`: an in-memory C++
object containing points and integer triangle indices. It is not a serialized
triangle stream. `OdMdSerializer::writeBody` and
`OdMdDeserializer::readBody` concern the proprietary native modeler body, not
a portable mesh format. The separately persisted
`OdBmGPolyMesh`/faceted-topology variants are the only observed already-
tessellated RVT route, and they still require release-specific record and
ownership decoding before browser use.

## Concrete TypeScript/WASM implementation order

1. Decode and test stored `OdBmGPolyMesh`/faceted-topology variants first.
   This can unlock real RVT triangles without implementing BRep evaluation.
2. Add a neutral face-aware `MeshPrimitive` IR and prevent geometry
   deduplication from erasing source element, face marker, transform, or
   material association.
3. Implement analytic tessellators for independently recovered primitive
   records. Keep tessellation policy separate from record decoding.
4. Define a BRep IR containing analytic/NURBS surface definitions, ordered
   trimming loops, edge p-curves, orientation, source markers, and materials.
5. Put robust trimmed-surface tessellation in WASM; keep parsing, orchestration,
   provenance, and export in TypeScript. A WASM component still needs lawful
   BRep input—it does not solve the native body decoder.
6. Preserve an explicit unsupported-geometry result when neither faceted nor
   decoded BRep geometry exists. Do not manufacture proxy geometry and call it
   exact.

For the project requirement that RVT parsing at least match the reference IFC,
validate at element/component granularity where joins are available:

- geometry coverage and instance count
- transformed bounding boxes
- surface area and signed/absolute volume
- triangle/component counts and degenerate-triangle rate
- normalized geometry hashes
- material-group coverage

Global bounding-box or triangle-count agreement alone can hide missing
elements, duplicated instances, wrong transforms, or collapsed materials.
IFC is a validation oracle, not evidence for fields that the RVT decoder did
not recover.

## Reproduction commands

Run from `/Users/ahmadjalil/Desktop/BmJsonExportEx-isolated`:

```sh
file TB_Geometry.tx libTD_Ge.so libOdBrepModeler.so \
  libTD_BrepBuilder.so libTD_Br.so libTD_BrepRenderer.so \
  TB_Database.tx TB_ModelerGeometry.tx

shasum -a 256 TB_Geometry.tx libTD_Ge.so libOdBrepModeler.so \
  libTD_BrepBuilder.so libTD_Br.so libTD_BrepRenderer.so \
  TB_Database.tx TB_ModelerGeometry.tx

objdump -p TB_Geometry.tx | rg 'NEEDED'
nm -D -n -C TB_Geometry.tx | rg \
  'OdBmGeometry.*(brep|getFaceMesh)|OdBmFaceted|OdBmGPolyMesh'
nm -D -n -C TB_Database.tx | rg \
  'OdBmElement::getGeometry|OdBmModelerGeometryImpl::getFaceMesh'
nm -D -n -C libTD_BrepRenderer.so | rg \
  'OdBrepRendererImpl::getFaceMesh|wrRenderBrep|SrfTess|TriangulateLoop'
nm -D -C libTD_Br.so | rg \
  'OdBr(Face|Brep|Loop|Edge|Vertex|MeshControl)'
nm -D -C libTD_BrepBuilder.so | rg 'OdBrepBuilder::'

objdump -d -C --start-address=0x221da7c --stop-address=0x221dac1 \
  TB_Database.tx
objdump -d -C --start-address=0x116968 --stop-address=0x116dce \
  libTD_BrepRenderer.so
```

Addresses and native layouts are evidence for this exact hashed build only;
they are not a stable ABI.
