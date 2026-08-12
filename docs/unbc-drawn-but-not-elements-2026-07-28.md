# Geometry that is drawn but is not a building element

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

Asking what stuck out past the building found geometry that was being drawn
correctly and should not have been drawn at all — a floor's own boundary sketch
extruded into a second slab, storey-sized plates no category claims, a railing's
top rail carrying the railing's envelope, and a loadable family's cached shape
sitting at the model origin. This entry is how each was identified and what
holding it back cost.

The same round also produced four results that belong with their own subjects and
are recorded there: [the railing sweep](unbc-stair-and-railing-geometry-2026-07-28.md#railings-are-swept-along-their-path-not-filled-to-their-box),
[the door leaf cut out of the swing](unbc-door-window-opening-geometry-2026-07-28.md#a-doors-record-is-its-opening-plus-the-swing),
[face sets outranking the element](unbc-stair-and-railing-geometry-2026-07-28.md#native-faces-were-outranking-the-element-itself),
and [a stair run's companion record](unbc-stair-and-railing-geometry-2026-07-28.md#a-stair-runs-own-box-was-in-the-file-beside-it).

## Sheets: geometry that is drawn but is not an element

Overlaying the recovery on the export and asking what sticks out past the building found thirteen records reaching more than a foot beyond the export's own hull, one of them by **89 ft**. Nine were the same thing twice over.

**A floor's boundary sketch, extruded into a second slab.** Revit keeps a sketch-based element's boundary as an element in its own right, one id below its owner:

```text
1495202  142 × 156 × 0.66 ft  z 43.3  Floors    in the export
1495201  142 × 156 × 0.00 ft  z 44.0  (none)    not in the export
```

Same footprint, no thickness, no category, sitting on top of the floor it belongs to — and the scene was drawing it as a second slab hovering over the first, on every floor in the building. The test is the pairing rather than the shape: no category, no thickness, a ring instead of a solid, and an element one id above with the same plan extent within half a foot. That is **39 records**, and the export names none of them. As a null control, the same shape never occurs on an element that *does* have a category.

**Storey-sized plates that no category claims.** Size alone proves nothing — the largest real slab here is 371 × 686 ft, bigger than any of these. Size *with no decoded category* separates them completely: of the **50** envelopes over 10,000 sq ft that carry a category the export names **49**; of the **22** that carry none it names **none**. A 100 × 100 ft plate that nothing claims is not a building element, and drawing it lays a sheet across the model.

Both are held back the way curtain-wall wrappers already are — omitted from the scene, kept in the record set, reported in the caveats — so nothing is deleted and the coverage table's `recovered` column is unaffected. Records drawn past the export's hull fall from **11 to 2**, and every per-class drawn count is unchanged: the total stays 30,679, with uncategorised drawn down from 472 to 415.

What remains outside the hull is one wall, by 14 ft, and one door, by 3 ft.

Two floors appeared in that list until the measurement was corrected. The probe read each record's *envelope*, but the scene draws a sketch-bounded element from its **ring**, which is a different and usually smaller thing — `buildBoundsMeshes` prefers loops over the oriented box over the envelope, and the probe had that order wrong. Measured the way the viewer actually draws, those two floors are inside the building and the stray count before this change was 11, not 13.

**Railings.** Nobody had looked at them, and they hold the same pattern one level down. `Stairs Railing` itself is sound — 164 of 165 join the export and their median overhang is 0.00 ft. But Revit models a railing's **top rail** as its own element carrying the *railing's* envelope, and the IFC exporter folds it into the one `IfcRailing`: the export names **none** of the 178 here, and 158 of them reproduce a drawn railing's plan extent to within half a foot. Each was drawn as a second plate lying along a railing already in the scene. Those 158 are now held back; the 20 whose railing was never recovered stay, because there they are the only trace of it. Nothing moves in the coverage table.

The evidence for that rule is the duplicate footprint and nothing else. A first attempt also required the sub-element to be thin, on the reasoning that a handrail is thin — and it kept 99 of them, because a top rail on a stair carries the railing's whole rise, up to **24.9 ft**. The thickness test kept precisely the ones that hide the most.

The neighbouring categories look like drawing aids by their names and are **deliberately left alone**: the export names 18 of 20 `Stairs Paths`, 12 of 12 `Stairs Sketch Boundary Lines`, and the one `Sketch Lines` record — as stairs, stair flights, and a covering. Those are real elements whose category was inherited wrongly, and dropping them by name would take the building with them.

## Cached shapes are not building elements

A loadable family stores its shape once and places it many times. That cached shape is an ordinary object in the partition stream, and it carries the same bounds sub-record an element does — so it was being decoded into the model as though it were an element. Its box is in the family's own local frame, so it landed at the model origin.

The scale of it: **9,655 of 42,348 records — 22.8% — were centred within 50 ft of the origin**, a window that is 1.1% of the building's footprint, and only 3.9% of them corresponded to anything in the paired export. Everywhere else in the model 93.8% of records match. The view had a solid blob of several thousand boxes sitting in the middle of the building.

The file names them, so they do not have to be guessed at from position: an instance's trailer points at the shape it uses, and the referenced set is read straight out of the placements. In the supplied project 6,627 shape ids are referenced, **6,013 of them were being drawn as elements, and 97% of those sat at the origin**. No id is both a shape and an instance, so removing them cannot take an element with it.

The cost is 13 counted elements: one stair flight that was drawn correctly, and six `IfcStair` containers that carry no geometry in the export at all. That is why the stair rows above go down. Removing roughly 6,000 phantom boxes for one correctly drawn element is worth it, and the drawn set goes from 75% real to **89% real**.

**A shape's bounds are not at a fixed offset.** `readLocalBounds` read six f64 at `+48`, which is the `recordCount == 1` case of the same `42 + 6 * count` framing the element bounds record uses — so every shape with a longer field table was rejected, 12,038 of them. Reading the count-derived offset, with the duplicated-block check that makes it safe, recovers 4,874 more and takes resolved placements from 19,356 to **21,257**.
