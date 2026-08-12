# Wall bodies: trimmed analytic surfaces, rebuilt solids, arcs and diagonals

> **These are observations from dated runs on one building**, the supplied
> 67 MB Revit 2027 project, not standing facts about Reviter. Each figure was
> measured once, on the model and the code as they stood on the date given, and
> nothing re-derives them: there is no model file in this repository, so no test
> and no CI job recomputes any number below. Read them as a record of what was
> seen and why a rule was written the way it was. Recorded 2026-07-28; moved out of
> the README on 2026-08-12.
>
> These entries were one continuous document until that date, so a
> cross-reference to something "above" or "below" — or to "this file" — means
> somewhere in the audit record, which is now this directory. Pointers that
> landed in a *different* entry have been turned into links; the rest still read
> correctly within the entry they are in.

Revit does not store an element's shape as vertex soup; it stores trimmed
analytic surfaces. This entry is the decode of those records, the wall solids
rebuilt from them, the cylinder triples that give a curved wall its arc, and the
measurement that settled why the diagonal walls cannot be fixed from anything
they own.

## Native surfaces

Revit does not store element shapes as vertex soup. It stores **trimmed analytic surfaces** — a plane or a cylinder plus the parameter range over which it is used:

```text
plane, 105 bytes            cylinder, 137 bytes
+0    u8  0x01              +0    u8  0x01
+1    f64 origin (3)        +1    f64 origin (3)          arc centre
+25   f64 uDir (3)          +25   f64 xDir (3)
+49   f64 vDir (3)          +49   f64 yDir (3)
+73   f64 uMin, vMin,       +73   f64 zDir (3)
          uMax, vMax        +97   f64 radius
                            +105  f64 uMin, vMin, uMax, vMax
```

A surface point is `origin + u·uDir + v·vDir`. For a wall the plane is its centre plane, so the location line is `origin + t·uDir` over `t ∈ [uMin, uMax]` and the height is `vMax − vMin`.

**Verification.** Of 7,443 walls with a two-point axis in the paired IFC export, **90.9% have a vertical plane record exactly collinear with that axis** — the in-plane line passes through the axis start within 1e-6 ft. The controls are what make this conclusive: shifting the query line sideways by **0.01 ft drops the hit rate to 0.0%**, and rotating it by **half a degree also drops it to 0.0%**. Separately, `vMax − vMin` matches the IFC extrusion height to within 1e-9 ft for 94.2% of walls, against 34.2% under randomised re-pairing. 78 of 78 curved walls have their arc centre present as an exact coordinate triple, 77 have a cylinder record there, and 65 match the IFC radius exactly.

The trim range is the wall **as modelled**, before Revit's join trimming. The difference between `uMin`/`uMax` and the IFC axis endpoints is, element by element, exactly half of a wall thickness present in this model — 60 mm, 100 mm, 125 mm, 150 mm. The IFC axis is the post-join version, so that disagreement is evidence the record is genuine rather than evidence of an error.

**Attribution.** Geometry lives in per-element blobs, and each blob is introduced by an owner record that names its element outright: `ff ff ff ff 10 03 [u32 count][count × u64 element id]`. A surface belongs to the last such record before it — and that is the same anchor the parameter tables hang off, so one scan serves both.

The rule verifies at **99.87%** on the 4,544 wall plane-triples that have a unique geometric owner, against **0.04%** when the truth is shuffled and **0.00%** for a random tag. Across all categories, **96.9%** of attributed planes have their origin inside the owner's own bounding box, against 5.5% for a random element.

Two earlier readings were wrong and are recorded so they are not retried: the nearest preceding element id owns the surface only 0.6% of the time, and the `[u64 elementId][u32 n][n × u32 itemIndex]` table nearby contains the true owner only 0.4% of the time — its indices address a face/edge graph, not surfaces.

## Rebuilt solids

A wall's geometry is three consecutive plane records at a 105-byte stride: the centre plane, then the two face planes offset by half the thickness along the plane normal. That triple is everything needed to rebuild the wall as Revit modelled it — location line from `origin + t·uDir` over `[uMin, uMax]`, height from `vMin` to `vMax`, thickness from the separation of the faces.

**10,028 elements in the supplied project are rebuilt this way**, and the viewer draws those instead of their bounding boxes. Against the paired IFC export the rebuilt location line is collinear with the IFC axis for **6,280 of 6,284 — 99.9%** — and the rebuilt height matches the IFC extrusion depth for **98.2%**. The recovered thicknesses come out as the round millimetre figures a real building has: 90, 140, 150, 250, 300 mm.

