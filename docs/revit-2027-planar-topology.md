# Revit 2027 planar topology and sampled-mesh audit

This checkpoint connects the exact Revit 2027 `Geometry` → `Face`/`GEdge`/
`EdgeLoop` replay to Reviter's browser-neutral BRep and TypeScript planar
tessellator. It uses the IFC only after RVT decoding, as a numeric-Revit-Tag
oracle.

It mirrors the supplied native stack at a clean browser boundary:

| Native responsibility | Browser-side implementation |
| --- | --- |
| `TB_Geometry` object graph | exact per-owner FIFO and positive token registry |
| `libTD_Ge` Plane evaluation | `origin + u*xVector + v*yVector` |
| `libTD_BrepBuilder` / `libTD_Br` | resolved Face, ordered loop, face side, directed edge uses |
| `libTD_BrepRenderer` trim sampling | persisted GEdge endpoint/interior UV samples |
| native face mesh | `NeutralBrep` → `tessellatePlanarBrep` |

No native ELF is loaded in the browser and no implementation is copied from
it. Static/native evidence establishes persisted field order, topology
semantics, and tessellation-policy boundaries.

## Reproduce

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-planar-topology.ts model.rvt \
  > /tmp/revit-2027-planar-topology.json

node scripts/audit-revit-2027-planar-ifc-parity.mjs \
  --ifc reference.ifc \
  --rvt-audit /tmp/revit-2027-planar-topology.json \
  --json /tmp/revit-2027-planar-ifc-parity.json
