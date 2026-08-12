# Stairs and railings: paths, companions, landings and rake

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

Stairs and railings were the worst classes in the model, and each turned out to
be a different defect wearing the same symptom — a sub-component drawn to its
assembly's vertical band. This entry collects the six rounds that worked through
them: sweeping a railing along its path, finding the path a stair railing files
one id *up*, adopting a stair run's companion record, drawing a landing from its
ring, dropping face sets that outranked the element, and the raked solid that
does not exist in the file.

## Railings are swept along their path, not filled to their box

What was left after the top rails is not something any comparison against the export could have found: 16 of the 165 railings have an axis-aligned footprint over 500 sq ft, the largest **23,877 sq ft**. A railing running around an atrium spans that rectangle, and drawing the rectangle lays a 3.6 ft slab over the floor. The export's bounding box is identical, so the diff reports perfect agreement — only looking at the model shows it.

The path is in the file. 105 of the 165 railings own sketch curves, and the arithmetic that tells a railing's own path from a neighbour's also produces the missing dimension: **a railing's envelope is its path's own rise plus the guard above it**, so the guard is one minus the other. Across the railings whose path reproduces their envelope it comes out at a median of 3.609 ft, and every one of the 68 that pass lands on **3.61 ft** — a handrail height, derived from the file rather than assumed. The third of the paths that belong to a neighbour give guards from −14 to +23 ft and are rejected by that alone.

Each curve is swept as a thin upright section from the path up by the guard, so a railing follows a stair's rise instead of flattening it:

| | before | after |
| --- | --- | --- |
| railings swept | 0 | **68** of 165 |
| of the 16 worst offenders | 0 | **15** |
| plan area filled by railing boxes | 57,962 sq ft | **10,337 sq ft** |

The largest railing is now 113 runs instead of one 23,877 sq ft plate. Coverage does not move — a swept railing is still one drawn railing.

## The railing sweep was silent on the stairs, and wrong where it spoke

The hold-out harness said the sweep reached none of the 41 railings at or below Floor 1. The storey was a proxy: **the lower storeys are where this building's stairs are**, and there are two kinds of railing written two different ways.

| | n | path filed under | path rise | swept before |
| --- | --- | --- | --- | --- |
| record code `101/3` — a level railing | 92 | `id − 1` | 0.00 ft | 70 |
| record code `101/2` — a stair railing | 71 | `id + 1` | the stair's | **0** |

`railPathFor` looked at `id` and `id − 1` only, so it never saw a stair railing's path. `id + 1` is the same convention the stair-companion rule already uses. Not one of the 165 railings owns a curve under its own id, so the `id` half of the union was always dead weight.

**The worse finding is that the arithmetic could not fail.** The guard was `envelope height − path rise`, which for *any* flat curve set returns the envelope height regardless of where in z that curve set sits. Identical railings stack floor on floor, so a neighbour's path a storey away matched in plan and returned exactly 3.609 ft. Measured against the export's own railing meshes, **21 of the 70 swept railings sat a median 8.04 ft from the nearest exported railing vertex**, best case 3.78 ft, recall 0%.

**Nothing caught it, and that is on the project's own harness.** `drawnBounds` in `overlay-diff.ts` had no `railPath` branch, so the agreement table measured the railing's *envelope* while the geometry drawn from it went a storey astray. `IFCRAILING 100.0%` was measuring something the viewer does not draw. That is now fixed, and the fix is its own control:

| | railing centre agreement |
| --- | --- |
| old rule, old metric | 100.0% — blind |
| **old rule, new metric** | **87.2% — the error is visible** |
| new rule, new metric | **100.0%** |

A metric that does not follow the drawing precedence is not measuring the drawing. Note that even at 87.2% the assertion would still have *passed* its 80% floor: the threshold was never the thing that would have caught this, the missing branch was.

