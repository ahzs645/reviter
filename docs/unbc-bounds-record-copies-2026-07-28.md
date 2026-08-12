# Which bounds copy is the element's, and the solids drawn on the wrong one

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

A Revit 2027 element's duplicated-bounds record holds its extent **twice**, and
the two copies do not always agree. This entry is the investigation that decided
which copy to read, the hold-out that tested the choice on classes it was not
fitted to, the four gaps that survived it, and the misattributed plane triples
that were being drawn over correct records.

## The bounds are written twice, and the tighter copy is the element's

The record's two identical bounds blocks were treated as a single test: if the
copies disagreed, the record was thrown away. That is what was missing the
interior partitions. **994 walls** the export names had no geometry at all, and
looking at their objects, every one of the 757 that could be found failed on
that one check and no other — not the marker, not the id, not the family word,
not the field count.

Their bounds were there the whole time. Searching every offset of those 757 wall
objects for six `f64` reproducing the exported wall, **the block at the second
copy matches for 757 of 757**, and the same search against a deliberately
mismatched wall matches **nothing at all**. Where the two copies disagree, the
first holds something else and the second is the element's own extent.

So one of the two copies is read rather than the record being thrown away, and
disagreement is recorded as evidence rather than treated as disqualifying. The
result, measured against the export:

| | drawn before | drawn now | of the export's count |
| --- | --- | --- | --- |
| `IfcWallStandardCase` | 6,324 | **7,145** | 96.8% |
| `IfcColumn` | 95 | **266** | 85.5% |
| `IfcStairFlight` | 76 | **97** | 80.2% |
| `IfcRailing` | 147 | **173** | 75.5% |
| `IfcDoor` | 1,294 | **1,399** | 73.2% |
| building elements | 29,452 | **30,676** | 80.3% |

The new geometry is in the right place, which is the part that matters: columns
go to **100.0% centre and 100.0% size agreement at 0.000 ft median error** — the
round columns that three earlier investigations could not explain were simply
these records, rejected. Walls hold 96.0% centre agreement across 821 more of
them, members 98.5%, plates 99.9%, railings 94.5%.

This also retires the earlier conclusion that these elements had "no geometry
anywhere in the file". They did. The decoder was asking the bytes the wrong
question.

### Which copy, tested on the classes the rule was not fitted to

"Read the second copy" was derived from 757 walls, and a rule fitted on walls and
then applied to everything is the shape overfitting takes. A second building
would be the proper control; there is only one here, so the substitute is to hold
out the element classes the rule never saw. Over the **5,339 records whose two
copies actually differ** and that join to an export element:

| class | n | median error, first copy | second copy | second wins |
| --- | --- | --- | --- | --- |
| `IfcWallStandardCase` | 4,853 | 0.197 ft | **0.000 ft** | 94% |
| `IfcDoor` | 104 | 3.529 ft | 3.529 ft | 7% |
| `IfcColumn` | 103 | 0.003 ft | **0.000 ft** | 64% |
| `IfcMember` | 81 | **6.187 ft** | 6.187 ft | 4% |

The rule holds on columns, which it was not fitted to, and does nothing for doors
or members — consistent with those classes' error coming from somewhere else
entirely. But taking the second copy unconditionally also admits a handful of
wild boxes, one of them **8,701 ft** across. Choosing whichever copy encloses
less volume — a test the decoder can apply with no export to check against —
keeps the same accuracy and drops the tail:

| rule | mean error | worst case | within 0.05 ft |
| --- | --- | --- | --- |
| always the first copy | 0.538 ft | 23.5 ft | 10.8% |
| always the second copy | 2.009 ft | 8,701.2 ft | 95.9% |
| **whichever encloses less** | **0.380 ft** | **851.9 ft** | **95.9%** |

That is what ships. It takes building elements from 30,676 to **30,679** — the
point is not the three, it is that the worst case shrinks tenfold without costing
anything, on classes the rule was not derived from.

## Four remaining gaps, and which of them are reachable

After the second-copy fix, four things still separate the recovery from the
export. Each was tested rather than assumed, and only one of the four turns out
to be a decoder problem that a rule could reach.

**Curtain walls are held back on purpose, and the suppression is precise.** 1,794
are recovered and 241 drawn; the other 1,553 are containers whose panels and
mullions are drawn in their place. Of the 1,585 envelopes held back as wrappers,
**1,553 are genuinely `IfcCurtainWall`** — the rule mistakes 32 elements, or 2%.
The facade is represented by 15,984 members and 4,973 plates, not by 1,553 boxes
that would hide them.

**Doors are not a choice between the two bounds copies.** Doors are drawn about
2.8 ft oversized, and after the wall fix the obvious guess was that the other
copy holds the leaf. It does not: across 1,398 doors the mean error is **2.767 ft
from the first copy and 2.760 ft from the second**, and the copies differ for
only 7% of them. Both copies are the opening. The door leaf is not in this
record, and no reading of it will produce one.

**Stair components are not either.** A stringer carriage is drawn 10.08 ft tall
where the export's own bounding box is 4.71, and a landing 9.84 ft where the
export has 0.16. Across 79 stair flights the two copies score **4.221 and 4.035
ft** — both wrong, by about a storey. The envelope recorded for a stair
sub-component is the assembly's, not the component's.

**The remaining mullions and panels carry no geometry at all, and this is now
settled by three independent tests.** 3,169 members, 1,090 plates, 426 doors, 36
columns and 15 windows the export names are still missing. Every one of them is
rejected on the same check — the object's marker is `0x07ef` rather than
`0x08c6` — which is exactly the shape of the wall bug, so it was worth asking
whether the marker was again the only thing in the way. It is not:

