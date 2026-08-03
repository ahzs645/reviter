# UNBC RVT / IFC / Autodesk GLB audit — 2026-08-01

This note separates reproducible file facts from viewer observations for the
three supplied UNBC sources. The inputs are pinned by SHA-256:

- RVT `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
- Autodesk GLB `8ee1b2c3ba8069e0553c1e79c52d1a3bc112f64c5bc7e2f4568e0c8a8430facb`

| Source | Best use | Reproduced geometry | Material role |
| --- | --- | ---: | --- |
| RVT recovery | local inspection and BIM identity | 968,606 triangles | 79 recovered/display materials |
| IFC | semantic and geometric verification | 934,123 triangles | diagnostic comparison colours |
| Autodesk GLB | visual reference and navigation | 616,185 stored / 616,185 scene-instantiated triangles | 22 optimized materials |

## Reproduced results

`verify-pair.ts` passed all **21 of 21** current regression assertions. The
current recovery emits **968,606 triangles** and the IFC oracle contains
**934,123 triangles**.

The half-foot element overlay measured **36,142 matched elements**: **99.4% for
centre**, **98.7% for size**, and **98.7% satisfying both tests**. (The printed
per-class table contains 36,136 because it suppresses classes with fewer than
ten matches.) The previous wording “98.8% for both centre and size” is therefore
not supported. `overlay-diff.ts` now records exact all-element centre, size, and
joint centre-and-size counts so that a joint claim cannot be inferred from
rounded class marginals again.

| IFC class | matched | centre within 0.5 ft | size within 0.5 ft |
| --- | ---: | ---: | ---: |
| `IfcMember` | 19,650 | 99.8% | 99.8% |
| `IfcWallStandardCase` | 7,381 | 98.4% | 95.1% |
| `IfcPlate` | 6,235 | 100.0% | 100.0% |
| `IfcDoor` | 1,912 | 100.0% | 99.9% |
| `IfcColumn` | 311 | 100.0% | 100.0% |
| `IfcRailing` | 215 | 100.0% | 100.0% |
| `IfcWall` | 140 | 87.1% | 79.3% |
| `IfcStairFlight` | 108 | 75.0% | 75.0% |
| `IfcSlab` | 107 | 96.3% | 96.3% |
| `IfcCovering` | 46 | 100.0% | 100.0% |

The next envelope-recovery work should therefore stay ordered by measured impact:

1. The smaller `IfcWall` population (87.1% centre, 79.3% size).
2. Stair flights (75.0% centre and size; 81.5% against the nearest product for
   the 12 Tags the exporter split).
3. The residual standard-wall size population (95.1%).

Doors are no longer a leading envelope residual: reconstructed closed leaves
now score 100.0% on centre and 99.9% on size.

Stair and curtain-wall container counts must not be used alone as a geometry
failure signal. Their visible children can carry the surface while a wrapper is
suppressed; future gates should compare the rendered child union as well as the
semantic container count.

The IFC contains **41,293 products with a non-empty `Tag`**, but only **38,187
unique numeric Revit Tags**. The 41,293 figure must not be described as 41,293
numeric RVT identities. The stricter drawable geometry population remains
**36,144 unique numeric Tags**. The fresh verification saw all 38,076 numeric
building-element Tags in its scoped class ledger and recovered geometry for all
36,144 drawable Tags; two members are intentionally not selected for display.

The Autodesk GLB contains **616,185 stored triangles**, **616,185 triangles
instantiated by its active scene**, 198 line primitives, and 22 materials. No
mesh definition is instanced more than once in the source document. The former
**1,212,419 “instanced triangles”** number is not supported by GLB topology and
appears to be a renderer/runtime counter rather than source geometry. The new
`glb-statistics.ts` audit keeps stored and scene-instantiated counts separate.

IFC and GLB world spans differ by 0.000126 m, 0.000934 m, and 0.000024 m, or a
maximum of **0.00307 ft**. That is strong dimensional agreement. It does not by
itself prove coordinate registration: the Autodesk GLB is recentered while the
IFC retains project coordinates. Viewer comparison aligns their measured
bounds and preserves a normalized camera across units/up axes.

The material evidence remains supported by the pinned generated reports:

- 21 of 22 Autodesk palette RGB entries match decoded native RVT colours;
- 48 of 69 decoded RVT material definitions match a GLB palette colour;
- the unmatched pure green palette value behaves like a presentation colour.

## Claims that remain visual or timing observations

The GLB comparison is now reproducible at the triangle-surface level rather
than by dimensions or memory between source switches. `glb-surface-diff.ts`
registers the recovered feet-based GLB to the Autodesk metre-based GLB, samples
both into a common voxel grid, and reports both directional residuals.

At 0.5 m cells (one-cell neighbourhood tolerance, 0.866 m diagonal):

- recovered coverage against Autodesk: **98.27%**;
- Autodesk coverage against recovered: **99.9785%**;
- recovered-only cells: **18,231 of 1,050,825**;
- Autodesk-only cells: **226 of 1,051,434**.

A stricter 0.25 m run (0.433 m diagonal tolerance) still gives **99.8655%**
Autodesk coverage. Its 6,450 Autodesk-only cells are localized rather than a
building-scale hole. The recovered-only population is led by native glass and
closed stair tread/riser surfaces; ordinary wall proxies contribute under one
percent of their sampled surface at both resolutions. This is evidence not to
remove the curtain-wall cuts merely to improve wall AABBs.

Those two populations are now classified without deleting them. At 0.5 m,
**3,313** recovered-only cells are exclusively native transparent pane
thickness/back/edge surfaces and **3,699** are exclusively closed stair-run
surfaces (plus one mixed cell). The remaining **11,218** cells stay in the
review layer. At 0.25 m the same conservative split is 50,977 glazing, 28,523
stair, 10 mixed, and 132,556 review cells. A cell shared with any unclassified
mesh remains review rather than being hidden by the retained-detail label.

The face-orientation breakdown also rejects a blanket stair-underside removal:
at 0.5 m the stair batch has 2,926 unmatched upward horizontal cells, 1,731
downward horizontal cells, and 2,732 vertical cells (orientation cohorts can
overlap at edges). The StairsRun record supplies a native 0.16 ft tread
thickness and its riser end conditions but no monolithic/waist-slab flag.
Deleting the horizontal bottoms would therefore create open geometry without
resolving the top/riser residuals. The geometry remains closed.

Recovered technical-mode glazing now uses depth-tested alpha hashing instead
of Three.js transparent-object sorting. This preserves the decoded Revit alpha,
the pane thickness, and double-sided visibility in interior Walk views while
preventing the native front/back shell from swapping sort order during Orbit.

The checked-in red/grey view deliberately contains only residual surfaces:
red is recovered-only and grey is Autodesk-only. A selected curved stair looked
as though it pierced a roof in the RVT view, but the selected-element overlay is
intentionally visible through occluding geometry. Deselecting it restored the
same continuous roof seen in IFC and Autodesk GLB; it was not a model hole.

Evidence artifacts:

- `generated/unbc-rvt-autodesk-surface-diff.json` and the stricter
  `generated/unbc-rvt-autodesk-surface-diff-0.25m.json`;
- `generated/unbc-rvt-autodesk-surface-diff.svg` / `.png` (red/grey residuals);
- `generated/unbc-rvt-autodesk-surface-diff-review.svg` / `.png` (the same
  red/grey convention with the conservatively retained glazing/stair detail
  filtered);
- `generated/unbc-first-person-rvt-stair-1779476.jpg` and
  `generated/unbc-first-person-autodesk-stair-1779476.jpg` (preserved-camera
  Walk comparison).

Likewise, the reported 5.9 s walk-surface and 5.3 s optional-collision builds
were useful profiling observations but have no pinned trace. The viewer now
reports per-source cache hit/miss and build timings, and the browser check
exercises RVT → IFC → Autodesk GLB → RVT while preserving the Walk camera.

## Reproduce

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc --json verification.json
node --experimental-strip-types scripts/glb-statistics.ts autodesk-reference.glb --json glb-statistics.json
node --experimental-strip-types scripts/glb-surface-diff.ts recovered.glb autodesk-reference.glb \
  --cell 0.5 --json surface-diff.json --svg surface-diff.svg \
  --actionable-svg surface-diff-review.svg

REVITER_BROWSER_HEADED=1 node scripts/browser-check.mjs \
  dist-pages model.rvt browser-check.png model.ifc autodesk-reference.glb
```