The rule now takes the curve set at `id − 1` **or** `id + 1`, judged per owner rather than unioned — a stair railing owns both its path and a flat projection of it — requiring the plan to fit the envelope within 0.5 ft and the base within a new `RAIL_PATH_BASE_TOLERANCE_FEET = 1`, with the guard taken **top-anchored** as `envelope top − path top`. Top-anchoring is not a restatement of the old arithmetic: on the 57 sloped paths, a population 3.609 ft was never fitted on, it gives 52 of 57 at 3.609, where base-anchoring gives guards from −30.9 to +13.5 ft.

| | before | after |
| --- | --- | --- |
| railings swept | 70 | **80** — 49 kept with identical guards, **21 dropped**, 31 added |
| at or below Floor 1 | 0 of 41 | **25 of 41** |
| sweep vs the export's mesh, median | — | **0.76 ft**, against the envelope's 1.65 ft |
| closer than the element's own box | — | **75 of 80** |
| exported vertices covered, median | box 60%, worst 2% | **100%, worst 88%** |
| guard height | 3.609 ft on all 70 | 3.609 ft on all 80, every one within 0.05 ft |

Controls: railing envelopes shuffled among railings fire **0.3 times of 165** over 20 trials against the rule's 80; wrong offsets score ±2 → 3, ±3 → 0, ±7 → 0, ±1001 → 0; the same test on drawn non-railings fires **27 of 35,325**, 0.08%; and a railing's ribbon scored against a *different* railing's exported mesh has recall 0%. The base tolerance is a plateau rather than a fit — 0.75 to 3.0 ft all sweep 78–81 with the same worst case, 5 ft admits 4 more errors and 10 ft admits 8.

Honest residuals. Railing **size** agreement reads 91.5% now, down from a 100.0% that was measuring the envelope; the median size error is 0.003 ft. And 85 railings are still not swept: **46 have a plan-fitting neighbour path whose base is wrong** — the stacked-storey twins, now correctly refused rather than silently drawn — 33 own no curves at `id ± 1` at all, 4 fail the plan test and 2 the guard band. A wider id search finds a plan-matching owner for 158 of 165, but those owners are top rails and balusters at offsets +8 to +40 with no consistent stride; adopting them would be fitting, and it was not done.

## A stair run's own box was in the file, beside it

Stair flights were the worst class in the model, and the reason is mechanical. A run's duplicated-bounds record holds the run's **plan** — exact to 0.000 ft in centre and size — and the **whole stair's storey z-band**. A straight stair has one run per storey, so that band *is* the run's rise and the record looks right by coincidence. A switchback has two runs and a landing inside one band, so each run is drawn to the full storey while occupying half of it. That is the entire bimodal split: of the 49 flights over a foot out, 31 occupy under 70% of the record they are drawn to.

| | n | export flight height | record height |
| --- | --- | --- | --- |
| within a foot | 35 | 9.68 ft | 9.84 ft |
| over a foot | 49 | 5.97 ft | 9.84 ft |

The run's own elevations were never missing. They sit in an ordinary duplicated-bounds record — same `0x08c6` tag, same family word — filed under the run's element id **+ 1**, which is its Sketch element, carrying record code `169671` with one field. **The decoder was already reading all 111 of them** and drawing each as an anonymous element standing beside its oversized parent. The export names none of the 111, and the id below each is a stair run, landing, stringer or stair sketch line in 95 of the 97 cases.

So the owner adopts its companion's box and the companion is held back:

| | before | after |
| --- | --- | --- |
| `IfcStairFlight` centre within 0.5 ft | 44.3% | **84.8%** |
| `IfcStairFlight` median centre error | 1.895 ft | **0.000 ft** |
| `IfcStairFlight` median size error | 3.707 ft | **0.000 ft** |
| `IfcSlab` centre within 0.5 ft | 75.5% | **80.4%** |

The slab gain is the stair landings, which the exporter writes as slabs. No other class adopts anything — for walls, doors, plates, members, columns, railings, windows, coverings, roofs and ramps the count is zero — so this is a stairs-only companion rather than a general rule with a stairs-shaped side effect.

