# UNBC RVT / IFC / Autodesk GLB audit — 2026-08-01

This note separates reproducible file facts from viewer observations for the
three supplied UNBC sources. The inputs are pinned by SHA-256:

- RVT `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
- Autodesk GLB `8ee1b2c3ba8069e0553c1e79c52d1a3bc112f64c5bc7e2f4568e0c8a8430facb`

| Source | Best use | Reproduced geometry | Material role |
| --- | --- | ---: | --- |
| RVT recovery | local inspection and BIM identity | 1,103,519 triangles | 69 decoded native definitions |
| IFC | semantic and geometric verification | 934,123 triangles | diagnostic comparison colours |
| Autodesk GLB | visual reference and navigation | 616,185 stored / 616,185 scene-instantiated triangles | 22 optimized materials |

## Reproduced results

`verify-pair.ts` passed all **21 of 21** current regression assertions. The
current recovery emits **1,103,519 triangles** and the IFC oracle contains
**934,123 triangles**.

The half-foot element overlay measured **36,142 matched elements**: **98.8% for
centre**, **96.8% for size**, and **96.8% satisfying both tests**. (The printed
per-class table contains 36,136 because it suppresses classes with fewer than
ten matches.) The previous wording “98.8% for both centre and size” is therefore
not supported. `overlay-diff.ts` now records exact all-element centre, size, and
joint centre-and-size counts so that a joint claim cannot be inferred from
rounded class marginals again.

| IFC class | matched | centre within 0.5 ft | size within 0.5 ft |
| --- | ---: | ---: | ---: |
| `IfcMember` | 19,650 | 99.8% | 99.8% |
| `IfcWallStandardCase` | 7,381 | 98.5% | 89.3% |
| `IfcPlate` | 6,235 | 100.0% | 100.0% |
| `IfcDoor` | 1,912 | 88.7% | 88.6% |
| `IfcColumn` | 311 | 100.0% | 100.0% |
| `IfcRailing` | 215 | 100.0% | 100.0% |
| `IfcWall` | 140 | 87.1% | 79.3% |
| `IfcStairFlight` | 108 | 60.2% | 52.8% |
| `IfcSlab` | 107 | 96.3% | 96.3% |
| `IfcCovering` | 46 | 100.0% | 100.0% |

The next recovery work should therefore stay ordered by measured impact:

1. Stair flights (60.2% centre, 52.8% size).
2. Doors (88.7% centre, 88.6% size).
3. Standard-wall size, plus the smaller `IfcWall` population (87.1% centre,
   79.3% size).

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

No saved screenshot, mask, or element-id list currently reproduces the
localized right-wing red overlay. Treat it as a useful visual lead, not a
regression result, until a camera pose plus diff artifact is checked in.

Likewise, the reported 5.9 s walk-surface and 5.3 s optional-collision builds
were useful profiling observations but have no pinned trace. The viewer now
reports per-source cache hit/miss and build timings, and the browser check
exercises RVT → IFC → Autodesk GLB → RVT while preserving the Walk camera.

## Reproduce

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc --json verification.json
node --experimental-strip-types scripts/glb-statistics.ts autodesk-reference.glb --json glb-statistics.json

REVITER_BROWSER_HEADED=1 node scripts/browser-check.mjs \
  dist-pages model.rvt browser-check.png model.ifc autodesk-reference.glb
```