```

## Exact replay and topology

All 3,666 partition chunks inflate. The audit reaches 5,996 direct
single-`Geometry` owners and decodes all 116,844 initial Face children:

| Body | Decoded |
| --- | ---: |
| Face | 40,961 |
| GEdge | 84,499 |
| Plane | 40,813 |
| ConeSurf | 10 |
| CylSurf | 136 |
| SurfRev | 2 |

The token registry implements the native shared pointer namespace. A positive
`StaticInteger` may reserve a token before its dynamic property body appears.
The UNBC file contains five such forward jumps reserving 13 indices, followed
by 13 exact later materializations. Arbitrary gaps and duplicate
materializations remain rejected. There are no token, reader, route, or
boundary failures in the initial Face-child corpus.

The resolved graph contains 40,632 closed loops and zero next/previous
reciprocity failures. UV endpoint matching produces 40,604 uniquely oriented
cycles:

| UV winding | Loops |
| --- | ---: |
| Positive | 36,866 |
| Negative | 3,738 |
| Unavailable because endpoint matching is ambiguous or absent | 28 |

Every edge use records the owning Face side and its direction around the loop.
Those values, not a winding guess, drive the neutral BRep adapter.

## Planar sampled tessellation

All 40,813 Plane bodies are reached. Face eligibility is:

| Result | Faces |
| --- | ---: |
| Complete planar loop chain and unique directed UV samples | 40,298 |
| No first loop | 491 |
| Non-plane surface | 148 |
| Ambiguous/unmatched UV chain | 24 |

Resolved loop-chain sizes are 40,214 single-loop Faces, 72 two-loop, 20
three-loop, 15 four-loop, and one six-loop Face. There are 162 extra linked
loops. The owner mesher now classifies only the unambiguous subset with one
containing shell and direct holes. Its planar tessellator then independently
requires strict containment, pairwise nonintersection, simple rings, and
outer-minus-holes area equality.

The independently safe single-loop and certified multi-loop subsets are sent
to the tessellator:

| Stage | Faces |
| --- | ---: |
| Attempted | 40,265 |
| Adapted to `NeutralBrep` | 40,265 |
| Tessellated | 40,261 |
| Structured tessellator rejections | 4 |

The result has 167,472 positions, 87,010 triangles, and 40,261 source-face
groups across 5,806 reusable geometry owners. It includes 73 multi-loop Faces
with 105 direct hole loops and 2,199 triangles across 32 owners. Thirty-three
multi-loop Faces remain fail-closed because their contours do not prove the
supported topology.

The broader certified-owner API now adds the independently proven sampled
Cylinder, Cone apex-sector, and circular-profile rectangular `SurfRev`
subsets: 129 more source faces, 5,018 positions, and 4,462 triangles. Its
current combined direct-owner total is 40,390 face meshes, 172,490 positions,
and 91,472 triangles. Six non-certified Cone faces, thirteen non-certified
Cylinder faces, and arbitrary curved trims remain separate gates.

## Persisted instance placement

The same local scan decodes 30,608 existing instance placements. Joining their
persisted shared-geometry ID to the sampled owner mesh places 25,538 instances
without category or IFC-class inference. Reuse expands the sampled result to
308,107 placed triangles.

The placement uses the persisted 3×3 basis and origin. Nested `GArray` and
source/target transform chains are not silently composed: earlier exact-model
tests show that treating `GArray` as a replacement placement makes IFC bounds
worse. Those transforms stay a separately quantified regeneration boundary.

## IFC comparison

The parity script opens the reference IFC locally with `web-ifc`, takes only
numeric Revit Tags as the join key, and compares triangle counts after all RVT
work is complete. For persisted instances it also transforms the IFC mesh from
Y-up metres into the RVT/browser Z-up feet frame and compares world AABBs.
Direct geometry-owner bounds are excluded because their coordinates are not
assumed to be world coordinates.

| Metric | Result |
| --- | ---: |
| IFC geometry Tags | 36,144 |
| RVT certified product candidates | 31,352 |
| Tags with both RVT certified and IFC geometry | 25,642 |
| IFC geometry-Tag coverage | 70.94% |
| RVT triangles on matched Tags | 317,790 |
| IFC triangles on the same Tags | 318,304 |
| RVT / IFC triangles on matched Tags | 99.84% |
| Tags with exactly equal triangle counts | 25,542 / 25,642 (99.61%) |
| Persisted instances with matched IFC geometry | 25,533 |
| World bounds within 0.000001 ft on every corner | 25,326 / 25,533 (99.19%) |
| World bounds within 1 inch on every corner | 25,505 / 25,533 (99.89%) |
| World bounds within 0.5 ft on every corner | 25,522 / 25,533 (99.96%) |
| Equal triangle count and bounds within 0.000001 ft | 25,320 / 25,533 (99.17%) |

Members account for 19,298 matched Tags and plates for 6,235. Their triangle
ratios remain 99.96% and 99.98%, respectively. The certified curved paths add
eight direct owner candidates and one matched IFC Tag relative to the planar
baseline. After multi-loop promotion, coverings reach 97.49%; slabs are
114.61% and roofs remain 37.60%. The slab overage demonstrates why aggregate
triangle parity is diagnostic rather than proof: the browser and IFC can
legitimately triangulate the same trimmed boundary differently. The remaining
ambiguous multi-loop and general curved-surface cases dominate the
matched-set discrepancy.

Equal triangle counts are diagnostic, not geometric identity: different valid
tessellation tolerances can emit different triangle counts. World bounds now
give an independent placement and extent check: median worst-corner error is
2.91e-9 ft and the 95th percentile is 8.02e-8 ft. Eleven `IfcPlate` Tags exceed
0.5 ft. They are the contiguous Revit IDs `1954494..1954504`, all native
`Curtain Wall Panels` exported as system panels with glazing. Their triangle
counts are already exact, while their selected shared-owner extents are not;
that isolates a nested geometry/family regeneration binding problem rather
than tessellation density. The owner IDs and per-axis errors are retained in
the report instead of treating those panels as successful instances.
Sampled-surface and topological equivalence remain stronger future checks.

## Fail-closed boundaries

- Multi-loop Faces enter only when the sampled UV contours prove one shell
  with direct holes and pass strict geometric/area validation; 33 ambiguous,
  disjoint, nested, or invalid cases remain rejected.
- Cone, Cylinder, and SurfRev persistence is decoded. The combined owner
  endpoint separately adds 123 sampled Cylinder faces, four exact Cone apex
  sectors, and two Arc/SurfRev rectangles to this planar adapter's output.
- Four self-intersecting or otherwise invalid sampled loops return structured
  `invalid-loop` failures and no partial mesh.
- A positive persisted face material ID is emitted only when it exactly joins
  an independently framed `MaterialElem`; negative, unassigned, and unresolved
  IDs remain `null` rather than using IFC/category fallback.
- `FillPatternData`, all 99 reached `FillGrid` bodies, and both 117-byte GArc
  profiles are decoded. All 5,996 direct Geometry replay boundaries complete.
- Full family regeneration, nested source/target transforms, general curved
  BRep tessellation, and GStyle/category/view material fallback remain explicit
  work, not hidden assumptions.