Stair flights are no longer the worst class; `IfcWall` at 68.5% and `IfcDoor` at 78.1% are now below them. What remains is 11 flights the exporter splits into one product per storey for a multistorey stair: the corrected box matches the **nearest single product to within 0.08 ft** and scores badly only against the union of all of them. Drawing one run per storey needs a replication rule, not a better box.

A second route was measured and rejected in favour of this one. A run's own sketch curves — owner exactly equal to the element id, not the id−1 union the railing path uses — do carry the rise, and reach 76.2% within half a foot. But they need a plan-agreement test and a z-overlap test to stay safe (without the plan test they admit a 226 ft box), they land 0.16 ft high because the curves are the boundary edges, and they do nothing for the landings. The companion record needs no tolerances and is exact.

**The converter is deterministic**, which had to be checked before any of this was believed: two runs of the same code on the same file produce identical counts. An apparent 84-against-79 discrepancy between two measurements was two different builds of the library, taken while it was being changed underneath.

**The panels themselves were never the problem.** The complaint that started this was that curtain-wall panels reached further out than they should. Measured against the export, the 13,931 mullions and 4,426 panels drawn from a placed instance's oriented box overhang it by **0.00 ft at the median, with none over a foot**. What was over-reaching was the sheets.

**And the "247 oversized mullions" recorded here were not mullions.** They were attributed to record code `179015/3`, which the audit record previously grouped with mullions because the export types both as `IfcMember`. The RVT says otherwise: 131 of the 267 such records carry their own native category token **`-2000123`, `OST_StairsStringerCarriage`**, and the export names all 258 that join a product `… Stringer 1`, `Stringer 3`, `Stringer 10` of `Assembled Stair:Stair`. The error has a stair's shape too — 200 of the 258 are wrong on **z alone** with their plan footprint exact to half a foot, by a median of 5.23 ft, and the inflated values are storey heights. So this is not a mullion problem at all; it is the same "a stair sub-component carries the assembly's vertical range" limit, and the count is **211 stringers about 5 ft too tall**. The mullion population is clean: of 1,723 mullions drawn from a bounds record rather than a placed box, **one** is over a foot out.

**A rule that would have caught the extremes was tested and rejected.** Two of those mullions are 724 ft and 365 ft long, which is absurd on its face — but "absurd" has to be something the decoder can determine without an export to check against. A category with thousands of members carries its own scale, so the obvious test is to flag an envelope many times the longest side of its category's median. At every cut it costs more than it saves: at 6× it flags 89 envelopes of which **1** is genuinely oversized and **73** are correct; at 20× it flags 6 to catch the same 1. A 274 ft mullion and a 479 ft wall are both real in this building. The rule is not shipped.

## A stair landing is a slab, and was being drawn as a location line

`IfcSlab` sat at 80.4% centre agreement — the worst class in the model that is not a stair or a door — and the hold-out harness said why it was invisible to every other measure: the misses clustered on Floors 2 and 3, and the rule they were blamed on was innocent.

The 13 landings are named `Assembled Stair:Stair:<parent> Landing 1`, carry the native category `Stairs Landings` (−2000920), and the export writes each as an `IfcSlab` with a single `Body/SweptSolid` shape — a profile extruded through a thickness, which is the definition of a sketch-based element. That category was not in `SKETCH_BOUNDARY_CATEGORIES`, so a landing fell through to the rebuilt-solid route instead.

**A plane triple on a landing is not a location line.** Across all 6,346 solid-route elements that join an export product, `Stairs Landings` is the *only* category where the route fails outright: **0.0% centre agreement on 17 elements, median 2.551 ft out**, against walls at 98.0%, columns at 100% and panels at 100%. Four landings were drawn as 0.2 × 0.2 × 1.0 ft stubs where the export has a 3.8 × 8.0 ft slab.

The landing's own sketch curves were in the file the whole time — 21 to 24 each, filed under its own id — and assembled they reproduce the export's own footprint to **0.00 ft at the worst corner, 20 of 20**:

