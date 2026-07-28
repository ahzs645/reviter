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

The schema-complete `GPoint` and `GConditionInt` readers prove that the earlier
result was primarily FIFO/caller admission, not an absent-owner gap:

| Persisted route | Tags |
| --- | ---: |
| own full-FIFO, complete certified mesh | 553 |
| own framed GElement, replay/mesh still incomplete | 224 |
| syntactically admitted direct GRep, coverage/composition incomplete | 72 |
| semantic frame only | 38 |
| no independently framed partition object | 18 |
| InsertableInstance frame but no decoded placement | 15 |
| hosted-child membership, without a drawable owner route | 5 |

The last 15 are columns and are a disjoint primary route. All 925 Tags resolve
to a native Revit `UniqueId`; the tag corpus SHA-256 is
`4b7264d4653717a4ff9abf8c01677392749be7d229fd36c2d4a83f67f4b13b6a`.

Four targets have certified drawable children through
`Global/ElemTable.OwningElementId`; none of their child aggregates falls within
the 0.5-foot IFC envelope, while one triangle-count match alone is insufficient
to prove composition. Two separate
wall-standard-case targets have certified hosted children, but membership alone
does not establish product geometry composition. Ownership/host aggregation is
therefore not a validated missing geometry route in this population.

## Class inventory

| IFC class | Tags | Own GElement | Full FIFO/mesh complete | Within 0.5 ft RVT envelope |
| --- | ---: | ---: | ---: | ---: |
| `IfcMember` | 354 | 354 | 336 | 291 |
| `IfcColumn` | 224 | 209 | 0 | 0 |
| `IfcStairFlight` | 108 | 108 | 50 | 46 |
| `IfcRailing` | 105 | 105 | 97 | 97 |
| `IfcWallStandardCase` | 59 | 24 | 24 | 6 |
| `IfcSlab` | 49 | 27 | 27 | 4 |
| `IfcWall` | 14 | 10 | 10 | 7 |
| `IfcRamp` | 11 | 11 | 9 | 9 |
| `IfcRoof` | 1 | 1 | 0 | 0 |
| **Total** | **925** | **849** | **553** | **460** |

The 553 complete owners pass the existing browser-safe full FIFO, certified
face tessellation, positive-loop coverage, nested composition, duplicate/conflict,
and bounded-storage gates. They contain 62,642 certified triangles. The
independent IFC AABB diagnostic places 460 within 0.5 ft; 441 are coincident
with IFC to `1e-6` ft. Triangle equality is only diagnostic: 430 owners match
the IFC triangle count.

Production now admits both the original three exact shapes and a second
format-derived route: a root beginning with `GFilter`, ending in `Geometry`,
and containing only schema-complete condition, curve, group, point, and
instance prefix slots. Complete coverage and the independent RVT envelope
remain mandatory. `GCylindricalHelix` and every unknown slot fail closed.

Across all 36,144 numeric IFC geometry Tags, complete certified native Tag
presence is now 35,762 (`98.943117%`). The stricter IFC spatial parity total is
35,669 / 36,144 (`98.685812%`). The original exact bounded route still
contributes 141 complete / 119 half-foot matches; the new conditioned route
contributes 418 complete / 347 half-foot matches among non-overlapping IFC
Tags, while its readers also unlock nested geometry in previously admitted
root shapes.

## Exact initial descriptor shapes

Each shape below is written as `token:sourceClassSlot`.

### Railings

All 105 railing roots have:

```text
3:2215,4:2215,5:2343
```

That is two persisted `GInstance` roots followed by terminal `Geometry`.
Ninety-seven complete their exact symbol closure and pass the 0.5-foot envelope
gate; eight remain incomplete. A syntactic shape check alone therefore has
`97/105` pre-coverage precision. The existing full coverage gates reject all
eight negative controls.

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

### Conditioned roots and remaining blockers

The conditioned route recovers 336 members, 50 stair flights, and 27 slabs.
Its exact reader chain is:

```text
GFilter/GPoint/GConditionInt + curve/control/group/instance state -> Geometry
```

The remaining 372 fixed-corpus failures now stop at concrete boundaries:

| First blocking boundary | Owners |
| --- | ---: |
| `GInstance` embedded-GElement variant | 209 |
| no framed GRep definition | 76 |
| missing nested symbol target | 64 |
| unsupported `GCylindricalHelix` slot 2244 | 14 |
| local loop/surface tessellation incomplete | 8 |
| unsupported `GGTag` slot 2256 | 1 |

The 209 columns are not a reason to loosen the 44-byte `GInstance` reader:
their non-null embedded descriptor is a distinct 46-byte variant whose source
2246 `GElement` must be associated with the instance transform and native
embedded-geometry precedence.

## Original exact candidate predicate

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
| exact descriptor predicate | 151 | 141 complete, 10 incomplete |
| existing full FIFO/mesh coverage gates | 141 | all measured complete roots |
| independent 0.5-foot IFC AABB comparison | 119 | spatial-parity matches |

The predicate has `141/151` (`93.38%`) pre-coverage precision and preserves ten
exact-shape negative controls for the runtime coverage gates. It remains a
separate, reproducible checkpoint beside the conditioned route.

Production evaluates 151 candidate roots rather than all display IDs. The
collector rejects 10 during complete coverage and holds the measured 44,994
certified triangles. All 141 complete roots pass the production RVT envelope;
22 do not match the separate IFC AABB oracle within 0.5 ft.

## Bounded admission contract

The production caller predicate is class-independent:

1. exact Revit 2027 length/echo-framed GElement and owner identity;
2. append-only initial tokens and either one measured exact sequence or a
   `GFilter`-first, terminal-`Geometry` prefix containing only certified slots;
3. successful complete FIFO replay;
4. complete positive-loop Face mesh coverage;
5. complete recursive `GInstance` closure when present;
6. no duplicate/conflicting owner;
7. bounded storage/output;
8. independent RVT element envelope containment within 0.5 ft.

Sequence matching selects candidates; it does not certify output. The eight
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
