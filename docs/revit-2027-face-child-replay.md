# Revit 2027 Face-child FIFO replay

This checkpoint replays the exact UNBC Revit 2027 model from each safe
single-`Geometry` root through `Face`, `GEdge`, and every reached Face child.
It is a browser-safe TypeScript audit: no Revit process, ODA binary, native
solid kernel, payload scanning, or inferred body width is used.

The audit is green for every initial Face child and every reached descendant,
including `FillPatternData`, `FillGrid`, and both `GArc` profile bodies. All
5,996 direct single-Geometry owners consume their exact replay boundary.

## Replay and ownership rule

For each framed GRep owner, the audit:

1. accepts only a direct single-`Geometry` root or the proven
   single-`GGroup`/single-`Geometry` route;
2. appends Geometry-owned Faces and GEdges in their declared order;
3. reads each static body at the current cursor;
4. appends newly materialized child properties to the tail of the same FIFO;
5. preserves static references without treating them as inline bodies; and
6. stops the owner at its first unknown descendant or uncertified reader.

The replay never searches ahead for a plausible class body. A reader succeeds
only when its complete bounded grammar and value constraints succeed at the
owned cursor.

## Shared pointer-index namespace

Positive conditional-property tokens are not a simple consecutive counter.
Native writer and loader evidence establishes a shared pointer-index
namespace:

- `StaticIntegerBuilder` calls
  `OdBmOutQueue::getStaticInteger`/`indexByPointer`; first-seen pointers take
  the current common OutQueue index and repeated pointers are deduplicated.
- `StaticIntegerReader::read` registers the signed reference with
  `addIdReference`.
- `readPropertyToken` can extend the logical variant vector to `token + 1` or
  assign an earlier reserved index.

The TypeScript replay therefore models three states: unallocated, reserved by
an earlier positive `StaticInteger`, and materialized as a property body. A
forward property-token jump is accepted only when every skipped index was
reserved earlier. A lower token can materialize an earlier reservation once.
No second body is appended for an already materialized token, and a source
slot change fails.

On the exact model this rule observes 664,379 static-reference reads and:

| Namespace event | Exact result |
| --- | ---: |
| accepted forward jumps | 5 |
| skipped reserved indices | 13 |
| jump widths | 1×2, 2×1, 3×1, 6×1 |
| later materializations of reserved indices | 13 |
| repeated property aliases | 0 |

This resolves the three apparent loop-token gaps without weakening the FIFO
or accepting an unexplained sparse token.

## Exact corpus result

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-face-child-replay.ts \
  "UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

The exact supplied model produces:

| Measure | Result |
| --- | ---: |
| partitions / inflated chunks / failed chunks | 1 / 3,666 / 0 |
| safe direct single-Geometry owners | 5,996 |
| completed owners | 5,996 |
| owners stopped at source-2,087 descendants | 0 |
| owners stopped at a source-2,213 descendant | 0 |
| Faces / GEdges decoded | 40,961 / 84,499 |
| initial Face-child descriptors | 116,844 |
| initial Face-child bodies decoded | 116,844 |
| certified descendants decoded | 313 |

The initial descriptor census is:

| Source slot | Identity | Declared | Reached and decoded |
| ---: | --- | ---: | ---: |
| 1,434 | `EdgeLoop` | 40,448 | 40,448 |
| 1,437 | `EdgeLoopWithChainEnvelopes` | 22 | 22 |
| 2,253 | `GFilling` | 35,413 | 35,413 |
| 634 | plane | 40,813 | 40,813 |
| 900 | cone | 10 | 10 |
| 1,144 | cylinder | 136 | 136 |
| 4,283 | `SurfRev` | 2 | 2 |

There is no initial-body difference and no source body is found by scanning.

## Reached grammar and value checks

Reached slot-1,434 bodies total 40,604: 40,448 initial plus 156 descendants.
Body widths are 69×40,460 and 71×144. All 162,528 envelope scalars are finite,
all 40,632 `m_open` bytes are exactly false, and all 121,896 static reference
values are finite integers in the observed range 4–381.

Source slot 1,437 was previously misidentified as count-only `EdgeLoopRef`.
The owned corpus proves `EdgeLoopWithChainEnvelopes`: inherited
`EdgeLoop` followed by an int32 count and `count * 36` bytes, each containing
one int32 start-edge reference and four float64 envelope values. All 28 bodies
(22 initial and six descendants) decode. Their widths are 73×2, 145×4,
147×12, 181×2, 217×2, 219×4, and 327×2. The 76 start-edge references range
from 24 to 317; all 304 chain-envelope scalars are finite.

Reached `GFilling` bodies total 35,413. Widths are 102×35,363 and 104×50.
All 247,891 placer scalars are finite. Fifty bodies append sentinel
source-2,087 `FillPatternData` properties.

All 50 `FillPatternData` bodies decode at widths 42×1 and 48×49. They append
99 source-2,085 `FillGrid` descriptors. All 99 FillGrid bodies decode at 44
bytes, leaving no filling descendant blocked.

Reached analytic surfaces validate exact boundaries and finite scalar fields:
plane 105×40,813, cone 137×10, cylinder 137×136, and `SurfRev` 135×2. Every
reached orientation byte is exactly true.

## Source 4,283 `SurfRev`

Both declared source-4,283 instances have an exact 135-byte body:

```text
common Surface                       33 bytes
center + x/y/z vectors               96 bytes
profile-curve property descriptor     6 bytes
```

The exact `Formats/Latest` top-level ladder identifies slot 4,283 as
`SurfRev`; its declared fields are `m_center`, `m_xVec`, `m_yVec`, `m_zVec`,
and `m_pProfileCurve`. The native common source-5,926 reader consumes the
same fields in that order after common `Surface`. The two profile descriptors
are tokens 56 and 57, both source slot 2,213, which the same top-level ladder
identifies as `GArc`. Each 135-byte extent aligns exactly to the next primary
FIFO body. Both queued 117-byte GArc bodies decode and the second ends exactly
at its owner boundary. The combined `readerCorpusValid` result is true.

## What this unlocks—and what it does not

This work establishes exact Face child ownership, static reference retention,
nested loop replay, chain-envelope data, filling placement, and four analytic
surface types. The separately documented planar adapter now carries the safe
single-loop subset into Reviter's browser-neutral BRep and produces 84,811
owner triangles; persisted instance placement expands it to 308,107 placed
triangles. Numeric-Tag comparison reaches 25,641 IFC products.

The native `TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`, and
`libTD_BrepBuilder`/`libTD_Br` modules remain behavioral evidence rather than
client dependencies. Remaining blockers include:

- completing curve, shared-surface, multi-loop, shell, and solid topology;
- extending the browser tessellator beyond the certified planar/cylinder
  subsets; and
- binding exact native face/material relations through triangle emission.

See `docs/revit-2027-planar-topology.md` for the current IFC comparison and
the remaining transform/material boundaries.