This is oriented geometry, not an envelope. A wall running at an angle is drawn at that angle, with its true length and thickness, where the bounding-box path could only draw the box enclosing it.

## Curved walls are written the way straight ones are

A quarter-round wall was being drawn as the rectangle enclosing its whole bulge — which is what an axis-aligned envelope of an arc is, and it reads on screen as a curve squared off into a block.

`wallSolidsFor` reads a straight wall as three plane records at a 105-byte stride: the centre plane, then the two faces half a thickness out. A curved wall is written **exactly the same way**, in cylinder records at their own 137-byte stride — the centre cylinder carries the centreline radius and the two faces carry that radius plus and minus half the thickness. Element 305688 owns three at 10.05, 9.72 and 10.38 ft.

The converter had been counting those records and throwing them away.

The test that three cylinders are one wall is arithmetic rather than positional: **the middle radius must be the mean of the outer two**, to 1e-6. That is not a threshold fitted to anything — a run of unrelated cylinders will not have a centre radius. Of the 42 stride-137 triples in the supplied project, **27 pass**, and all 27 are elements the export types `IfcWallStandardCase`.

**Verification against the paired export.** For every one of the 27 the median distance from an export vertex to the annulus sector is **0.0000 ft**; 18 have every vertex within a foot. Against a shuffled pairing, **0 of 27** are within half a foot. The larger worst-vertex figures are elements the export writes as an arc *plus* straight runs, where the arc is exact over its own sweep and the residual is the part of the element it does not cover.

What it buys is not mainly a tighter box. Five of the 27 had a bounds record covering only a fragment of the wall, and the arc gives them their true extent:

| element | envelope plan | arc plan | export plan |
| --- | --- | --- | --- |
| 305688 | 10 sq ft | **224** | 223 |
| 1783529 | 56 | **248** | 248 |
| 1873366 | 16 | **88** | 87 |
| 960687 | 2 | **13** | 13 |
| 960631 | 2 | **13** | 12 |

The arc is drawn as an annulus sector at no coarser than π/32 per segment, and it sits below the rebuilt solid in the drawing precedence: an element with a straight location line has one for a reason, and the arc is what a curved wall has instead.

`curved-walls-rebuilt` is a **firing** assertion, not an accuracy one. The arithmetic is self-checking, so the failure mode is not a wrong arc but silence — a release that writes cylinders at a different stride, or an attribution that stops reaching them, and every curved wall quietly reverts to its bulge rectangle with nothing in the output saying so.

### What the curve complaint turned out to mostly be

The census that found this is worth stating, because the headline number is not curvature. `scripts/footprint-audit.ts` measures it on any pair:

```sh
node --experimental-strip-types scripts/footprint-audit.ts model.rvt model.ifc
```

It asks how much of its own plan bounding box an element's footprint fills — an axis-aligned rectangle fills 1.00, a quarter round fills π/4, a 1 ft wall 30 ft long at 45° fills 0.03 — for the export's footprint and for the geometry the viewer actually draws. The difference is plan area the recovery invents. This is deliberately not what `overlay-diff.ts` measures: a wall at 45° can have a perfect centre *and* a perfect size and still be drawn as a rectangle many times its own area.

Of 33,719 export footprints, 1,171 are not boxes in plan. The recovery already follows 923 of them — 869 from a rebuilt solid, 42 from an oriented box, 12 from the new curved-wall arc. The remaining **248 are drawn as an axis-aligned box anyway, adding 77,415 sq ft of plan area** that is not in the building:

| | count | plan sq ft added |
| --- | --- | --- |
| curved | 49 | 4,760 |
| diagonal | 199 | **72,655** |

So the visible defect has two causes and they are very different sizes — **94% of the invented area is diagonal, not curved.** An angled wall's axis-aligned box is a large rectangle where the wall is a thin sliver, and the worst single element adds 18,599 sq ft on its own.

The diagonal case is not fixed, and the reason is now settled rather than suspected: **the geometry is not in the readable stream**. That is worked through below.

**The way curved and diagonal are told apart was wrong once, and the correction is worth recording.** The first version counted hull corners, collapsing turns under 12°: a rotated rectangle keeps four, a tessellated arc shows many. That reads plausibly and is not measurable — how far an arc's turns fall below any angular threshold depends entirely on how finely the *exporter* tessellated it, and a 64-segment quarter round at 1.4° per step collapses to three corners and reads as a triangle. It undercounted the curved elements by eightfold, at 6 against the true 49. The measure now used is the footprint's fill against its own *minimum-area* rectangle: a rectangle at any rotation fills it exactly, an arc fills π/4 of it at any tessellation, and no threshold on tessellation is involved.

