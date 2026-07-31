# Validating on a second building

Every defect found in the audit recorded in the README traces to the same root:
each rule was measured on one building, applied without a check, and broke
silently when something else changed. None of them were careless. Each was
correct for the model it was fitted on. That is what makes the pattern worth
naming rather than fixing one instance at a time — a rule that is right about
its reference model gives no signal at all that it is wrong about the next one.

## What one building's evidence actually cost

Each row is a rule that held on the reference project and failed somewhere else.
The point of the table is the last column: none of these announced themselves.

| Rule | Fitted value | What it did |
| --- | --- | --- |
| Curtain-wall wrapper | `recordCode 30`, field count 8–10 | Ran ahead of the decoded category and won, hiding 31 mullions, panels and curtain grids the file had named |
| Storey list | 8 most populated 0.5 ft elevation bands | Returned exactly 8 on a model with 12 real storeys, because the cap was binding, while 37,503 decoded `m_assocLevelId` relations went unused |
| Elevation shading | fixed 80 ft window, 10 ft lead-in | Correct on a 62 ft building; saturates on a taller one and uses a sliver of the range on a single storey |
| Glazing transparency | `name.startsWith("Glazing")` | Stopped matching anything when batches were relabelled by decoded category; 76,026 glazing triangles rendered as solid plate |
| Wireframe overlay | `EdgesGeometry(geometry, 1)` on every batch | Right for twelve-triangle boxes, catastrophic once 95% of the scene became tessellated native BRep — 928,488 line segments per frame |
| Native mesh admission | envelope map built from `displayBounds` | Circular: an element held back from the proxy scene lost its real mesh too, dropping 3,720 complete native items |
| `tail-placements-read` | share of `instanceOnlyElements` | Measured how little other evidence exists, so it fell from 3,901 to 21 as the decoder improved, and failed for being *better* |
| Carrier composition | source must share the state displacement | Selects a selector stub rather than the sibling owning the faces, translating a 12-triangle box into a stringer's place |

Two more are still standing and are recorded in the README rather than fixed:
`no-element-past-its-own-box` bounds the overhang count at 26 and the model
produces 27, and element `447970` carries a `Curtain Wall Mullions` token at
72,315 sq ft because category-token ownership resolves to the nearest preceding
element id.

## The harness that now exists

Fixing instances is not the leverage. Three things make the *class* of problem
testable, and all three work on any model rather than on the reference one:

- **`scripts/verify-pair.ts`** scores a recovery element by element against an
  IFC exported from the same document, with named assertions that fail loudly.
  On the reference project it draws 36,255 of 38,076 products, 95.2%.
- **Reference-model pairing** accepts any GLB or glTF from disk, measures its
  extent and up-axis rather than assuming, and needs nothing compiled in. A
  conversion by other tooling is the sharpest available yardstick.
- **`lib/reviter/limit-census.ts`** counts every fitted decoder limit that
  rejected geometry and names it in the conversion's own warnings. The reference
  model reaches none of them, which is exactly why they were invisible.

## What to run on a second building, and what to look at

Point all three at a second RVT — ideally with a paired IFC from the same save,
which the header's `NumberOfSaves` can confirm against the RVT's
`uniqueDocumentIncrements`.

1. **`fittedLimitsReached` in the conversion stats.** Empty on the reference
   model. Any entry is a threshold from that building deciding what this one
   shows, named for the constant that imposed it.
2. **The assertion list from `verify-pair.ts`.** A rule fitted on one building
   and not generalising fails here by construction; that is what the assertions
   are for. Read the failures as claims about the rules, not about the model.
3. **The per-class centre and size agreement table.** The reference project runs
   96–100% across members, walls, plates, doors, columns, railings, coverings,
   windows and ramps. A class that collapses on a second model localises the
   rule responsible faster than any amount of reading.
4. **The storey list.** It comes from `m_assocLevelId` now, so it should report
   real level ids on any 2027 file; a model that falls back to elevation bands
   is telling you the relation decoder did not fire.

Until that second run exists, every threshold in this repository is a hypothesis
with one supporting observation, and the honest reading of a green assertion
list is that nothing has contradicted it yet.

## Ranked backlog

By visible impact rather than by how well understood each one is. All four have
since been worked without a second building; the section after this one records
what was done and the assumption each fix rests on.

