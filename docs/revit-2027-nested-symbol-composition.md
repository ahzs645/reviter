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
- Complete roots: 30, containing 11,596 triangles.
- Partial roots: 80, containing 72,450 currently recovered triangles.

The 80 partial roots remain proxy-only. Their source issue occurrences are:

| Issue | Occurrences |
| --- | ---: |
| `planar-sampled:loop-unresolved` | 1,082 |
| `planar-sampled:unsupported-surface` | 20 |
| `cylinder-sampled:non-rectangular-trim` | 4 |
| `planar-sampled:uv-link-unresolved` | 3 |

Counts above can repeat a reused source issue in several composed roots.

## IFC parity

The parity audit treats each nested root atomically. It removes all nested
roots from the direct-owner candidate map, then adds back only roots whose
entire source composition is certified. Partial roots are not credited with
their recovered fragments.

Against the reference IFC:

- Complete nested tags matched: 30 / 30.
- Bounds within `1e-6 ft`: 30 / 30.
- Maximum corner error: `3.421106669065921e-7 ft`.
- Median corner error: `9.18422857765222e-8 ft`.
- Maximum size error: `6.836172730118051e-7 ft`.
- Partial nested roots excluded: 80.
- Overall matched numeric IFC geometry tags after this admission rule:
  33,120 / 36,144 (`91.63346613545816%`).

Triangle counts are diagnostic only because Revit and IFC tessellation do not
need identical triangulations.

## Production collector handoff

`createRevit2027NativeMeshCollector` currently scans one inflated page at a
time and immediately discards a replayed owner unless it is a complete direct
geometry root. That is insufficient for nested symbols: a root and any of its
recursive symbol definitions can live on different pages, and a definition
may contain only grouping/instance nodes.

The production integration should keep the current independent AABB gate and
proxy fallback, with this bounded two-phase design:

1. During `scanPage`, retain every valid framed GRep owner needed for the graph,
   not only direct roots. Store compact owner state keyed by exact bigint
   owner id: certified local face meshes, mesh issues, and collected nested
   links. Reject conflicting duplicate definitions.
2. Add every `symbolElementId` to a bounded pending-id set. Because pages are
   streamed once, retain definitions encountered before they are referenced as
   well as referenced definitions found later. Enforce owner, link, byte, and
   triangle limits independently.
3. At `snapshot`/finalize, resolve the recursive closure with
   `composeRevit2027NestedMesh`. A missing target, cycle, selector conflict,
   replay failure, local mesh issue, or storage truncation makes the entire
   nested root incomplete.
4. Convert each complete composition into shared transformed occurrences (or
   compact composed owner faces), preserving `outer * inner` order. Do not
   count a nested root's direct fragment separately.
5. Feed complete nested roots through the existing
   `expectedBoundsByElement` containment test. Only after all occurrences pass
   bounds and output limits may the element id enter `coveredElementIds`.
6. Leave every incomplete, bounds-rejected, or truncated root on the existing
   proxy path.

The cross-page state should expose separate diagnostics for symbol definitions,
links, complete/partial nested roots, closure failures, and nested triangles.
The direct-owner behavior should remain unchanged for owners with no nested
links.

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