**One route was tried and rejected.** A wall's location line is recoverable from its sketch curves, and given a location line the thickness is not a guess: an axis-aligned envelope of a wall of length `L` at angle `t` with thickness `w` is `W = L·|cos t| + w·|sin t|` and `H = L·|sin t| + w·|cos t|`, so `w` falls out of the envelope the record already carries — twice, from two independent equations. 111 of the 245 own a curve and 63 solve a thickness, but only 22 land within half a foot of the export. The self-consistency check that should have separated them does not: at its tightest, requiring the two solutions to agree to 0.001 ft, it keeps 14 of which **4 are still over 5 ft wrong**. A rule that draws 4 in 14 elements badly wrong is worse than the box it replaces, so it is not shipped. Recorded here so it is not retried on the same evidence.

### Why the angled walls cannot be fixed from what they own

A wall's surfaces are not loose in the page. They live in an **object of their own, under marker `0x0f3b`**, sitting beside the element's ordinary `0x08c6` object, and the `ff ff ff ff 10 03 01 …` anchor is that object's head. 7,954 of them exist against 7,208 walls in the export, so the class is the wall body and nothing else. Of a 900-wall sample that the export names *and* that carries an anchor, **883 have a `0x0f3b` object; of the 893 walls with no anchor, 9 do.**

So an element with no anchor has no surfaces because it has no geometry object, and **146 of the 165 angled walls that own nothing are named by no anchor anywhere**, against 12.2% of every element the export names. Four candidate explanations, separated:

| | verdict | the numbers |
| --- | --- | --- |
| attribution does not reach them | **refuted** | Ignoring ownership entirely — is *any* vertical plane in the file collinear with the wall's own export axis? — hits **88.6%** for anchored walls and **10.1%** for unanchored. Controls: axis rotated 5° → 0.1%, shifted 1 ft → 2.3%. The z band must be in the query; without it the unanchored score 47.9%, which is the wall one storey up. |
| page-boundary chunking | **real, but not theirs** | 19,987 of the file's 82,285 surfaces sit on one of the 2,368 anchorless pages of 3,613. Carrying the last anchor across the boundary attributes all 19,987 to **38** ids, and **0 of 19,987** land in the box of the element they would be given to. |
| the chunks that still fail to inflate | **12 of 893 at most** | 1.29 MB stored, which at the 6.16× ratio the rest of the stream reads at is 7.9 MB of 417 MB — about 123 walls against 893 missing. Bracketing each failure by the anchor ids either side puts 12 of the 893 inside a band, against **0 of 900** anchored controls. |
| the geometry is genuinely elsewhere | **supported, ~86–90%** | Nothing else in their own object holds it either: searching every offset for the element's own plan-axis endpoint finds it for 28 of 151, against **0** for a mismatched-target control. |

**Being angled has nothing to do with it.** 11.8% of the export's 2,632 angled walls own no surface, against **13.1%** of its 4,576 orthogonal ones. The diagonals are simply the subset where the fallback box is visibly wrong — an orthogonal wall drawn as its envelope looks right.

And the 67 that *do* own planes are not a missed opportunity either: 33 have a stride-105 triple, **314 triples between them, and not one has all three planes vertical**. They read `uDir.z = 0.3367`, `vDir.z = 0.9416` — facets of a sloped body — and 24 of those elements carry the category `Stairs Stringer Carriage`. `wallSolidsFor` is declining correctly.

**One lead came out of this and it is not the diagonals.** A quarter of every analytic surface in the file sits on a page the owner scan cannot attribute, because the scan starts each page with no owner. The containing object header names its own element at `S+0` and is self-checking through its length echo; used as an owner it scores **81.25%** inside-the-owner's-box against **0.02%** shuffled — better than the shipped anchor rule's 76.80% — and is still a **net loss**, because it displaces anchors mid-blob: 189 elements gain a solid (11 named by the export) and 953 lose theirs (467 named). Restricted to a fallback that can never displace an anchor it adds 18,417 surfaces and 20 elements with a solid, at a median 10.1 ft worst-vertex error with none inside a foot — those surfaces are not wall bodies. Something narrower than "header wins" and wider than "header only before the first anchor" may exist there. It will not recover these 165.