| | What | Effort | Why |
| --- | --- | --- | --- |
| 1 | Element `447970` — a 72,315 sq ft plate carrying a mullion token, drawn as a large dark plate across the model | small | The most visible single defect, and the cause is known: category-token ownership resolves to the nearest preceding element id |
| 2 | Spandrel panels drawn translucent | medium | Affects 6,274 glazing elements. Wants the persisted transparency field decoded — the real fix rather than another name or category heuristic |
| 3 | 76 stair balusters with no geometry | unknown | Open-ended: those elements have neither a usable envelope nor a native mesh, so there is nothing yet to draw |
| 4 | Carrier-composition candidate filter | small | Fully diagnosed down to the selection criterion, but it is 5 elements |

The carrier filter is last despite being the best-understood item on the list.
It absorbed the most recent investigation and turned out to be the least
valuable thing on it, which is worth recording alongside the diagnosis.

`447970` is the one to take first. It is a single element, but the weakness
behind it — the nearest-preceding-id ownership rule in `native-categories.ts` —
is what assigns 15,697 elements their categories directly and seeds the
record-code consensus that assigns another 23,462, so a proper fix reaches
considerably further than the plate.

## Working the backlog without the second building

The second building never arrived, so each fix below was made against the one
pair we have, with its assumption stated where a second model would otherwise
have tested it. The paired IFC export and the Autodesk-derived GLB are the two
independent witnesses; every fix was required to move at least one of them or
to be a pure decode with the field's value confirmed against the export.

### 1. `447970` — donated category tokens (fixed)

The probe that settled it: the mullion token that labelled `447970` has *nearer*
preceding candidates — element ids `1450156` and `1456618` — that the persisted
`Global/ElemTable` proves are real elements of this document, just ones the
converter draws nothing for. The nearest-preceding rule skipped them because
"known element id" meant "element with a bounds record", and fell through to the
floor plate 109 bytes back. The token was never the plate's; it was *donated*.

The fix (`resolveElementCategoriesWithEvidence` in `native-categories.ts`): a
token whose nearest real element id is undrawn still votes, but the assignment
is flagged **donated**, and a donated-only label yields to the element's own
record-code cluster when that cluster clears the ordinary consensus floors and
disagrees. No new threshold: a consensus trusted to hand categories to
unlabelled siblings is trusted to outvote a token that provably fell through.

Measured on the pair: 65 of 385 donated-only labels overridden. `447970`
inherits **Floors** from its 98.4%-pure cluster of 63 floors. 26 records the
export itself names `IfcCurtainWall` — assembly wrappers that had taken their
children's mullion/panel tokens and were drawn as duplicate plates — now
classify as walls coincident with curtain assemblies and join the deliberate
held-back-as-wrappers set. Every verify-pair assertion and per-class agreement
figure is unchanged.

**The assumption**: dropping donated tokens outright would be wrong — the
drawing-aid labels (`Stairs Paths`, `Sketch Lines`, balusters) that the scene
admission rules depend on are themselves donated, uncontradicted, and load-
bearing. The blunt version of this fix (resolve against the full ElemTable id
set) was measured first and rejected: it stripped 300 direct labels and would
have re-admitted the large stair helper boxes. On a second building the ratio
of donated to clean tokens (385 of 15,697 here) is the number to watch.

### 2. Spandrels and glass — persisted transparency (decoded)

`MaterialId.m_transparency` is now read, not guessed. In the direct-layout
`MaterialElem` record it is an `f32` 24 bytes before the packed colour: an
eight-byte `ff` run, the transparency, a companion ratio, twelve zero bytes,
then the colour. Against the paired export's `IFCSURFACESTYLERENDERING` values
the field agrees **exactly on every named material**: the three glasses read
0.75 (`Glass`), 0.70 (`Verre`) and 0.90 (`Стекло`), and all fourteen
export-matched opaque materials read 0.0. The unmatched values are sensible on
their face — the temporary-phase material 0.4, the massing-opening default 1.0,
a light source 0.75. The structural `ff`-run guard holds on all 54 direct
records and correctly rejects all 15 nested-layout records.

Downstream, the palette carries the raw value and its complement as alpha, and
the viewer lets a decoded material decide translucency; the category heuristic
survives only as the fallback for batches whose material never framed the
field. On this model that flips 12 glazing-category elements — the spandrel
panels, 900 triangles — to opaque because Revit says their material is, and
draws 77,236 glass triangles at the transparency the file actually stores
instead of a display constant.

**The assumption**: the nested appearance-backed layout stores `ff` bytes where
the direct layout stores the field, so nested materials report no transparency
and render opaque. Every nested record the export names *is* opaque in this
model, so nothing is currently lost — but a second building with a transparent
appearance-backed material would render it solid, and would be the file that
locates the nested field.

### 3. The 76 balusters (characterised, still not drawn)

