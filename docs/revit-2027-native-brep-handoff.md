# Revit 2027 native BRep handoff and browser readiness

This note fixes the boundary between the independently decoded RVT object
graph and a general client-side tessellator. It uses only exported ELF symbols
and small call-site disassemblies from the isolated example. It does not copy a
native implementation, call the native libraries in a browser, or use IFC to
fill missing RVT fields.

## Observable native sequence

The exact bridge is not a file parser. `OdBmGeometryImpl::brepBuilder` at
`TB_Geometry.tx+0x3891c6` obtains `OdBmModelerGeometryPE` and dispatches through
its protocol-extension method. `OdBmGeometryImpl::brep` at `+0x389408` obtains
the already reconstructed in-memory modeler geometry.

The clearest construction call site is
`OdBmMdUtils::mdBody2BmGeometry` at `TB_Geometry.tx+0x2e2ca2`. Its observable
builder calls establish this semantic order:

```text
for face:
  addFace(surface, surfaceDirection, shellId)
  setTag(faceId, marker)
  for loop:
    addLoop(faceId)
    for ordered coedge:
      add/reuseEdge(curve3d)
      setTag(edgeId, marker)
      addCoedge(loopId, edgeId, coedgeDirection, pcurveOrNull)
setFacesMaterial(...)
finish()
```

The native builder exports the same data contract directly:

- `addFace(OdGeSurface const*, EntityDirection, shellId)`
- `addLoop(faceId)`
- `addEdge(OdGeCurve3d const*)`
- `addCoedge(loopId, edgeId, EntityDirection, OdGeCurve2d const*)`
- `setTransformation`, `setTag`, `setFacesMaterial`, and `finish`

`libTD_Br.so` exposes the inverse traversal contract: face surface and
orientation, face regions, loop type, coedge p-curve and oriented 3D curve,
edge orientation and vertices, and body transformation.

The final native stage is
`OdBrepRendererImpl::getFaceMesh` at
`libTD_BrepRenderer.so+0x116968`. It clears the output, calls
`wrRenderBrep::renderBrep`, selects cache entries by the requested face marker,
copies three indices from each four-integer cache record (record fields 1, 2,
and 3), appends points, and applies the renderer's `OdGeMatrix3d` to every
point. It does not copy a material array into the triangle mesh.

This proves that face marker/material association must survive outside the raw
positions and indices.

## Exact decoder coverage versus the handoff

The current exact Revit 2027 source ladder is:

| Persisted concept | Source slot | Current evidence |
| --- | ---: | --- |
| Geometry owner | 2343 | Exact static/FIFO reader |
| Face | 1825 | Exact static reader |
| GEdge | 1423 | Exact face-local ordering/direction, exact UV samples, and exact line/arc/surface-derived early curve kind |
| EdgeLoop | 1434 / 1437 | Exact loop references and envelope bodies |
| Plane / cone / cylinder | 634 / 900 / 1144 | Exact analytic bodies |
| Surface of revolution | 4283 | Exact body and queued profile descriptor |
| Revolution profile GArc | 2213 | Exact analytic arc body |

That reaches the persisted-graph readiness stage and is sufficient for the
existing narrow sampled-face paths, but it does not yet establish the general
native-builder-equivalent graph:

- GEdge UV points are exact persisted samples, not a decoded analytic 2D
  p-curve.
- Next/previous references and coedge direction are exact native semantics:
  `OdBmBrCoedge::GetNext/GetPrev` index the persisted arrays by the current
  loop Face, and direction combines that face side with the GEdge flip bit.
- Native `getCurveType()` proves 84,097 line segments, 372 circular arcs, and
  30 surface-derived edges in the exact replay. Supported-surface adapters map
  persisted samples into 3D, but exact general arc/surface-derived parameters
  and shared 3D edge curves remain incomplete.
- Exact face-region membership remains unavailable for the general handoff.
- The body transform feeding the general BRep boundary is unresolved.
- Positive face material IDs now bind directly to exact framed `MaterialElem`
  identities for 35,365 UNBC faces. The remaining unassigned/system-style
  fallback path is unresolved, so complete face appearance remains partial. A
  category or IFC material must not be substituted.
- General analytic/NURBS surface evaluation and trimmed-surface tessellation
  remain browser implementation work after the graph is complete.

The exact local inputs used for the audit are:

- RVT SHA-256:
  `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC SHA-256:
  `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`

The exact RVT replay completed all 5,996 direct Geometry owner scopes without a
reader, route, or boundary failure. It decoded 40,961 Faces, 84,499 GEdges,
40,632 EdgeLoop bodies, 40,813 planes, 136 cylinders, 10 cones, two surfaces
of revolution, and their two queued GArc profiles. The initial 116,844
Face-owned children were all consumed, and the replay reported
`readerCorpusValid: true`.

Those counts validate the listed readers against this RVT. They do not promote
the missing general handoff fields. In particular, no IFC topology or material
was imported to complete an RVT face.

`revit-2027-brep-handoff.ts` makes this boundary machine-checkable. Its stages
are cumulative:

1. `persisted-graph`
2. `native-builder-equivalent`
3. `browser-renderer`
4. `exact-material-output`

Each required capability must be backed by `exact-rvt` evidence. Sampled RVT
data remains useful for explicitly sampled paths, but does not silently promote
the general handoff. Inferred and IFC-derived values fail closed.

## Next reader and implementation work

The shortest route to general geometry is:

1. Decode exact face-region membership.
2. Complete the general edge-to-3D-curve and coedge-to-2D-pcurve relations,
   retaining shared edge identity.
3. Resolve the owning BRep transform and face markers.
4. Convert those records into a neutral graph and add mathematically
   independent evaluators for the already decoded analytic surfaces.
5. Add bounded trimmed-surface tessellation and preserve one triangle group per
   face marker/material.
6. Only then compare the independently produced RVT mesh with the supplied IFC
   oracle. IFC parity is an output test, never decoding evidence.
