# Coverage of the supplied building, measured against its paired export

> **These are observations from dated runs on one building**, the supplied
> 67 MB Revit 2027 project, not standing facts about Reviter. Each figure was
> measured once, on the model and the code as they stood on the date given, and
> nothing re-derives them: there is no model file in this repository, so no test
> and no CI job recomputes any number below. Read them as a record of what was
> seen and why a rule was written the way it was. Recorded 2026-07-28 and 2026-07-30; moved out of
> the README on 2026-08-12.
>
> These entries were one continuous document until that date, so a
> cross-reference to something "above" or "below" — or to "this file" — means
> somewhere in the audit record, which is now this directory. Pointers that
> landed in a *different* entry have been turned into links; the rest still read
> correctly within the entry they are in.

These are the point-in-time coverage measurements of one building. They were in
the README, where they read as standing facts about Reviter; they are not. Each
table is one run of one script against one pair of files on one date.

## First, which coverage figure is which

Three different drawn-coverage percentages were in circulation for what read as
the same metric — **95.2%**, **92.8%**, and **80.3%** — and the reconciliation is
that they *are* the same metric, measured on three different dates. There is one
computation, in
[`scripts/audit-coverage.ts`](../scripts/audit-coverage.ts)'s `computeCoverage`:

```
totals.drawn / totals.inIfc
```

where both sides are counted by **distinct Revit element id** (not by export
product), across the reported IFC classes with `IFCOPENINGELEMENT` excluded, and
`drawn` is the set of ids that survive `selectDisplayBounds` — the scene's own
selection, re-run so the audit reports what the viewer draws rather than a set
assembled a second way. `verify-pair.ts` does not recompute it: its
`building-element-coverage` assertion reads `coverage.totals` from that same
function.

So the three figures are one number's history:

| Figure | Reading | Date | What moved it |
| --- | --- | --- | --- |
| **80.3%** | 30,676 of 38,222 | before 2026-07-28 | measured while the denominator still counted export *products*; the by-element correction below took it to 38,076 |
| **92.8%** | 35,338 of 38,076 | 2026-07-28 | after the instance-placement read (80.1% → 90.1%), the element-counted denominator, and the salvaged DEFLATE prefixes (92.6% → 92.8%) |
| **95.2%** | 36,255 of 38,076 | 2026-07-30 | after the native-mesh admission work in commit `46de96a`, which took drawn elements 36,229 → 36,255 with every per-class agreement figure unchanged |

**95.2% is the most recent reading of the three.** None of them is re-derived by
anything: they are three snapshots, and a fourth run today would give a fourth
number.

One consequence worth naming: the header comment of
[`scripts/verify-pair.ts`](../scripts/verify-pair.ts) still quotes the 80.3%
observation in its table of "observed on unbc" values. That table is a record of
what each threshold was sized against, not a claim about current coverage, but it
is two generations behind the figure above and should be read that way.

## Verified against the paired IFC export

`scripts/verify-pair.ts` scores the recovery element by element against an IFC exported from the same model. The export used here declares `NumberOfSaves: 326`, matching the RVT's own `uniqueDocumentIncrements`, so the two are the same save rather than two versions of the same project.

**36,255 of 38,076 export products are drawn — 95.2%** — and no record reaches past the export's hull at all. Centre and size agreement, within 0.5 ft on every axis:

| IFC product | drawn | centre ok | size ok | median centre error |
| --- | --- | --- | --- | --- |
| `IFCMEMBER` | 19,652 | 98.9% | 98.6% | 0.000 ft |
| `IFCWALLSTANDARDCASE` | 7,381 | 99.3% | 98.5% | 0.000 ft |
| `IFCPLATE` | 6,235 | 99.9% | 99.8% | 0.000 ft |
| `IFCDOOR` | 1,912 | 100.0% | 99.9% | 0.000 ft |
| `IFCCOLUMN` | 311 | 100.0% | 98.7% | 0.000 ft |
| `IFCRAILING` | 215 | 98.6% | 98.6% | 0.011 ft |
| `IFCCOVERING` | 46 | 100.0% | 100.0% | 0.000 ft |
| `IFCWINDOW` | 20 | 100.0% | 100.0% | 0.042 ft |
| `IFCRAMP` | 11 | 100.0% | 100.0% | 0.000 ft |