| landings owning a ring, n = 19 | centre within 0.5 ft | median centre error |
| --- | --- | --- |
| drawn from the rebuilt solid | 2 | 2.551 ft |
| drawn from the envelope | 13 | 0.000 ft |
| **drawn from the ring** | **17** | **0.000 ft** |
| control: another landing's ring | **0** | 243.612 ft |

The fix is one category id. `IfcSlab` centre agreement goes **80.4% → 95.1%** and size **71.6% → 82.4%**, landings drawn within half a foot go from 7 of 25 to **22**, and the hold-out rule goes from 76.9% to **87.5%** — Floor 1 to 100%, Floor 2 to 65.5%, Floor 3 to 85.0%. Every other row of the overlay table is byte-identical, and nine of the ten hold-out rules print identical n, accuracy, spread and z.

**The companion-adoption rule was never the problem, and the earlier account of the 24 misses was slightly wrong.** The adopted envelope was already correct — 0.00 ft for 11 of the 12 — and simply never drawn, because `record.solid` outranks it. Scoring each owner against the *nearest single* export product rather than the union also corrects the split: 11 flights **and one landing** reproduce a single product to ≤0.02 ft, so the honest baseline was 12 truth-side artefacts and 12 our defect, not 11 and 13. All 12 residual misses now match a single product to ≤0.02 ft, so what remains is entirely the exporter writing a multistorey stair as one product per storey — which lives on Floors 2–3 by definition, and is the split.

