# Doors, windows and openings are bounded by opposite evidence

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

A door, a window and an opening all point at the same class of shape object and
are bounded by different faces of it. This entry is the three rounds that
separated them: cutting a door's leaf out of its swing, reading a window's frame
from the outermost planes rather than the nearest, and establishing that the
openings row of the coverage table was double-counting elements already reported
elsewhere.

## A door's record is its opening plus the swing

A door is drawn 1.46 ft off centre and 2.91 ft oversized, and the obvious explanation — that the record is the opening in the wall — turns out to be only half of it. Against the export the **long** horizontal axis is already right: ratio 1.022, median difference 0.08 ft. The **short** axis is 5.1× too big, 3.50 ft where the export says 0.66. And 86% of the boxes are square in plan. That is not the shape of a door in a wall; it is the shape of a quarter-circle **swing**.

So the leaf is what is left when the swing is cut away: the record's own extent along the wall, the wall's thickness across it, centred on the wall's centreline. Both come from the model — walls rebuilt from native surfaces carry a centreline and a thickness — so no reference file is involved. 1,211 of the 1,459 doors find a host wall, and the door row of the overlay changes completely:

| `IfcDoor` | centre within 0.5 ft | size within 0.5 ft | median centre error | median size error |
| --- | --- | --- | --- | --- |
| before | 0.4% | 0.4% | 1.455 ft | 2.910 ft |
| after | **78.1%** | **54.3%** | **0.000 ft** | **0.261 ft** |

**The leaf is in the door, not in the wall.** The host-wall route above was the first half. A door's *shared geometry object* — the shape its placement points at — turns out to be the **swing**, written in the family's local frame as `[-w/2, -R, 0] .. [+w/2, +t, H]`: the width symmetric about the origin, the height starting at it, and the plan axis the arc sweeps through asymmetric, with the radius on one side and `t`, the door's **own half thickness**, on the other. Over 1,046 doors the median local box is 3.333 × 3.311 × 6.916 ft — square in plan, which is why transforming it untouched scored worse than the record and why reading placements appeared to buy doors nothing.

Folding that axis to `±min(|lo|, |hi|)` is the leaf, and the thickness now comes from the door rather than from whatever wall it sits in. The axis is found rather than assumed, because a mirrored family inverts the sign, and a shape symmetric in both plan axes is declined — folding it would be a no-op that quietly replaced the record with the shape's own box.

| `IfcDoor` | centre within 0.5 ft | size within 0.5 ft | median centre | median size |
| --- | --- | --- | --- | --- |
| the record itself | 0.3% | 0.3% | 1.460 ft | 2.921 ft |
| leaf cut from the host wall | 76.7% | 53.2% | 0.000 ft | 0.277 ft |
| **leaf folded from the door's own shape** | **94.4%** | **87.3%** | **0.000 ft** | **0.000 ft** |

On the 1,067 doors the shape route reaches it is 100.0% and 99.9%, with 1,065 sizes better and none worse. The controls isolate every part: without the fold 0.0/0.0, folding the wrong plan axis 0.0/0.0, a shuffled origin 0.0 on centre, a shuffled basis 26.5 on size, a shape shuffled between doors 53.6, and folding to the *wall's* thickness instead of the door's own 71.0 — which is what taking the thickness from the door is worth. The wall route stays as the fallback for the 442 doors whose shape object cannot be read. Order matters: shape first gives 94.4/87.3, wall first only 83.8/53.3.

The fold stays scoped to doors. The same operation would change 4,153 of 6,480 shared shapes, so it is a fact about door families, not a property of the shape reader.

The route that does *not* work is the element's own parameters. A door type carries a width and a height, but only 305 of the 1,459 doors have a parameter table at all and the parameters in it are the **host wall's** — `Unconnected Height`, `Base Offset`, `Top Offset`, median unconnected height 13.12 ft. Nothing decoded so far gives a leaf's own dimensions; the geometry had to come from the wall instead.

## Windows are bounded by the opposite evidence to doors

A window and a door point at the same class of `0x0810` B-rep and are bounded by *opposite* faces of it. A door's own thickness is the **nearest** y-normal plane, because the furthest is the swing; a window's frame depth is the **outermost** pair, because the nearest is the glass. The door reading also forces `z ∈ [0, longest range]`, which for a window on a sill is a storey out — that was the whole of the 2.208 ft centre error.

The placement was never the problem: all 20 windows carry a correct one, and their plan was already right to 0.32 ft.

An axis's extent is the span of the origins of the planes whose normal is that axis. Trim ranges are never consulted, for the reason the door work established: several patches carry a neighbour's range verbatim, which is why a hull over them is 27.3 × 12.6 × 10.4 ft against a real 6.0 × 1.0 × 4.4 ft window. Where a shape holds a second plane table the two are **intersected** per axis, which is what cuts a casement's swung-open sash.