Two assertions failed on first run. One is fixed below; the other is characterised and left standing, because a failing assertion that names a real gap is doing its job:

- **`no-element-past-its-own-box`** — 27 elements were drawn more than 10 ft past their own export box against a bound of 26 when this was written. The worst was element **1622190**, a ramp, at 19.8 ft, followed by five `Stairs Stringer Carriage` elements at 14.1–16.6 ft, all sloped stair and ramp parts. The count has since fallen to **0**: the truth join now follows `IfcRelAggregates`, so an untagged flight inherits its aggregation component's one tag and 1622190's landing-only truth box dissolved; the analysis below is retained because it is what characterised the residue.

  Three things are established about them and are worth recording before anyone chases the rest. **They are not proxy/native duplication**: no element in the model is drawn as both a native mesh and an envelope proxy, so the overhang is not two representations of one element being unioned. **They split into two distinct causes.** For 1622190 and the 1523160–1523162 stringers the native mesh sits exactly inside the element's own RVT record, so the disagreement is with the export rather than within the recovery — and the classes involved carry the exporter's replication marks (`IFCSTAIRFLIGHT` scores 88.9% against the union of its products but **100.0% against the nearest single one**, with 12 split products; `IFCSLAB` 18, `IFCRAILING` 13, `IFCMEMBER` 49), which is the replication question this tool's own notes warn against reading as a geometry one. For 1498369 and 1500261 it is a real placement error: their meshes sit **6.73 ft and 5.58 ft above their own records**, outside the 0.5 ft admission tolerance, which means they reached the scene through the `exactCarrierComposition` path that skips the envelope cross-check entirely. That bypass has now been measured, and the answer is that **it is not the bug**.

  The route composes a sibling stringer's geometry by a state displacement — Revit persists two mutually exclusive stringer states as sibling `GElement`s, one owning the complete faces and the other only the state selector and displacement. On this model it admits **5 items, and the envelope cross-check would decline all 5**. That looks damning until the five records are read: their spans are `0.040 x 0.064 x 9.843`, `0.052 x 0.083 x 9.843`, `0.164 x 5.085 x 17.881`, `4.757 x 0.164 x 17.881` and `1.312 x 0.164 x 17.881` ft. Every one is between half an inch and two inches thick on some axis — these are the stringer's *path*, the same way a baluster's record turned out to be the railing's path, not a solid envelope. A 0.5 ft containment test against a half-inch-wide record can only ever fail, so the bypass exists for a real reason and closing it would reject correct geometry rather than wrong geometry.

  The meshes are nevertheless misplaced: the export puts them 14.1-16.6 ft from where they are drawn. So **both** pieces of evidence are weak for these five elements, and closing the bypass would replace wrong geometry with no geometry while fixing nothing. The defect is in the state-displacement placement itself, in `conditionalStateCarrier`, and that is a decoder question needing its own evidence rather than a gate to tighten.

  Closing the bypass was then tried rather than reasoned about, and it does not help: gating the carrier-composed items on the same envelope check leaves the paired run at 20 passed and 1 failed, exactly as before, while costing those five elements their geometry. `no-element-past-its-own-box` is dominated by the replication cause, not by these.

  What the composed meshes actually are is now visible, and it is not a placement sign error. All five come out **1.312 ft tall — 0.400 m — regardless of the element's own vertical extent**, which is 9.843 ft (3 m) for two of them and 17.881 ft (5.45 m) for the other three, and each sits flush with the top of that extent (16.568 + 1.312 = 17.880 against a 17.881 ft record). A stair stringer is not 0.4 m tall. The composition is reproducing a *fragment* of the sibling's geometry — one locally-complete piece — rather than the sibling's stringer, so the displacement is being applied to the wrong amount of geometry. That is the shape of the remaining defect, and probing the composition site names it exactly.

  **The rule selects the wrong sibling.** For all five targets the chosen source is a `6`-face, `12`-triangle mesh — a plain cuboid — spanning about `0.92 x 0.66 x 1.31` ft, and in every case its owner id is the target's plus one. The siblings that hold the actual stair geometry are in the same ownership scope and are nothing like it: `5.92 x 9.33 x 7.60`, `11.21 x 9.74 x 1.00`, `2.75 x 4.26 x 4.65`, `5.97 x 6.29 x 3.72` ft. The docstring above the rule states the relationship it is looking for — "one owns the complete faces and the other owns only the same state selector plus the exact state displacement" — but the candidate filter requires the *source* to carry a `conditionalStateCarrier` with the same displacement too, and that is a property of the selector stubs rather than of the sibling that owns the faces. So the filter reliably finds another stub, `candidates.length === 1` passes, and a 12-triangle box is translated into place where a stringer belongs.

  This is worth stating as a method as much as a result: three plausible explanations were each cheap to test and each wrong before this one. It was not proxy/native duplication (no element in the model is drawn both ways), not a placement sign error (the displacement is applied correctly), and not the missing envelope check (gating those items changes no assertion outcome and costs five elements their geometry). Only measuring what the source mesh *is* separated them.

  The fix is therefore to the candidate filter, not to the transform: it must select the sibling that owns the complete faces rather than one that shares the selector. That fix is now in, and instrumenting the site first corrected one guess in the diagnosis above: the complete face-owning sibling *also* carries a `conditionalStateCarrier` with the same displacement, so "not a carrier" cannot be the filter. What separates the two in the data is extent — each of the five state groups holds one complete stringer spanning 5.6-7.6 ft along the state axis and one or more selector stubs whose 1.31 ft fragments end on the same leading face, strictly contained in the complete sibling's range. The filter now composes from the **unique widest** candidate among the siblings sharing the state signature, and declines on a tie; the old `sourcePlane == range[1]` clause, an equation that is true of a selector stub and false of the face owner, is gone. The five stringers compose from the 20-triangle prisms instead of 12-triangle boxes. The overhang list above is unchanged by this, because the composed mesh's top face lands exactly where the stub's did — the remaining disagreement for these elements is with the export's placement, as measured, not with which sibling is drawn.

  What has changed is that the bypass is no longer silent: `nativeMeshCarrierComposedItems` and `nativeMeshCarrierComposedOutsideEnvelope` are reported in the decoder coverage, and a conversion warning names the count.
