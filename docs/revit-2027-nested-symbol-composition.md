# Revit 2027 nested symbol geometry

This checkpoint reconstructs the persisted `GInstance`/`InstanceInfo` symbol
graph in TypeScript and proves its transform semantics against the UNBC RVT
and reference IFC. It does not call Revit, ODA, or any native library.

## Native behavior recovered

Static analysis of `TB_Database.tx` shows that
`OdBmInstanceInfoImpl::getGeometryWithOpts` obtains `m_symbolId`, opens that
element, and asks it for geometry. The persisted `gRepId` is not used by this
path in the observed build.

Static analysis of `TB_Geometry.tx` shows that
`OdBmGInstanceImpl::getGNodeByMarker` recursively opens the symbol geometry and
composes transforms as:

```text
outer instance transform * nested instance transform
```

The browser implementation therefore follows `InstanceInfo.symbolElementId`
and uses column-major `outer * inner` matrix multiplication. It fails closed
for missing definitions, duplicate/conflicting definitions, cycles, nonzero
GRep selectors, view-dependent resolution, invalid matrices, excessive depth
or occurrence counts, and roots that resolve to no certified geometry.

`collectRevit2027NestedInstances` pairs `GInstance` and `InstanceInfo` using
the FIFO replay parent index, descriptor offsets, and replay path. It does not
assume that the bodies are adjacent.

## Exact reader blockers removed

The recursive symbol closure exposed six persistence readers that had to be
decoded before the target owners could replay:

| Source slot | Reader | Persisted body |
| --- | --- | --- |
| 2219 | `GBiFlipControl` | `GInfo` + origin + base point + length |
| 2254 | `GFilter` | inherited group data + condition queues + nested-detail flag |
| 2235 | `GConditionDir` | compare mode + direction + negate flag |
| 2234 | `GConditionCut` | `GConditionDir` + low/high range |
| 2259 | `GHermiteSpline` | curve header + periodic flag + inline spline nodes |
| 2414 | `HermiteSurf` | surface header + periodic/constructed flags + inline surface nodes + U/V parameters |

`GFilter` appends both condition collections to the FIFO queue in persisted
order. The other readers consume exact fixed or count-bounded inline bodies.
All counts, offsets, finite numbers, and body ends are validated.

Slot 2414 is `HermiteSurf`, not a queued spline-node body. Its persistence
layout is now decoded, but general Hermite-surface evaluation and trim-aware
tessellation are deliberately not claimed.

## UNBC exact-model audit

Model:

```text
UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt
```

Results:

- Direct-owner FIFO replay: 13,568 / 13,568, with no failures.
- Roots containing nested instances: 110.
- Initial nested links: 248.
- Observed selectors: 248/248 `gRepId=0`, `cda=1`,
  `hasScale=false`, and `resolveSymbolInView=false`.
- Recursive closure: two passes, 1,990 unique symbol ids, 1,990 framed,
  1,990 replayed, and zero missing ids or replay failures.
- Nested links inside symbol definitions: 5,113.
- Symbol owners with certified face meshes: 1,880.
- Certified symbol-target triangles: 29,850.
- Composed roots: 110 / 110, with zero graph-composition failures.
- Complete roots: 105, containing 80,396 triangles.
- Partial roots: five, containing 3,650 currently recovered triangles.

The five partial roots remain proxy-only. Their source issue occurrences are:

| Issue | Occurrences |
| --- | ---: |
| `planar-sampled:unsupported-surface` | 20 |
| `cylinder-sampled:non-rectangular-trim` | 4 |
| `planar-sampled:uv-link-unresolved` | 3 |

This corrected result uses the same drawable-face certification as production.
In particular, CondInt16 token `0` is null, while token `-1` is a real queued
property and positive tokens are numbered properties. A surface-bearing Face
with no `-1`/positive loop or region descriptor is a non-topological reference
face. The earlier 109/1 split incorrectly treated `surface.token=-1` as null,
which hid unsupported drawable faces in four roots.

## IFC parity

The parity audit treats each nested root atomically. It removes all nested
roots from the direct-owner candidate map, then adds back only roots whose
entire source composition is certified. Partial roots are not credited with
their recovered fragments.

Against the reference IFC:

