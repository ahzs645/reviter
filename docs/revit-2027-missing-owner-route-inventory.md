# Revit 2027 missing-owner route inventory

This checkpoint locates the persisted RVT carriers for the 925 numeric IFC
geometry Tags that previously appeared to have neither a certified direct
geometry owner nor an exact instance placement.

The bounded result is
[`unbc-revit-2027-missing-owner-routes.json`](generated/unbc-revit-2027-missing-owner-routes.json).
The audit decodes native identity, ownership, host, level, type/family fields,
framed partition objects, GRep roots, FIFO bodies, certified face meshes, and
element bounds before opening IFC as a post-decode population and bounds
oracle.

## The route is usually the element's own GRep

The earlier result was primarily a caller-admission gap, not an absent-owner
gap:

| Persisted route | Tags |
| --- | ---: |
| own framed GElement, full FIFO/mesh coverage currently incomplete | 709 |
| own framed GElement, full FIFO/mesh coverage complete | 140 |
| semantic frame only | 41 |
| no independently framed partition object | 18 |
| InsertableInstance frame but no decoded placement | 15 |
| hosted-child membership, without a drawable owner route | 2 |

The last 15 are columns and are a disjoint primary route. All 925 Tags resolve
to a native Revit `UniqueId`; the tag corpus SHA-256 is
`4b7264d4653717a4ff9abf8c01677392749be7d229fd36c2d4a83f67f4b13b6a`.

Two targets have certified drawable children through
`Global/ElemTable.OwningElementId`, but neither child aggregate matches the IFC
triangle count or falls within the 0.5-foot IFC envelope. Two separate
wall-standard-case targets have certified hosted children, but membership alone
does not establish product geometry composition. Ownership/host aggregation is
therefore not a validated missing geometry route in this population.

## Class inventory

| IFC class | Tags | Own GElement | Full FIFO/mesh complete | Within 0.5 ft RVT envelope |
| --- | ---: | ---: | ---: | ---: |
| `IfcMember` | 354 | 354 | 0 | 0 |
| `IfcColumn` | 224 | 209 | 0 | 0 |
| `IfcStairFlight` | 108 | 108 | 0 | 0 |
| `IfcRailing` | 105 | 105 | 96 | 96 |
| `IfcWallStandardCase` | 59 | 24 | 24 | 6 |
| `IfcSlab` | 49 | 27 | 1 | 0 |
| `IfcWall` | 14 | 10 | 10 | 7 |
| `IfcRamp` | 11 | 11 | 9 | 9 |
| `IfcRoof` | 1 | 1 | 0 | 0 |
| **Total** | **925** | **849** | **140** | **118** |

The 140 complete owners pass the existing browser-safe full FIFO, certified
face tessellation, positive-loop coverage, nested composition, duplicate/conflict,
and bounded-storage gates. They contain 44,822 certified triangles. The
independent RVT element-envelope gate admits 118 within 0.5 ft; 103 are
coincident with IFC to `1e-6` ft. Triangle equality is only diagnostic: 97
owners—96 railings and one wall—also match IFC triangle count.

The existing production converter remains unchanged in this checkpoint. The
audit proves a candidate population but does not broaden the caller gate.

## Exact initial descriptor shapes

Each shape below is written as `token:sourceClassSlot`.

### Railings

All 105 railing roots have:

```text
3:2215,4:2215,5:2343
```

That is two persisted `GInstance` roots followed by terminal `Geometry`.
Ninety-six complete their exact symbol closure and pass the 0.5-foot envelope
gate; nine remain incomplete. A syntactic shape check alone therefore has
`96/105` pre-coverage precision. The existing full coverage gates reject all
nine negative controls.

### Walls

All 34 available wall roots have:

```text
3:2254,4:2254,5:2254,6:2254,
7:2248,8:2248,9:2248,10:2248,11:2343
```

This is four `GFilter`, four `GGroup`, then terminal `Geometry`. All 34 pass
full FIFO/mesh coverage, so the measured shape has `34/34` coverage precision.
Only 13 pass the independent 0.5-foot element envelope; the other 21 must keep
their proxies.

### Ramps and one slab

Twelve roots have:

```text
3:2215,4:2215,5:2343,6:2343
```

Ten pass full coverage, of which nine ramps pass the envelope gate. Two roots
are exact negative controls, and the one complete slab fails the envelope
gate.

### Still-incomplete high-count shapes

- 354 stair supports/members begin with `GFilter`, then curve state, then
  terminal `Geometry`.
- 203 columns begin `GInstance -> GFilter -> Geometry`; six write Geometry
  before the final GFilter and are not terminal-Geometry candidates.
- 108 stair flights begin with `GFilter`, followed by exact curve/control/
  instance state, then terminal `Geometry`.

Their GRep ownership is proven, but none currently completes certified
drawable-face coverage. They remain proxy-only.

## Class-independent candidate predicate

The measured predicate does not inspect IFC class, category, family, or element
ID. It requires the initial descriptors to use append-only tokens `3..n` and
the source-slot vector to equal one of:

```text
[2215, 2215, 2343]
[2254, 2254, 2254, 2254, 2248, 2248, 2248, 2248, 2343]
[2215, 2215, 2343, 2343]
```

Across the 849 targets with their own framed GElement, that syntax selects 151
roots:

| Stage | Roots | Result |
| --- | ---: | --- |
| exact descriptor predicate | 151 | 140 complete, 11 incomplete |
| existing full FIFO/mesh coverage gates | 140 | all measured complete roots |
| independent 0.5-foot RVT/IFC envelope gate | 118 | bounded output candidates |

The predicate therefore has `140/151` (`92.72%`) pre-coverage precision and
`140/140` (`100%`) recall for the complete roots in this population. Against
the 709 incomplete own-GElement roots it excludes 698 and deliberately leaves
11 exact-shape negative controls for the runtime coverage gates, a measured
specificity of `698/709` (`98.45%`).

This bounds a future production experiment to 151 candidate roots rather than
all display IDs. The existing collector would reject 11 during complete
coverage, hold at most the measured 44,822 certified pre-envelope triangles,
and reject another 22 at the independent envelope gate. No production caller
change is made by this checkpoint.

## Bounded admission contract

A safe future caller predicate must be class-independent:

1. exact Revit 2027 length/echo-framed GElement and owner identity;
2. append-only initial tokens and one of the measured source-slot sequences;
3. successful complete FIFO replay;
4. complete positive-loop Face mesh coverage;
5. complete recursive `GInstance` closure when present;
6. no duplicate/conflicting owner;
7. bounded storage/output;
8. independent RVT element envelope containment within 0.5 ft.

Sequence matching selects candidates; it does not certify output. The nine
railing and two ramp/slab negative controls prove why the runtime coverage
gates remain mandatory. Requesting every display element from the collector
was measured as unbounded and is not retained.

Same-chunk previous/next frames in the JSON are samples only. No adjacency is
promoted to geometry ownership.

## Reproduce

First generate the committed certified-RVT inventory:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts \
  "/path/to/model.rvt" > /tmp/reviter-rvt-audit.json
```

Then run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-missing-owner-routes.ts \
  --rvt "/path/to/model.rvt" \
  --ifc "/path/to/reference.ifc" \
  --rvt-audit /tmp/reviter-rvt-audit.json \
  --json docs/generated/unbc-revit-2027-missing-owner-routes.json
```

The exact IFC hash is
`adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`.