- **`tail-placements-read`** — since fixed, and the fix was to the assertion rather than to the decoder. It counted `instanceOnlyElements`: elements the placement read was the *sole* source of geometry for. That was a sharp signal when written — 3 broken against 3,901 working — but it measures how little other evidence exists rather than whether the read works, so it falls whenever the rest of the pipeline improves. It had fallen to 21 not because the read broke but because **30,675 of those elements now also carry a real duplicated-bounds record**, which is the better evidence of the two. The assertion now scores `placedInstances` — elements whose own object yielded a transform and a shared shape, which is the read itself — at 30,696 against 25,887 families, 118.6%, with a 50% floor. An assertion that fails when the decoder improves is worse than no assertion.

Both failures reproduce identically on the commit before the audit work in this branch, so neither is a regression from it. Over the same range the audit's changes moved coverage from 36,229 to 36,255 drawn with every per-class agreement figure unchanged.

A second, independent check against an Autodesk conversion of the same building (51,420 fragments) agrees: element-diagonal percentiles run 6.93 / 15.43 / 43.47 ft for the recovery against 4.82 / 14.05 / 42.20 ft for the reference — the reference splits elements into more, smaller fragments — the two largest extents are the same 779.8 ft floor plate, and **no recovered element is larger than the largest reference fragment**. The recovery is not systematically over-extending anything.

> **Correction, 2026-08-12.** This paragraph used to close "the 27 above are
> specific and identified", contradicting the same section's own statement two
> screens up that the count had since fallen to 0. The 0 is the current reading:
> `readProducts` in [`scripts/overlay-diff.ts`](../scripts/overlay-diff.ts) lets
> an untagged member of an `IfcRelAggregates` component inherit the component's
> tag when the component carries exactly one, which is what dissolved 1622190's
> landing-only truth box, and the header of
> [`scripts/verify-pair.ts`](../scripts/verify-pair.ts) records the same. The
> characterisation of the 27 is kept because it is what identified the residue;
> the count is not current.

## Coverage against the paired export

The conversion can report what it recovered. It cannot report what it missed, because nothing inside an RVT says how many walls a building has. The paired IFC export does, and every product Revit exports carries its Revit element id in the `Tag` attribute — the same id the partition decoders recover. Membership is therefore a direct question rather than an estimate, and `scripts/audit-coverage.ts` asks it element by element:

```sh
node --experimental-strip-types scripts/audit-coverage.ts model.rvt model.ifc
```

