# The paired-export harness: assertions, hold-outs and the geometric overlay

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

Every rule in this decoder was fitted on one building, and the cheapest defence
against a rule that only works on that building is to make checking a second one
take one command. This entry records the assertion harness, where its thresholds
come from, the hold-out that partitions the one building two ways, and the
geometric overlay the assertions are computed from.

## One command to check a model

Every rule in this decoder is fitted on one building, and there is no second one on this machine to check them against. What can be built now is the harness that makes the second one cheap, so `scripts/verify-pair.ts` runs the coverage audit and the geometric overlay in a single conversion and then **asserts** the things the rules were written to guarantee:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc   # exit 1 on any failure
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc --json > run.json
```

Twenty-two assertions, each named after the rule it guards, so a rule that does not generalise fails loudly rather than quietly drifting: per-class centre agreement floors for the six classes the bounds work put at 96–100%, the door-swing geometry, the railing guard height, the share of sheets held back, a tripwire on records drawn past the export's own hull, and four **firing** assertions. Four of the thresholds are worth reading for their reasoning, which is in the file's header:

- **records outside the hull is budgeted at 6, not a percentage.** Before the sheets rule this model drew 11 records past the hull; a 0.1%-of-drawn budget would have been 31 and would not have caught it. The gate is sized to fire on the state the rule exists to fix. It now reports **0**.
- **the guard-height band is 2.5–4.5 ft, narrower than the decoder's own 1.5–5 ft filter.** Asserting the filter back would be untestable — every survivor is inside it by construction.
- **hull overhang is capped at 200 ft**, which guards the tighter-of-two-copies rule specifically: always taking the second copy admitted a box 8,701 ft across.
- **an element may not be drawn far past its own export box.** `no-records-outside-hull` measures against the whole building's hull, so a wall drawn a hundred feet from where it belongs while staying *inside* the envelope passes it — and the per-class size percentages cannot see it either, because they are counts and a handful of monsters cannot move a figure over 7,000 walls. Measured per element against that element's own truth, **35 of 35,720 drawn** reach over 10 ft past their own box: one wall at **260.3 ft**, and about two dozen raked stair stringers drawn as axis-aligned envelopes 11–17 ft across where the export gives them 1.3–9.3 ft. The budget was 40 when this was written; it is **26** in the source today (`MAX_ELEMENTS_OVER_OWN_BOX` in [`scripts/verify-pair.ts`](../scripts/verify-pair.ts)), tightened once the residue had been characterised, and the assertion's own header records the count since falling to 0.
- **the tail-placement read is asserted as a share, not a count.** Nothing here originally asserted that a rule *fires* at all, only that what it produced was accurate — so a rule that silently stopped firing would pass every threshold. Four assertions now check reach. A floor of “≥ 1” would not have caught the one that mattered: the tail-placement read placed **3** elements when it was broken against 4,328 now, so it is sized at ≥ 1% of the members and plates in the export. Each firing assertion skips rather than fails when the export holds too small a population to judge.

Doors, `IfcWall`, slabs and stair flights sit at 78/68/75/44% and are **deliberately not** given floors: pinning them would assert known decoder gaps rather than detect a broken rule. A class the export does not contain reports `skip`, not `pass`.

**The gate has its own control.** A gate that cannot fail is decoration, so every `Tag` in the export was shifted past any real Revit id and the harness re-run: coverage went to 0.0% and failed, the eight join-dependent assertions reported `skip` with their reason rather than passing vacuously, and the three RVT-only assertions still passed. That run also caught a nonsense message in the output, since fixed.

### Holding out halves of the one building

Every threshold above is measured on the whole model, which cannot distinguish a rule that is right from a rule that was fitted to where in this building it happened to be measured. `scripts/holdout.ts` partitions the building two ways no decoder rule can have keyed on and reports each rule per partition:

```sh
node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc   # exit 1 on any silent rule
node --experimental-strip-types scripts/holdout.ts --cache               # re-derive in 2s, no models needed
```

- **by storey** — the export's `IfcBuildingStorey` containment, propagated down `IfcRelAggregates` so a curtain panel inherits its wall's storey. That covers **100% of the 38,226 tagged products** across 13 storeys, Floor 0 at −7.2 ft to Floor 6 at 55.8 ft. Anything with no product falls back to elevation bands, and every rule prints what share of its population took the fallback.
- **by wing** — the export hull's longer plan axis, halved.

A spread only counts as a split if it also clears a pooled two-proportion `|z| > 2`; without that, an 18pp gap on n=36 reads as a finding when it is a coin toss. Storeys too thin to compare are pooled into halves so there is still a storey test.

**Six of seven rules hold on parts of the building they were not fitted to. Two reports did not come out clean, and both are reach rather than accuracy — which is exactly why no threshold above saw either:**

- **the railing sweep is silent below Floor 1.5.** Its guard height is 3.609 ft on all 70 railings it reaches, on every partition, so the arithmetic generalises perfectly. But it reaches **0 of the 41 railings at or below Floor 1** — 0/1, 0/10, 0/21, 0/9 — against 70 of the 124 above. This is the failure mode a pass-rate cannot express: a rule can be flawless on what it touches and still be wrong about the building, because it never touches half of it. Chasing it down found something worse than silence, and is [the railing-sweep entry](unbc-stair-and-railing-geometry-2026-07-28.md#the-railing-sweep-was-silent-on-the-stairs-and-wrong-where-it-spoke).
- **stair companion adoption splits by storey**, 95.2% on Floor 1 against 55.2% on Floor 2 and 65.0% on Floor 3, z=3.1. Of the 24 owners still over half a foot out, 11 are the flights the exporter splits one product per storey — a truth-side artefact — and **13 are landings the export writes as slabs**, 20 of the 24 on Floors 2 and 3. The premise itself is spotless: the export names 0 of 117 companions, on every partition. Chasing the landings down is [the landing entry](unbc-stair-and-railing-geometry-2026-07-28.md#a-stair-landing-is-a-slab-and-was-being-drawn-as-a-location-line); it took the rule to 87.5%, and what survives is the exporter's split alone.

Two results worth reading past the verdicts. **The tail-placement window is right rather than fitted**: searching 80–240 bytes back instead of 125–149 finds 1,331 extra candidates, of which only 143 join an export element and **24** reproduce it. Scoring raw candidates made this look like a 98pp split, which was the probe's own false positives; framing the population as *placements that reproduce the export* gives 99.9% everywhere. And **the 10,000 sq ft sheet rule holds back exactly one element the export names** — 1522385, an `IfcMember` with a 61,572 sq ft footprint, which is to say a misparse.

**What this does not establish.** Every partition shares this file's Revit release, exporter version, family library, practice conventions and structural grid. Partitioning can catch a rule fitted to *where in the building* it was measured — a real failure mode, with precedent here — and cannot catch one fitted to any of those four. It is not a substitute for a second file. That caveat is in the script header, printed above its first table, and carried in the JSON's `caveat` field.

## Overlay against the paired export

Counting elements answers whether something is present. It cannot answer whether it is in the right place, and an element can be drawn and drawn wrong. `scripts/overlay-diff.ts` puts both models in one frame and measures the disagreement:

```sh
node --experimental-strip-types scripts/overlay-diff.ts model.rvt model.ifc
```

`web-ifc` returns metres in a Y-up frame and the recovered model is feet, Z-up, so the export is mapped through `(x, y, z) → (x, −z, y)` — the same mapping `ifc-reference.ts` already applies — and scaled. The comparison is against the geometry the viewer actually **draws**, following the same precedence `buildBoundsMeshes` uses, because for a placed family the drawn shape is its oriented box rather than its axis-aligned bounds.

| IFC product type | drawn | centre ok | size ok | median centre error |
| --- | --- | --- | --- | --- |
| `IfcMember` | 15,944 | 98.6% | 98.4% | 0.000 ft |
| `IfcWallStandardCase` | 7,145 | 96.8% | 55.2% | 0.084 ft |
| `IfcPlate` | 4,973 | 99.9% | 99.7% | 0.000 ft |
| `IfcDoor` | 1,399 | 78.1% | 54.3% | 0.000 ft |
| `IfcColumn` | 266 | 100.0% | 100.0% | 0.000 ft |
| `IfcRailing` | 163 | 100.0% | 100.0% | 0.000 ft |
| `IfcWall` | 127 | 68.5% | 40.2% | 0.209 ft |
| `IfcSlab` | 102 | 75.5% | 61.8% | 0.000 ft |
| `IfcStairFlight` | 84 | 41.7% | 40.5% | 2.051 ft |
| `IfcCovering` | 38 | 100.0% | 100.0% | 0.000 ft |

"ok" means within half a foot on every axis.

**The wall size column was two-thirds measurement error.** This file used to explain it away: "the record is the wall as modelled, before Revit's join trimming, and the difference is half a wall thickness". That is wrong about the record. For the 106 `IfcWall` and 6,045 `IfcWallStandardCase` elements that carry a real duplicated-bounds record, **the record reproduces the export's box corner for corner** — within 0.001 ft for 100.0% and 99.4% of them. The as-modelled reading is the **solid**, which the viewer draws over the record, and 33 of 110 `IfcWall` solids run longer than the wall's own location line by a median of 6.07 ft.

On top of that, `overlay-diff.ts` was measuring solids wrong. A solid is drawn as an *oriented* box, offset from its centreline by half a thickness along its own normal; the script added half a thickness to **both** x and y, which reports a box a full thickness too long. For a 25.242 ft wall 1.148 ft thick it printed 26.390. Correcting the measurement alone, with no change to what is drawn, took `IfcWallStandardCase` size agreement from 55.3% to **83.4%** and `IfcWall` from 40.2% to **59.1%**.

Then clipping each solid's centreline to the element's own envelope — two independent readings, so the shorter is not a guess — gives the rest:

| | shipped | metric fixed | and clipped |
| --- | --- | --- | --- |
| `IfcWallStandardCase` centre / size | 96.8% / 55.3% | 96.8% / 83.4% | **98.6% / 92.4%** |
| `IfcWall` centre / size | 68.5% / 40.2% | 68.5% / 59.1% | **90.6% / 76.4%** |

`IfcWall` here is not a stacked wall or an in-place family: all 140 are `Basic Wall:Interior Wall`, and what distinguishes them is the *body* the exporter writes — 88 faceted `Brep`s and 43 multi-extrusion `SweptSolid`s against 7,336 single extrusions for `IfcWallStandardCase`. A profile-edited wall is exactly the case where a trim range off the centre plane stops describing the wall.

Clipping to a **shuffled** envelope fixes 0 and breaks 7; clipping to the envelope of the element one id below — a genuinely nearby box — is +421 against −944. The gain needs the element's own envelope. Falling back to the envelope outright wherever a clipped solid still disagrees by over half a foot scores better again, `IfcWall` at 92.9% / 88.2%, but costs 269 of 6,527 solid-drawn records their orientation, and an angled wall drawn as its axis-aligned box is an error the metric cannot see because the export's box is axis-aligned too. Measured and not taken, for the same reason railings are swept rather than boxed.

**Two artefacts were removed from the drawing, both found by asking what reaches past the building.** A bounds record whose reserved word at `+22` is non-zero without an all-ones record code is corrupt: across 42,333 records that word is zero in 41,124 and `0xffffffff` in 1,206 — every one of those paired with an all-ones code — and exactly **three** match neither. All three are broken, one of them the model's worst envelope, a stair stringer drawn **724.6 ft** long whose code word has had its high half overwritten. Rejecting them costs no correct element — with one qualification worth stating: the export does name two of the three, and while one has no usable bounds copy either way, the other's surviving copy *is* the 724.8 ft stringer. So the rule costs one named element its geometry; that geometry was the wrong geometry. Separately, an element whose only geometry is a hull over the faces attributed to it is no longer drawn: **37 of the 40** such elements that join a product are over a foot out, median 7.96 ft, one of them a 0.2 × 0.5 × 4.3 ft mullion drawn as a 168 × 366 ft hull over faces that are not its own. The record is still synthesised, because it is what lets a sketch ring attach later — removing the synthesis outright cost 15 coverings and 13 slabs that were being drawn correctly from rings they only had because the record existed. Together these take records reaching past the hull from 1 to **0**, and cost 51 elements their geometry out of 30,679.

**One element can leave the exporter as several products.** A floor sketched in three regions becomes three `IfcSlab`s, each carrying the same Revit id in its `Tag`. The script kept the last box it saw for an id, so an element that exported as three regions was compared against whichever region came last, and the recovery — which draws all three — looked oversized by the distance between them. That produced a floors-are-drawn-too-big result that was entirely an artefact of one line: **20% of slabs measured over a foot out; unioning the boxes for a shared id puts it at 3%**. Railings went from 6% to **0%**. It did not rescue stair flights, which are genuinely oversized, and it does not touch `audit-coverage.ts`, which asks only whether an id is present. The wall size column is expected rather than wrong: the record is the wall **as modelled**, before Revit's join trimming, and the difference is half a wall thickness.

**The scene was framed to the wrong place.** The origin was the midpoint of the absolute extent of every drawn record, so the handful of misparsed envelopes that land thousands of feet from the building dragged it with them — the supplied model's centre came out at `177.4, 448.5, −56` where the export puts the building at `−5.4, 287.6, 24`. The camera opened on empty ground. Ignoring one part in a thousand at each end of each axis puts it at `−1.5, 287.3, 21.7`, within **4 ft**. Nothing is discarded; this decides only where the viewer looks.

**A placed box is now checked against the element's own envelope.** An instance's oriented box and its duplicated-bounds record are independent readings of the same element, so their agreement costs nothing to test. For curtain-wall mullions and panels — 18,357 elements — they agree to 0.000 ft and the box is exact. For doors they disagree by 7.15 ft, and the box is wrong by that full amount while the record is wrong by 2.75: the shared shape a door instance points at is not the door's own extent. Using the box only where it agrees leaves members, plates and columns untouched and takes the median door error from **3.458 ft to 1.426 ft**. 942 of 19,356 placed boxes are rejected this way.

Stair flights remain wrong at 5.4 ft and are not addressed here.

**Where the unrecovered elements actually go.** Joining the export's family and storey data to the elements that never appear shows the losses are not spread evenly:

- **round columns** account for most of the 149 columns that are seen but yield no geometry — 75% of `Round Column:24" Diameter`, 87% of `20"`, 89% of `16"`. Cylinder surface patches exist in the file but only 146 of them, so a round column is not stored as a cylinder patch; 47 of these columns are instances whose shared shape never resolved.
- **5,260 of 24,616 instance placements reference a shared geometry object that is never read.** 1,637 of those objects are found in the chain and rejected, because `readLocalBounds` reads the local AABB at `+48` and these larger objects do not keep it there. An offset search against the export found no consistent alternative, so the layout is still open. This costs 540 elements outright and coarsens the rest.
- **ramps and windows are simply absent** — 7 of 12 ramps and 15 of 20 windows appear nowhere in any pass, so there is nothing to place.

## Paired regression workflow

After opening an RVT, choose its matching IFC export in the **Regression fixture** panel. Both files remain local. Reviter then:

1. parses native IDs from `Global/ElemTable`;
2. detects every strict nested duplicated-bounds record in each decompressible `Partitions/*` page and inventories leading-u32 evidence;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join remains diagnostic evidence. A duplicated-bounds record is stronger. Correlation against the supplied IFC joins 25,180 unique recovered IDs to known IFC products/types and yields strong record-code clusters for walls, doors, panels, members, columns, railings, slabs, roofs, coverings, and windows. This validates the record as an element envelope and supports the supplied-model display classification, but it still does not prove a native shape or a universal Revit object class mapping.