- running the entire bounds framing on those objects with the marker check
  removed, **0 of 4,707 produce a valid bounds block**;
- searching every offset of 24,620 such objects for six `f64` reproducing the
  element's exported bounding box returns **nothing**, with a mismatched-target
  control that also returns nothing;
- **0 of 4,933** of these elements have an instance-placement object, so there is
  no transform-plus-shared-shape route either. Almost all have exactly one
  object, about 567 bytes long.

So these elements are named in the file, and their position is not. That is the
family-document boundary the type-name decoder already runs into, and it is not
reachable by reading partition records more carefully.

## A solid drawn on the wrong element

Six of the seven elements drawn more than 10 ft past their own export box were one bug, worst 260.3 ft: the bounds record reproduces the export box corner for corner, and a **misattributed plane triple** is drawn over it. `clipSolidToEnvelope` declines to help by design, because a solid wholly outside its envelope is "a disagreement to report rather than a length to invent".

The evidence that the solid is the wrong reading is independent of any box metric: **4 of the 11 stray solids are carried by a second element** — a plane triple is one body — and for 3 of those the co-owner's envelope reproduces the solid's own length and thickness to 0.01 ft. 1501065's box is 0.39 × 29.89 ft against a 29.37 × 0.394 ft solid that was being drawn on 1501060 and 1501062 as well.

`solidBelongsToEnvelope` drops them. 147 of 6,756 solids on records with a real bounds block fail, **11 on records the scene draws**; 6 improved — centre error 252.21, 38.21, 20.07, 14.83, 14.62 and 4.82 ft all to **0.00** — and **0 worsened**.

**Per-class percentages cannot judge this rule and were not used to fit it.** The same containment test against the envelope of the element one id below rejects 3,342 of 5,360 solids, and against a *shuffled* envelope 5,356, and both score **higher** on wall size (95.7% and 97.0% against 92.4%) — because the envelope is the export's own box, so rejecting everything looks like an improvement. The discriminator is specificity: **11 of 5,360, 0.2%, against 62% and 100%.**

Two of the seven are not this bug and are recorded as unreachable. 401861 has no duplicated-bounds record at all, so there is no second reading to check against; the export gives it 0.82 ft where its solid is 14.60, and the reason is visible in the export — a curtain wall fills 77.58 to 90.95 ft between it and its neighbour, so the trim range is the wall *before* the curtain-wall insertion. And 1622190, for a while the assertion's worst case at 19.8 ft, was a **truth-side artefact**: the exporter tags only the ramp's landing and writes its two flights as *untagged* `IfcRampFlight`s, so the element's record box was exactly the union of three products the join could only see one of — fixed by letting an untagged product inherit the single tag of its `IfcRelAggregates` component in `readTruthBoxes`.

**A latent aliasing bug is recorded, not fixed.** 11 solid *objects* in this model sit in two elements' groups, and `clipSolidToEnvelope` mutates solids in place — so clipping one owner's copy mutates the other's. The disown rule removes every drawn instance of it here, but the aliasing remains.

## Second readings, and a note on how this round was recorded

Four rules were added together, all following the pattern `clipSolidToEnvelope` established: **an element is described twice in the partition stream, the two readings are independent, and where they disagree the disagreement is itself the evidence.** None invents a dimension.

- **A railing's ribbon is trimmed to the railing's own envelope.** The sweep draws from the rail path up by the guard height, so the ribbon's *top* reproduces the envelope by construction; its base is the path, and a stair railing's path starts about one riser below the railing it carries. Measured against the export's own railing meshes, **14 of 101 swept railings had their base up to 0.886 ft low and not one had its top wrong** — median top error 0.000 ft. Clipping rather than clamping matters: clamping would lift the first tread onto the landing and flatten the bottom of the run.
- **A solid's elevation band is intersected with the record's**, the same argument as the plan clipping applied to the axis nothing was checking. **This is the sharpest rule here precisely because it almost never applies**: of 5,312 solid-drawn records with a real bounds block it fires on **3** — 1192647, whose record *and* whose export box both read 0.66 ft tall against a solid drawn 9.84 — and all three go to 0.000 ft. Nulls: a shuffled band fires on 579 records and makes **572 worse**; the band of the element one id below fires on 79 and improves **none**. Specificity 3 of 5,312, **0.06%**, against 11% and 1.5%.
- A sketch-based element whose record is a hull over a single planar face takes the thickness its own category is written with everywhere else in the model.

| | before | after |
| --- | --- | --- |
| `IfcWallStandardCase` centre / size | 98.5% / 92.4% | **98.9% / 96.0%** |
| — median size error | 0.073 ft | **0.000 ft** |
| `IfcWall` centre / size | 90.3% / 73.9% | **91.8% / 89.6%** |
| `IfcRailing` size | 91.5% | **100.0%** |
| `IfcSlab` size | 82.4% | **91.2%** |
| `IfcStairFlight` drawn | 91 | **99** |

The 0.073 ft median wall-size error — 0.88 inches, systematic across 7,000 walls and so more likely one wrong constant than 7,000 wrong walls — is now 0.000.

**How this round was recorded, stated plainly.** The three agents that produced it died before reporting. Their rules are verified — 22 assertions pass, 154 tests, and the controls quoted above are their own, written into the source as this project requires. What is *missing* is the surrounding record: the alternatives they tried and rejected, and the negative results they measured on the way. Every other section here can name what was ruled out; this one cannot. That is a gap in the evidence trail rather than in the code, and it is recorded rather than papered over.