It separates three things that were previously one number, because they have different fixes:

- **seen** — the scan proved the element id is real, whether or not any geometry was built for it
- **recovered** — the element reached `elementBounds` with an envelope
- **drawn** — the element survived into the default scene

On the supplied 67 MB Revit 2027 project:

Counted by Revit element id, not by export product, and with the elements the export gives mesh geometry to reported separately from the containers it does not:

| IFC product type | in IFC | seen | recovered | drawn | drawn % | with mesh | of those | drawn before |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `IfcWallStandardCase` | 7,381 | 7,223 | 7,210 | **7,186** | 97.4% | 7,381 | 97.4% | 6,324 |
| `IfcWall` | 140 | 139 | 137 | **134** | 95.7% | 140 | 95.7% | 110 |
| `IfcCurtainWall` | 1,835 | 1,804 | 1,804 | 223 | 12.2% | **0** | — | 253 |
| `IfcMember` | 19,652 | 19,197 | 19,147 | **19,120** | 97.3% | 19,652 | 97.3% | 15,916 |
| `IfcPlate` | 6,235 | 6,080 | 6,069 | **6,068** | 97.3% | 6,235 | 97.3% | 4,973 |
| `IfcDoor` | 1,912 | 1,831 | 1,828 | **1,826** | 95.5% | 1,912 | 95.5% | 1,294 |
| `IfcWindow` | 20 | 20 | 20 | **20** | 100.0% | 20 | 100.0% | 3 |
| `IfcColumn` | 311 | 304 | 277 | **277** | 89.1% | 311 | 89.1% | 95 |
| `IfcRailing` | 215 | 204 | 164 | **164** | 76.3% | 215 | 76.3% | 147 |
| `IfcSlab` | 107 | 105 | 103 | **102** | 95.3% | 107 | 95.3% | 135 |
| `IfcRoof` | 20 | 20 | 16 | 16 | 80.0% | 18 | 83.3% | 14 |
| `IfcCovering` | 46 | 42 | 42 | 38 | 82.6% | 46 | 82.6% | 23 |
| `IfcStair` | 82 | 79 | 55 | 51 | 62.2% | **0** | — | 58 |
| `IfcStairFlight` | 108 | 105 | 101 | **101** | 93.5% | 108 | 93.5% | 77 |
| `IfcRamp` | 12 | 12 | 12 | **12** | 100.0% | 12 | 100.0% | 5 |
| building elements | 38,076 | | | **35,338** | **92.8%** | 36,157 | **97.0%** | 29,424 |

`IfcCurtainWall` and `IfcStair` are pure `IfcRelAggregates` containers in this export: **1,919 Tags with no mesh of their own at all.** They print a dash rather than 0.0% in the last column, because "none of its elements are drawable" and "none of them are drawn" read identically as a percentage and mean opposite things. Their panels, mullions, runs and landings are drawn individually, and [the census](unbc-undrawn-element-census-2026-07-28.md) establishes that holding the containers back costs **zero** geometry-bearing elements — the trade is not merely justified, it is free.

**What the display gates were costing.** Four of them discarded geometry that had already been recovered:

- an envelope whose *category* did not decode was dropped from the scene entirely, even though its envelope came from the same validated duplicated-bounds signature as every other record's. That trades a missing label for a hole in the building, so an unnamed element is now drawn under a neutral **Uncategorised elements** batch — 731 of them here.
- sketch boundary recovery was attempted only for elements whose category had *already* decoded, which is backwards for exactly the elements that need it: ceilings and ramps are the smallest populations in the model and so the likeliest to fail category recovery, and a sketch loop is the only thing that gives them a shape rather than a box. Uncategorised elements with no other geometry are now tried too, and their ring is kept only when its plan extent reproduces the independently decoded envelope. Elements drawn from a real outline rise from **101 to 517**.
- the scene admitted only elements with extent on all three axes, which made `prismGeometry`'s deliberate minimum-depth fallback unreachable and dropped flat ceilings and ramp landings that had a perfectly good outline.
- an element rebuilt from several solids drew only its longest run, leaving a gap where the shorter segment should be.

Two recovery gates were also leaking. Object chaining was seeded only from bounds records, so a page holding none went unwalked and took every placement and shared shape on it out of the model; such a page now seeds itself from its own object markers, and recovered objects rise from 47,265 to **48,488**. Placed family instances were resolved into oriented boxes and then discarded unless the element reached the scene some other way.

