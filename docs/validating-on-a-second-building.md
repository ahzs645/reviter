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

By visible impact rather than by how well understood each one is.

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

## What not to do

Do not move `MAX_ELEMENTS_OVER_OWN_BOX` from 26 to 27 to get a green run. The
assertion is naming a real gap, the gap is characterised in the README, and a
bound raised to match the number it was supposed to constrain measures nothing.
The same applies to every threshold here: the value of a fitted number is that
it fails when the fit stops holding.
