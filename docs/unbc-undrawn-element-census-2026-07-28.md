# The census of what is still not drawn, grouped by cause

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

Five rounds chased one class at a time. This entry is the whole undrawn
population measured at once and grouped by **cause rather than class**, which is
the grouping that says what is worth doing next — plus the counting error that
was inflating the gap, where the exporter writes one element as several
products.

## What is actually still missing: the census

Five rounds chased one class at a time. This is the whole undrawn population at once, grouped by **cause rather than class**, which is the grouping that says what is worth doing next.

36,144 distinct Tags carry mesh geometry in the export. **1,171 of them are not drawn:**

| n | share | cause | reachable |
| --- | --- | --- | --- |
| **877** | 74.9% | **never seen** — no pass proves the id exists | **no** |
| **231** | 19.7% | **seen, but no bounds record built** | **the only real work left** |
| 53 | 4.5% | face-hull-only records | **no — measured, below** |
| 6 | 0.5% | wrapper — ordinary walls mistaken for containers | marginal |
| 3 | 0.26% | no drawable extent and nothing else holds them | trivial |
| 1 | 0.09% | the unnamed-plate rule, correctly | correctly held |

Never-seen is 455 `IfcMember`, 158 `IfcWallStandardCase`, 155 `IfcPlate`, 81 `IfcDoor`, 11 railings, 7 columns, 4 coverings, 3 flights, 2 slabs, 1 wall. Seen-with-no-record is 106 members, 40 railings, 29 columns, 21 plates, 17 walls, 5 flights, 5 ramps, 5 doors, 2 slabs and 1 roof — proven by the partition scan alone for 144, by the ElemTable alone for 83, by both for 4. **Null control:** shifting every Tag past any real Revit id puts all 36,144 into "never seen" and 0 into every other bucket, so no bucket fills by set arithmetic.

**Three display gates were suspected of costing geometry and cost none.** No `IfcCurtainWall` or `IfcStair` product carries a mesh in this export — they are pure `IfcRelAggregates` containers — so the wrapper trade this file describes is not merely justified, it is **free**. The sheets rule, the no-class rule, the sub-element rule, the stair-companion rule and the dominant-container rule each claim **0** of the 1,171: they hold back records, and none of those records joins an export mesh.

**The face-hull bucket was the one candidate fix, and the numbers close it.** Of the 53 face-hull records that join an export mesh, **3 are within half a foot in plan and centre — 5.7%** — median plan error **8.81 ft**, worst **199.3 ft**. Splitting by facet count does not rescue it: single-facet hulls, the best case, are 2 of 13; multi-facet 1 of 40. Null control with the truth rotated 12,345 places: **0 of 53** against 3. Releasing the bucket would draw 50 elements wrongly to gain 3. That confirms and extends the 37-of-40 result recorded earlier, on a population it had not measured.

Relaxing the drawable-extent filter is the same shape of loss: 1,267 records have no drawable extent, 232 are claimed by another gate, and of the remaining 1,035 the export names **4** and does not name **1,031**, carrying 131,493 sq ft of plan with six over 5,000 sq ft each. Four named elements for a thousand unnamed sheets.

**The two small classes resolve differently.** `IfcRoof`'s 4 missing are all *seen with no bounds record* — one cause, a recovery gap rather than a display one, exactly the single-rule shape small classes usually have. `IfcCovering`'s 8 are two causes and no clean rule: 4 never seen, and 4 single-facet flat face hulls whose plan reproduces the export to 0.01–1.6 ft — 2 of the only 3 accurate hulls in the entire 53 — but drawing them needs *both* the extent gate and the face-hull gate relaxed, and three of the four carry the category `Sketch Lines` rather than a covering, so there is nothing clean to scope a rule to.

**So the remaining work is one bucket, not many.** 877 elements are not in the readable stream at all, which is the same wall the surfaces investigation hit and closes with more of the file rather than more rules. 231 are *seen and have no record*, and that bucket was then opened.

### Inside the 231, and why the duplicated-bounds decoder was never the gate

Probing every id at byte level, against a 1-in-40 control sample of 875 drawn elements measured the same way:

| n | state |
| --- | --- |
| 90 | the id occurs in the stream but at **no offset that frames as an object** |
| 88 | a **valid framed object exists that the chain never reaches** |
| 53 | the object is chained into the model and still yields no record |