Probing what evidence exists located the absence rather than closing it. After
the donated-token fix, 79 records carry the baluster label (20 of the original
99 were overridden as donated). Every one sits on the all-ones "no class"
record code with **no geometry evidence of any kind** — no solid, no quads, no
arcs, no rail path, no oriented box — and 58 of 79 have zero-height envelopes;
22 are persistently owned by `Railing Top Rail` records. Most telling, those 79
records themselves **own 885 ElemTable child rows**, about eleven per record,
and the children own no bounds records and no GRep faces either.

The reading that fits all of it: the labelled records are per-railing baluster
*sets*, the 885 children are the individual balusters, and their geometry
exists only as a family symbol repeated along the rail path — an instancing
relation the decoder does not yet read. So drawing the balusters is a decode
task with a now known shape, not a gate to loosen.

A follow-up probe narrowed that shape further. The children are *not* ordinary
placed instances: of the 885, only 80 appear in the `InstInfoBase` placement
scan, every one at identity origin referencing itself — those are the twelve
baluster family **symbol definitions**, and all twelve symbol shapes already
decode. The per-station transforms live in the railing's nested GRep instead:
railing `1842055`, which draws correctly, gets its 83 balusters through
`composeRevit2027NestedMesh`, every face carrying a `nestedTransform`. The
railings still drawn as swept ribbons are the ones whose nested GRep roots are
incomplete — the "incomplete recursive roots remain on the proxy path" bucket
in the conversion warnings. So the remaining work is completing those nested
roots in the existing recovery, with the paired export's railing meshes as the
per-position check, not writing a new distribution decoder.

The persisted schema behind that route has since been recovered from the
model's own `Formats/Latest` declarations —
`BaseRailingSym.m_balusterInstances` holds the placed balusters as GRep nodes,
with a `paramsAndId` record per instance naming the family symbol and the
child element id. See `revit-2027-baluster-instances.md`, which also names
`AppearanceAsset.m_transparency` for the nested-material transparency gap in
item 2. A follow-up instrumented investigation,
`revit-2027-railing-nested-roots.md`, measured the incomplete-root bucket
against that schema: of 61 incomplete nested roots, 57 are stair flights and
only 2 are railings — one completable from 258 already-persisted station
transforms, one requiring the instance-array decode itself, and neither
recoverable by loosening the composer.

One consequence *was* fixed once walking the model made it visible: 19 of the
set records carried enough envelope height to pass the solid test, and the
display fell back to drawing each as a literal envelope box — a solid grey
wall standing in its railing's run, the largest 20.7 × 19.0 × 9.5 ft floating
at a curtain wall. `Stairs Railing Baluster` now joins
`PROXY_ONLY_HELPER_CATEGORY_IDS` in `scene.ts` on the same evidence as the
other members: no geometry evidence of any kind, the all-ones record code,
persisted ownership under the railing's top rail, and an export that gives
such records geometry in none of its cases. The predicate only ever sees the
proxy fallback path, so any future native or instanced baluster mesh is
unaffected.

### 4. Carrier composition — the wrong sibling (fixed)

Instrumenting the composition site showed the diagnosis's one wrong guess: the
complete face-owning sibling *also* carries a `conditionalStateCarrier` with
the same displacement, so "the source must not be a carrier" cannot be the
filter. What separates them in the data is extent: for every one of the five
targets the group sharing the state signature (same displacement, leading face
exactly on the target's helper plane) contains one complete stringer spanning
5.6-7.6 ft along the state axis and one or more selector stubs whose 1.31 ft
fragments end on the same face — and the stub's range is strictly contained in
the complete sibling's.

The new rule: among siblings with the state signature, compose from the
**unique widest** candidate along the displacement axis; a tie declines the
composition. The justification is the relationship itself — a fragment cannot
span more of the state than the faces it is a fragment of — so no magic
constant is introduced. The previous rule's `sourcePlane == range[1]` clause,
which reliably selected the stub (that equation is *true* of a selector stub
and false of the complete sibling), is gone.

**The assumption**: uniqueness-of-the-widest stands in for the sibling-state
schema we still have not decoded. Both cases the model contains — five clean
one-stringer groups, and two ambiguous groups with twin 2.87 ft candidates —
resolve correctly (composed and declined respectively), but a building whose
mutually exclusive states have equal extents would decline compositions a
schema read would accept.

## What not to do

Do not move `MAX_ELEMENTS_OVER_OWN_BOX` from 26 to 27 to get a green run. The
assertion is naming a real gap, the gap is characterised in the README, and a
bound raised to match the number it was supposed to constrain measures nothing.
The same applies to every threshold here: the value of a fitted number is that
it fails when the fit stops holding.