The gate has two clauses, each measured on its own: every axis's extreme pair must have its own **mid-plane** (exact mean to 1e-6), **and** the box's base must sit above the local origin. That second clause is the discriminator, and it comes from the building rather than from a threshold — **a door leaf stands on the floor, z base 0.0000 for all 257 door shapes; a window sits on a sill, 1.0007–3.0020 ft.** The sill threshold is a plateau: anything from 1e-6 to 1.0 ft selects the same 8 window shapes and 0 door shapes.

| `IfcWindow` | before | after |
| --- | --- | --- |
| drawn | 14 of 20 | **20 of 20** |
| centre within 0.5 ft | 21.4% | **100.0%** |
| size within 0.5 ft | 14.3% | **100.0%** |
| median centre error | 2.208 ft | **0.042 ft** |

The gate fires on 8 of 2,157 `0x0810` shapes and **0 of 228 door, 0 of 29 door-and-opening, 0 of 17 column, 0 of 1,662 unnamed, 0 of 4 opening**. Every other row of the report is byte-identical; doors stay at 99.2% / 99.1%. Null control over 20 trials, never a window's own shape: 63.8% centre / **21.0% size** from the 8 window shapes — high only because 5 of the 8 differ from each other by frame depth alone — and **1.3% / 0.5%** from all 2,157, median size error 3.728 ft.

Four negatives, all measured. Dropping the mid-plane test admits 53 door shapes serving 195 doors and takes doors from 99.5% to **0.0%**. The sill test without the mid-plane test breaks 2 columns from 100% to 0%. A strict "exactly three faces per axis" reaches only the 5 casement shapes and leaves 9 windows wrong. Skipping the table intersection gives 45.0% / 45.0%. And exempting *every* flagged shape from `agreesWithBounds` rather than only face-read ones gains 3 windows and costs **26 columns** — the flag was narrowed instead.

Separately, `readLocalBounds` now refuses a fallback box degenerate on **all three** axes: 368 of the 3,699 objects reaching the `+48` fallback read as six subnormal doubles, 12 of them shapes that placements point at, each drawn as eight identical corners. Flatness on *one* axis is deliberately not refused — 4,077 of 14,876 framed reads are flat on one axis, so it is not evidence of a bad read.

## The openings row was double-counting, and openings must not be drawn

`IfcOpeningElement` looked like the largest absolute gap in the model — 3,071 in the export, 1,772 drawn, 57.7%, 1,299 missing. It is not a gap. **An opening's `Tag` is not the opening's Revit id; it is the id of the element occupying the opening.**

| the Tag actually names | products | drawn |
| --- | --- | --- |
| an `IfcDoor` | 1,903 | **1,641** |
| an `IfcCurtainWall` | 1,013 | 115 |
| nothing else in the export | 124 | 0 |
| an `IfcWindow` | 20 | 6 |
| an `IfcWallStandardCase` | 11 | 10 |

3,071 products carry only **2,965 distinct Tags**, and all 1,820 `IfcRelFillsElement` have filler Tag equal to opening Tag. The row's drawn figure decomposes exactly — 1,641 + 115 + 6 + 10 = 1,772, where 1,641 is the *entire* `IfcDoor` drawn count and 6 the entire `IfcWindow` one. **The row carries no information the other rows do not already carry**, and the "1,299 missing" are 262 doors, 898 curtain walls held back on purpose, 14 windows, one wall, and 124 floor openings.

And they should not be drawn, on three separate measurements:

- **doors** — the export's opening box and the leaf the viewer already draws agree to a median **0.125 ft** at the centre, 89.7% within half a foot, with boxes overlapping on all three axes for **1,640 of 1,641**. Null against another door's leaf: median 397.4 ft, 0.0%. Drawing the opening would put a second box exactly where the leaf is.
- **curtain walls** — the opening is the slot the container sits in; 879 of 1,013 name a record the wrapper rule holds back, median worst corner 0.812 ft. Drawing them *is* the sheet over the panels the wrapper rule exists to prevent.
- **the 124 with an id of their own** are floor and shaft openings, largest 11,620 sq ft. They are already in the model as holes: of the 96 whose host is drawn from a sketch ring, **96 of 96** have the host's ring vertices tracing the opening outline, against **15 of 96** for the same rectangles shifted 37/23 ft. `groupRings` already cuts them, and drawing them as solids would fill the holes they are.

Openings were already excluded from the `building elements` total, and stay excluded — but for a better stated reason than "an opening is a void". The reason is that the Tag aliases another element, so the row double-counts, which is measurable rather than definitional.

**Not done, and stated as such:** using openings to *cut* their host walls. The geometry exists — the code-44 record is the opening plus the swing — but it needs CSG in `buildBoundsMeshes`, and the overlay metric compares boxes, so it could not tell whether the cut was right. Left alone rather than half-done.