- Complete nested tags matched: 105 / 105.
- Bounds within `1e-6 ft`: 105 / 105.
- Median maximum corner error: `1.5585433033038498e-7 ft`.
- 95th-percentile maximum corner error: `3.4617265214365035e-7 ft`.
- Maximum corner error: `4.018183972220868e-7 ft`.
- Five partial roots are excluded: `1272408`, `1272412`, `1717827`,
  `1717831`, and `1844902`.
- Overall matched numeric IFC geometry tags after atomic admission:
  34,864 / 36,144 (`96.45861000442674%`) after placement-referenced owner
  closure.

This comparison is measured separately from the converter; IFC bytes are never
read by the production path. Triangle counts remain diagnostic only because
Revit and IFC tessellation do not need identical triangulations.

## Production collector handoff

`createRevit2027NativeMeshCollector` now implements the bounded two-phase
handoff while scanning each inflated page only once:

1. `scanPage` retains compact owner-local certified meshes, local drawable-face
   completeness, and exact `GInstance` links in an owner-id map. Inflated page
   bytes are not retained.
2. Owner count, link count, conservative retained-byte estimate, and source
   triangle count have independent finite caps. Duplicate/conflicting owner
   definitions are rejected.
3. `snapshot` resolves recursive closures with
   `composeRevit2027NestedMesh`. Missing targets, cycles, unsupported GRep/CDA
   selectors, scale-bearing or view-dependent resolution, local coverage
   failure, conflicts, and truncation fail the complete root closed.
4. Complete occurrences retain their source mesh/material provenance and an
   exact column-major root-local transform. Rendering applies nested
   `outer * inner` composition before any scene placement.
5. A nested root replaces its proxy only after the existing independent
   `expectedBoundsByElement` and output-triangle gates admit the whole root.

Exact production conversion retained 57,570 compact definitions and 40,700
links, with a conservative retained-size estimate of 206,619,648 bytes. It
composed 109 complete roots (83,492 triangles), kept the one partial root on
its proxy, and reached no cap. All 109 complete roots passed the independent
RVT-envelope gate. The final scene therefore contains 32,520 native elements,
586,709 native triangles, and 4,028 proxy elements.

That direct-root checkpoint was extended by commit `c613144`, which proved
that persisted instance placements also reference ordinary non-direct GRep
definitions. Production now passes the exact placement-owned geometry id set
into collector finalization; it does not publish every scanned definition.
On the same exact RVT:

- 7,532 / 7,805 production-eligible shared owners resolve to complete meshes;
- 273 missing, conflicting, or incomplete requested owners remain proxies;
- 109,938 owner-local triangles are available for exact placement reuse;
- 34,196 elements pass complete native-mesh admission;
- 702,145 native triangles replace their proxies;
- 657 otherwise complete transformed meshes escape the independent RVT
  envelope and are rejected;
- 3,184 otherwise complete meshes lack an independent display envelope and are
  rejected;
- no definition-storage or output-triangle cap is reached.

The resulting GLB contains 36,548 displayed elements, 750,521 total triangles
(native plus retained proxies), 46 mesh batches, and 10 display materials.
Against the IFC, the placement-seeded audit certifies 34,867 / 36,144 numeric
geometry Tags (`96.4669%`) before the production display-envelope gate.
The generic final-scene parity audit reports a triangle ratio of `80.34499%`
because it includes the intentional proxy fallback in both the displayed
element set and the triangle total.

## Tessellator/kernel boundary

`TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`, `libTD_BrepBuilder`, and
`libTD_Br` are the native geometry/tessellation layer. They can evaluate and
tessellate geometry only after a valid owned BRep or generated solid has been
constructed. They do not recover missing Revit family parameters, constraints,
or regeneration rules, and they do not supply a browser ABI.

For a client-only implementation, persisted topology must first be decoded
into a neutral, ownership-preserving intermediate representation. Surface
evaluation and trim-aware tessellation can then be implemented in TypeScript
or an independently deployable WebAssembly module. Native proprietary binaries
are evidence for behavior, not browser dependencies.

## Reproduction

```bash
node --experimental-strip-types scripts/audit-revit-2027-public-grep-replay.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  > /tmp/reviter-public-grep-nested-final.json

node scripts/audit-revit-2027-planar-ifc-parity.mjs \
  --ifc "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc" \
  --rvt-audit /tmp/reviter-public-grep-nested-final.json \
  --json /tmp/reviter-nested-ifc-parity-final.json
```