Three negative results from the same work. **A general "envelope beats rebuilt solid" rule is rejected**: over 6,346 solid-route elements it fixes 68 walls and 11 landings and breaks a ceiling, and [the overlay entry](unbc-paired-export-harness-2026-07-28.md#overlay-against-the-paired-export) already records that a global envelope fallback costs 269 of 6,527 records their orientation — invisible to an axis-aligned metric because the export's box is axis-aligned too. Scoped to landings, where a flat slab has no orientation to lose, it costs nothing. **The `id − 1` union hypothesis is true and worthless**: a stair part's Sketch companion sits one *above* it, so the floor convention looked wrong here, but own-only and the union score identically at 17 of 19, so nothing was special-cased. And **the sketch route does nothing for stair flights** — the three that reach it are all per-storey splits.

One residual is recorded rather than papered over: five landings have no duplicated-bounds record at all, so their envelope is synthesised from that same bad solid, 1.00 ft thick where the export writes 0.16. The ring fixes four of their plans and leaves 0.42 ft of z error. That is a recovery gap, not a drawing one, and no thickness was invented for it.

## Native faces were outranking the element itself

Chasing the stair flights turned up something that was never about stairs. The drawing precedence put an element's decoded **faces** above its envelope, and measured against the export across every class that owns faces, the envelope is closer for **168 of the 225** elements concerned:

| class · faces owned | n | faces, centre | envelope, centre | envelope better |
| --- | --- | --- | --- | --- |
| `IfcMember` · several | 112 | 4.62 ft | **2.14 ft** | 61% |
| `IfcStairFlight` · one | 39 | 5.99 ft | **2.59 ft** | 77% |
| `IfcWallStandardCase` · several | 36 | 31.84 ft | **0.00 ft** | 94% |
| `IfcWallStandardCase` · one | 24 | 23.22 ft | **0.00 ft** | 96% |
| `IfcStairFlight` · several | 6 | 78.92 ft | **0.08 ft** | 100% |
| `IfcWall` · several | 4 | 96.31 ft | **0.00 ft** | 100% |

A face set is usually a fragment of an element rather than a shape — half of these own exactly one face, and one face is not a solid. Faces are no longer drawn, and every class that had any improves:

| | before | after |
| --- | --- | --- |
| `IfcStairFlight` centre ok | 31.0% | **41.7%** |
| `IfcStairFlight` median centre error | 4.757 ft | **2.051 ft** |
| `IfcSlab` centre ok | 65.7% | **75.5%** |
| `IfcWall` centre ok | 65.4% | **68.5%** |
| `IfcCovering` centre ok | 97.4% | **100%** |
| `IfcWallStandardCase` centre ok | 96.0% | **96.8%** |

**This reverses [a conclusion recorded earlier in the audit](unbc-element-object-framing-2026-07-28.md#the-elements-that-were-nowhere-are-objects-of-another-class).** A previous pass concluded that preferring the envelope over the faces made stair flights *worse* — 7.95 ft against 5.413. That was measured against a truth map keeping one box per Revit id, so an element the exporter split into several products was compared against whichever piece came last. With the boxes unioned the comparison runs the other way, decisively. The measurement was wrong, not the instinct.

## A raked solid is not recoverable, and the stringers' defect is not rake

Two dozen stair stringers were drawn as axis-aligned envelopes 11–17 ft across where the export gives them 1.3–9.3 ft, which reads on screen as a flat wedge through the building. The obvious fix — the raked analogue of `wallSolidsFor` — does not exist in this file, and the census says so cleanly:

| stride-105 windows on an owned plane run | 31,153 |
| --- | --- |
| three planes mutually parallel | 17,181 |
| and the centre midway between the faces | 6,553 |
| and all three trims equal | 6,495 |
| of the 6,553 — already taken by `wallSolidsFor` | 6,352 |
| — horizontal | 200 |
| — vertical with a tilted in-plane frame | **1** |
| — **raked** | **0** |

Of 82,021 planes, 790 are raked in total, and no three of them anywhere form a centre-plus-two-faces triple, at 1e-6 or at 0.01 ft. What a stringer actually owns is 11–13 consecutive plane records written twice whose normals cycle through mutually perpendicular directions — a **facet list**, not a centre and two faces. A sliding window of three over that list is what an earlier count of "314 triples" was measuring.

**One reading recorded here was wrong.** `uDir.z = 0.3367, vDir.z = 0.9416` was read as a sloped body's facet. Those square to 1.000, which in an orthonormal frame means the *normal is horizontal*: it is a **vertical plane with a rotated frame**. The verdict — `wallSolidsFor` declines — stands; the stated reason did not.

**The stringers' real defect is the z band.** Their plan is right to 0.16 ft, and 208 of the 214 over a foot out are wrong in z alone, carrying the *stair assembly's* band: 1523108–1523114 all read −3.3 to 14.4 ft where their own boxes are 1.3–4.9 ft slices. That band is not recoverable from a companion record (33 of 263 within ±20 ids, 18 of which were already correct; shuffled control 2 of 263), not in the parameter table (0 of 263 stringers carry one), and not from the facet hull outright (12 better, 71 worse of 83).

What works for 78 of them is narrowing the envelope's z to the element's own facets **only where those facets cap it** — the set must hold a face with a vertical normal component both up and down. Unconditionally this is a net loss: `IfcMember` 33.7% → 61.4% but `IfcWallStandardCase` **100.0% → 34.9% with 27 of 43 walls flattened to zero height**, because a wall's attributed facets are a fragment of one vertical face and a vertical face bounds nothing in z. With the cap test, `IfcMember` on the 83 concerned goes 33.7% → **63.9%** centre and its median error 1.811 → **0.082 ft**, while walls, slabs and coverings all decline the rule and stay at 100%. Nulls: giving each accepted element another accepted element's band scores 9.6% and flattens 32 of 83; against a shuffled truth the rule improves 0 elements where it improves 42 against the real one. The cap threshold is a plateau — 1e-9 to 0.5 selects the same 79 elements.

Reach is the limit: **190 of 273 drawn stringers own no surface at all.** Stringers over a foot out go 214 → 187, over 5 ft 116 → 99, over 10 ft 27 → 21.

**The honest alternative was measured and not taken.** Dropping all 273 stringer records costs 262 `IfcMember`, one `IfcStairFlight` and 10 unnamed elements — coverage 92.5% → 91.8%. And it cannot be aimed at "known raked surfaces", because only 83 own facets and those are now the ones drawn *right*: that key would delete precisely the 78 the narrowing fixed.