**Only 6 of the 231 carry a `0x08c6` object at all** — 4 rejected on the family word at `+34`, 1 on the field lead at `+42`, 1 accepted. For the other 225 there is no duplicated-bounds record to reject. In the drawn control, `0x08c6` heads 720 of 875 and its gate accepts 719. The bounds decoder was never the problem here; the objects are under other markers — `0x07ef` heads 62 of them, `0x0256` **all 40 railings**, `0x1019` 29 members, `0x0d7b` 5 ramps.

**Looking for an extent under those markers is a dead route, measured.** Searching every offset of all 148 framed objects for six `f64` reproducing that element's own export box at ±0.05 ft — the same search that found the second bounds copy for walls — returns **2 hits, both under `0x08c6`**, and **0 of the 146 objects under `0x07ef`, `0x0256`, `0x1019`, `0x0d7b`, `0x0d40` and `0x1006`**. Null control: 0.

Counting the other routes: 11 have an instance placement whose shared shape never resolves, **1** owns any plane or cylinder patch, and 75 own sketch curves of which only **12 assemble a closed ring**. **207 of the 231 have no geometry source of any kind in the readable stream.**

### A marker's members can speak for the ones with no category token

Of those 12 ring owners, **11 reproduce the export box in plan within 0.5 ft, median 0.000 ft** (null, ring against another bucket element's box: 0 of 12). The shipped ring-synthesis gate is the element's own decoded `BuiltInCategory`, and it reaches none of them, because their token is not written.

The key that *is* in the file is the object marker, and the members of a marker that do carry a token can speak for those that do not. Over 843 record-less ring owners, of which the export names 67:

| gate | selected | named by the export |
| --- | --- | --- |
| own category token (shipped before) | 36 | 36 |
| **marker consensus, support ≥ 3, purity 1.0** | **42** | **42, none unnamed** |
| the same consensus permuted, 10 shifts | 23.1 per trial | 8.0 per trial |

The threshold is a plateau — every floor from support ≥ 1 to support ≥ 7 at purity 1.0 selects the same 42, and loosening to purity 0.7 selects 35. Toggling only this gate: **6 elements gained, 0 lost**, 5 ramps and 1 stair flight. `IfcRamp` goes from 7 drawn to **12 of 12**.

**This supersedes a claim made earlier in this file.** An earlier round rejected marker consensus as "not a category decoder … a listed constant on a population of twelve", on the strength of a model-wide measurement where it gave 4,859 elements a category and the export agreed with 456 while disagreeing with 265. That verdict stands *for that use*. It does not stand for this one: restricted to elements that already own a closed ring and to markers whose token-carrying members agree unanimously, the consensus is measured rather than listed, and it is 42 of 42 against a permuted null of 8.0.

**Honest cost.** The 5 ramps are drawn with an exact plan — 0.000 ft — and the wrong rise, 3.778 ft out, because a ramp's ring is flat and its whole curve neighbourhood is flat, so `ringRecordRise` correctly declines to lend it one. They are drawn as 1 ft plates. `IfcRamp` therefore appears as a new agreement row at 36.4%: the class went from mostly absent to fully present and visibly wrong in z, which is the same trade the windows made before their shape decode was found.

**What is still declined, with numbers.** Of the 67 named ring candidates, 25 remain: 13 under `0x0feb` whose consensus is `Stairs`, an assembly rather than a sketch category; 7 under `0x0f3b` whose 6,993 members are unanimously `Walls`; 4 under `0x0d40`, whose 20 members carry **no category token at all**, so there is nothing to reach consensus on; and 1 at purity 0.35. Reaching any of them means dropping the purity floor or the sketch-category restriction, which is what the 843-candidate baseline measures the cost of.

**A caveat on the coverage denominator, since it cuts the other way — now measured.** 1,919 of the Tags counted in `building elements` are containers the export gives no mesh of their own, `IfcCurtainWall` and `IfcStair`, so a single figure was measured partly against elements there is nothing to draw for. The table now prints both:

```
building elements        38076                      35338    92.8%    36157     97.0%

1919 of the 38076 are containers the export gives no mesh of their own,
so the last column is the share of what could be drawn at all.
```

**92.8% of what the export names; 97.0% of what it draws.** Both are true and neither alone is the whole statement. A class with no mesh anywhere prints a dash rather than 0.0% in that column, because "none of its elements are drawable" and "none of them are drawn" read identically as a percentage and mean opposite things.

## The exporter writes some elements several times, and the coverage table was counting them

`IfcStairFlight` read 86.9% centre agreement and 82.6% drawn. Both figures were artefacts of counting export **products** where the join key is a Revit element **id**.

Scoring every drawn flight against the union of its Tag's products and against the single **nearest** product separates the two cleanly:

| products per flight | n | union centre | nearest centre |
| --- | --- | --- | --- |
| 1 | 88 | 100.0% | 100.0% |
| 2 | 11 | **0.0%**, median 4.92 ft | 100.0%, median 0.017 ft |
| 3 | 1 | **0.0%**, median 9.84 ft | 100.0%, median 0.010 ft |

**The export proves this by itself, with no reference to the RVT.** All 12 multi-product Tags are *congruent* — identical plan corner, identical size to 0.01 ft — offset in z by exactly **9.84 ft per product, one storey**. The union error is exactly half that pitch or the whole pitch, and the size error is exactly the pitch. Every one is named `Assembled Stair:Stair:<parent> Run n` on 2–3 consecutive storeys.

So the honest figure is **100.0% centre and 100.0% size on 100 drawn flights**, with a residual *replication* gap of 13 products on 12 elements, which is not a geometry error.

**The nearest-product reading is not generically generous**, which is what makes it evidence rather than a softer ruler: across classes where the recovery draws every product it is *worse* — `IfcRailing` 100.0% → 95.1%, `IfcSlab` 95.1% → 88.2%. It is better only where the recovery draws one element and the export writes it once per storey.

And this is not stairs-specific, only visible there: of the 92 Tags the exporter writes as several products, **74 are replicas** — 49 `IfcMember`, 13 `IfcRailing`, 12 `IfcStairFlight`, 3 `IfcSlab`. The 15 multi-product `IfcSlab`s are genuine multi-region floors. Stair flights are simply the only class small enough for 12 replicas to move a percentage.

**The coverage table now counts elements.** It counted products, so an element the exporter wrote three times counted three. Correcting it changes the denominator from 38,222 to **38,076** and these rows:

| | counted by product | counted by element |
| --- | --- | --- |
| `IfcStairFlight` | 121 in export, 82.6% drawn | **108, 92.6%** |
| `IfcSlab` | 161, 93.2% | **107, 95.3%** |
| `IfcRailing` | 229, 76.0% | **215, 76.3%** |
| building elements | 92.5% | **92.6%** |

**One real defect was hiding behind the artefact.** 1842441 was drawn 16.90 × 17.06 × **0.00 ft** where the export writes 16.90 × 17.10 × 9.68 — plan exact to 0.02 ft, rise zero. Its record is synthesised from its boundary ring, and a stair run's ring is flat, so it was extruded from its base to its base. `ringRecordRise` takes z from the element's *own* curve set when the ring is flat, the curve set is not, and the two bands meet — the same `bandsMeet` guard, so a stacked twin a storey away cannot lend a rise. **Specificity: 2 of 38,960 records move**, and a full before/after record diff shows nothing else in the model changes. The two other flat-ring records are ramps whose whole curve neighbourhood is flat, and the rule declines both.

**Negative result.** Reconstructing the multistorey extent is not reachable: it does exist in the file — parent assembly 1988738's record spans three storeys, 1498360's two — but only **3 of the 12** parents have a record at all, and nothing decoded links a run to its parent. Not attempted.

**Both readings are now printed, because neither is right alone.** The agreement table carries `nearest c`, `nearest s` and `split` beside the union columns:

```
IFC product type         drawn  centre ok  size ok  median dc  median ds  nearest c  nearest s  split
IFCSTAIRFLIGHT             101      88.1%    88.1%      0.021      0.041     100.0%     100.0%     12
IFCSLAB                    102      95.1%    91.2%      0.000      0.000      99.0%      94.1%     16
IFCMEMBER                19120      99.1%    98.9%      0.000      0.000      99.2%      99.0%     35
IFCWALLSTANDARDCASE       7186      98.9%    96.0%      0.000      0.000      98.9%      96.0%      0
```

A class where the two agree and `split` is zero is settled. A class where they diverge *and* `split` is non-zero is asking a **replication** question rather than a geometry one. Stair flights are the extreme, 88.1% against 100.0% on 12 replicated elements. Slabs move only 95.1% → 99.0% on 16 splits, and that is the reading working correctly: some of those are genuine multi-region floors, where drawing one region of three *is* a miss and the union rightly still penalises it.