Together these took drawn elements from 38,353 to 39,114, and coverings from 50.0% to 82.6% of the export's count, slabs from 83.9% to 93.2%. Removing the [cached family shapes](unbc-drawn-but-not-elements-2026-07-28.md#cached-shapes-are-not-building-elements) then took the drawn count down to **33,117**, because most of what it removed was never a building element.

**Where the remaining loss is.** After these changes `recovered` and `drawn` are within a few elements of each other for every category except the two that are held back deliberately. The gap that is left is in *recovery*, and the `seen` column locates it:

- **never seen at all** — 3,367 mullions, 1,150 panels, 514 doors, 230 walls, 15 windows and 7 ramps. (Most of the "seen but not recovered" population below has since been placed; see "The missing elements were never in a family document".) Ramps and windows are the starkest: only 5 of 12 ramps and 5 of 20 windows are proven to exist by any pass. Chaining runs per inflated page, so objects straddling a page boundary are lost, and no pass indexes elements the chain never reaches.
- **seen but no geometry built** — 748 walls, 149 columns, 26 stair flights. These elements are known to be real and yield nothing to the surface, sketch, or instance decoders.

Neither is a display problem, so neither is fixed by the changes above. `IfcRamp` is unchanged at 5 drawn for that reason.

**The same split, in the studio.** This table was only ever available offline, while the app reported a single headline match rate — and a single rate flatters the result, because a class can be matched by element id for every one of its elements and still contribute nothing to the scene. Pairing an export now renders **Coverage by object class** in the report dock, with the same seen / recovered / drawn columns this section is built on, one row per class the export carries.

The join is the audit script's: the IFC analysis carries out the matched Revit ids per class, and the app intersects them with the ids the converter gave an envelope and the ids the scene actually drew. The drawn set is slightly stricter than the script's — the script counts a record *selected* for display, the panel counts an element that reached a mesh with triangles in it, 92 stair flights against the script's 97. Classes nothing was recovered for keep their row, since that row is the useful one; classes the export writes without a Revit id at all — storeys, the site, the building — are left out instead, because nothing can be joined to them and an empty row would read as a gap that is not one.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- nested duplicated-bounds recovery: 35,677 record occurrences, 35,633 unique native IDs, and 33,985 non-zero 3D envelopes
- RVT-only default scene: 33,117 element proxies, 578 of them drawn as uncategorised; 6,013 cached family shapes are excluded because they are not elements, and 1,569 curtain-wall/opening wrapper envelopes remain auditable/exportable but are held back so their child panels and mullions stay visible
- generated scene: 435,242 triangles
- paired index evidence: 8,902 `ElemTable` IDs plus 37,324 partition-record IDs
- Autodesk derivative cross-check: 59,582 stable Revit IDs and 51,420 fragments in the signed-in reference capture
- Autodesk derivative presentation evidence: 22 materials and no bitmap textures; its screenshot look comes primarily from detailed meshes, technical shading, feature edges, and shadows
- strongest supplied-pair clusters include 1,044 standard walls, 1,294 doors, 15,654 members, 4,972 plates, 95 columns, 136 railings, and 53 slabs
- native category recovery: 22,353 category tokens, 11,926 elements resolved directly from their own token, 21,997 more inherited from a record-code consensus, for 33,923 categorised elements — 18,352 curtain wall mullions, 6,878 curtain panels, 2,818 walls, 1,288 doors, 146 railings, 82 columns, 49 floors, 27 stairs, 24 ceilings, 5 windows, 5 ramps, and 4,247 stair/railing components
- local RVT-only conversion of the 67 MB model completes in about 17 seconds in Node and 25 seconds in a Chromium tab, including native category recovery
- the conversion previously spent roughly 90% of its time decompressing garbage: four byte sequences inside the DEFLATE payload happen to match the gzip signature, and each one was handed the remaining 69 MB of the stream as input. `fflate` sizes its output buffer from the input length, so those four false chunks allocated and decoded hundreds of megabytes each. Validating the gzip flag byte and bounding every chunk by the next valid signature cut the same workload from 134 seconds to 17 with byte-identical record output (35,633 bounds records, 33,985 solid envelopes)

The bounds signature is currently confirmed for this supplied Revit 2027 file. It must be regression-tested on more RVT versions before being treated as a general Revit decoder.
