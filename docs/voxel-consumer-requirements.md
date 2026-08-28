# What a voxel consumer needs from the export

Reviter's IFC4 export has been graded by three readers — `web-ifc`,
IfcOpenShell's validator, and the independent reader behind
[`audit-ifc-export-independent.ts`](unbc-independent-ifc-verification-2026-08-19.md).
All three ask the same kind of question: is the file well-formed, and does every
product carry its evidence. None of them asks whether the file is *usable* for
anything in particular.

[bimmer](https://github.com/ahzs645/bimmer) is a consumer that does. It converts
an IFC into a walkable Minecraft world, and it is built on the same three UNBC
sources this repository pins by SHA-256 — the 67 MB RVT, the 80 MB Autodesk IFC,
and the Autodesk GLB. It has been hardened end-to-end on the Autodesk export, so
it is a working oracle for a question no schema check can answer: **which of the
facts in a real BIM file does a downstream tool actually depend on, and does the
recovery carry them?**

Its governing principle happens to be the sharpest possible test of a recovery.
At one block per metre it is far past the resolution where geometry alone
survives — published voxel escape-route work finds vertical links stop surviving
above ~25 cm cells — so everything the player walks on or through is driven by
IFC *semantics*, with geometry only as a tie-breaker. A file can be
geometrically excellent and still convert into a building whose stairwells are
sealed.

Nothing here changes the converter. It is a reading of one consumer's contract
against this repository's own dated measurements, and a ranked list of what
would close the gaps.

> As everywhere in `docs/`, every figure is an observation from a dated run on
> **one building**. See [validating on a second
> building](validating-on-a-second-building.md).

## The consumer is pinned to this repository

It consumes Reviter as a **git submodule**, runs `scripts/extract-geometry.ts`
as a subprocess, and imports none of these modules. The coupling is the IFC file
and nothing else, which is the arrangement that lets the decoders here keep
changing: a recovery improvement cannot break a Minecraft world, because the
only thing the world depends on is the list of facts below.

That freedom has one price. A consumer that shells out cannot be caught by a
type error, so three things have to hold still, and
`tests/downstream-cli-contract.test.ts` now asserts them:

- `scripts/extract-geometry.ts` stays at that path;
- `model.rvt --out something.ifc` keeps selecting the IFC exporter, with
  `--revit-version` still accepted beside it;
- `package.json` keeps declaring `engines.node`, which the consumer's preflight
  reads rather than duplicating.

None of the three constrains what any decoder does. Because the consumer pins a
commit rather than a branch, breaking one of them is not an emergency — it
strands the consumer on the old pin until someone updates it — but it is silent,
which is why it is a test rather than a paragraph.

## The contract, and where the export stands

| What the consumer reads | Why it needs it | Reviter IFC4 today | Source |
| --- | --- | --- | --- |
| Z-up, metres, valid IFC4 | the voxel lattice | yes; both readers open it, `ifcopenshell.validate --rules` is clean | [2026-08-02](unbc-rvt-to-ifc-export-2026-08-02.md) |
| typed products | class → block, overlap priority | typed; **571** `IfcBuildingElementProxy` (1.5%) fall to a generic solid | [2026-08-19](unbc-independent-ifc-verification-2026-08-19.md) |
| **`IfcRelAggregates` on stairs** | stringer vs mullion; stairwell identity; spiral rebuild | **now written** — see below, with `PredefinedType` `.SPIRAL_STAIR.` where the helix replay proved the shape | `stair-assemblies.ts` |
| stair shape enum | spiral synthesis | written as `PredefinedType` (IFC4), which is correct; the consumer read only the IFC2X3 spelling until it was fixed there | — |
| `IfcDoor.OverallWidth` | leaf count | the opening's extent **along its host wall's centreline**, falling back to the footprint's own principal axis and then to the box | `export-ifc.ts` `hostedWidthFeet` |
| door body base | the door's floor level | 1,921 doors at **100.0% centre / 99.9% size** on the half-foot overlay | [2026-08-01](unbc-three-source-audit-2026-08-01.md) |
| `IfcSlab` / `IfcCovering` / `IfcRoof` | the walkable surface | 94 slabs against 107 tagged; "floor/landing recovery remains incomplete" | [2026-08-02](unbc-rvt-to-ifc-export-2026-08-02.md) |
| `FillsVoids → opening → wall` | replaying openings onto moved walls | present — 1,932 persisted relationships, none invented | [2026-08-02](unbc-rvt-to-ifc-export-2026-08-02.md) |
| `Tag` | joining two exports of one building | present; 41,709 also carry a native `UniqueId` | [2026-08-02](unbc-rvt-to-ifc-export-2026-08-02.md) |
| `GlobalId` | keying per-element overrides | derived from Reviter's own namespace; **does not match** Autodesk's | `export-ifc.ts:111` |
| geometry provenance | knowing which bodies are boxes | declared: 84.3% native, 8.5% reconstructed, **7.2% (2,797) bounds fallback** | [2026-08-19](unbc-independent-ifc-verification-2026-08-19.md) |

## Three things worth changing, in order

### 1. Carry the stair aggregation into the export — done

`lib/reviter/stair-assemblies.ts` joins the two sources and
`ConvertResult.nativeStairAssemblies` publishes the result; the exporter emits
one `IfcRelAggregates` per assembly, onto the stair's own product where it has
one and onto a **representation-less `IfcStair`** where it does not. The
container adds no surface — the runs, landings, stringers and railings already
draw the stair — so the display scene's reason for suppressing the wrapper is
untouched. What changes is that the file now says they are one stair.

Two properties are enforced rather than hoped for. A part is claimed by exactly
one assembly, because IFC4 gives every object at most one
(`IfcObjectDefinition.Decomposes : SET [0:1]`) and a landing shared between two
flights would otherwise emit a file no conforming reader should accept; and the
output is sorted rather than scan-ordered, because the exporter derives GUIDs
and entity order from it and a re-run of one file has to produce the same bytes.

`PredefinedType` is now `.SPIRAL_STAIR.` on a stair whose runs
`revit-2027-spiral-stair-mesh` recovered, and `.NOTDEFINED.` on every other.
That replay accepts a run only against matching inner/outer
`GCylindricalHelix` guides — coaxial, one angular interval, one pitch, exactly
the run's persisted `actualRunWidthFeet` apart — so a run it recovered is drawn
by a helical pair and is a helical run. The decoder's identity now travels:
`Revit2027NativeMeshCollection.spiralStairRunOwnerIds` records it where the
replay fires, `convert.ts` hands that set to `buildStairAssemblies`, and the
assembly carries `spiralRunIds` and `shape` to `export-ifc.ts`.

Two asymmetries are deliberate. `.NOTDEFINED.` remains the absence of a
reading and never a claim that a stair is straight or a half-turn — nothing
decoded here can read those. And an assembly that mixes a proven helical run
with a decoded run the replay declined stays undetermined, because the
consumer replaces *every* flight of a `SPIRAL_STAIR` with one synthesised
helix: an unlabelled spiral is a stair voxelized badly, while a mislabelled
straight flight is a straight flight deleted.

The rest of this section is what the gap was, kept because it is why the shape
of the fix is what it is.

It needed no new decoding.

`Revit2027StairsElementAggregate` already carries `runAndLandingIds`,
`registeredRailingIds` and `supportIds`; `Revit2027StairsRunAndLandingAggregate`
already carries its parent `stairsId` and its `stringerIds`. That is the whole
tree. `convert-element-geometry.ts` reads it to place run geometry and then
drops it: it never reaches `ConvertResult`, so `export-ifc.ts` cannot see it.
The only `IfcRelAggregates` in the delivered file are project → site → building
→ storeys, and reviewed spaces.

The consequence downstream is specific rather than cosmetic. Three separate
passes key on `element.Decomposes`, and each degrades *silently*:

- an `IfcMember` inside a stair is a stringer, not a curtain-wall mullion —
  without the parent it is voxelized as curtain-wall framing;
- flights whose assembly bounding boxes overlap are merged into one stairwell
  before the climb test, so a scissor pair is one shaft rather than two;
- flights of a spiral stair are routed to a synthesiser that rebuilds them as a
  climbable spiral, because a spiral voxelized at 1 m is an unclimbable blob.

A file with 108 flights and no containers passes every geometric check and
produces stairwells that a walkability audit reports as isolated.

The 2026-08-02 validation calls curtain-wall and stair wrapper aggregation
something that "can be added later without changing visible geometry". That is
true of the picture and it is the reason to separate two things the same note
otherwise keeps apart correctly: a container's *geometry* is duplicate and worth
suppressing — the same entry is right that container counts are not a geometry
failure signal — but a container is also the **relationship carrier**, and
suppressing the carrier deletes the relationship. The Autodesk file keeps 92
stair containers and 1,835 curtain-wall containers for exactly this reason. A
non-geometric `IfcStair` with an `IfcRelAggregates` to its recovered runs,
landings, stringers and railings adds no surface and restores the tree.

### 2. Derive `OverallWidth` from the host wall, not the bounding box — done

`export-ifc.ts` writes `max(dimensions.width, dimensions.depth)` — the larger
horizontal extent of the element's axis-aligned box. That is not a door's width
in two ordinary cases, and this building has both:

- **On a rotated wall it is a projection, not a width.** A quarter of this
  model's walls sit at 58° to the model axes. For a leaf of width `w` and
  thickness `t` at angle θ the box extents are `w·|cosθ| + t·|sinθ|` and
  `w·|sinθ| + t·|cosθ|`; at 58° a 0.9 m leaf reports 0.82 m. The number is
  angle-dependent, which a width is not.
- **The swing is inside the box.** [The 2026-07-28 door
  entry](unbc-door-window-opening-geometry-2026-07-28.md) settles that a door's
  record is its opening plus the swing. Where the swing is part of the recovered
  body, the box is the swing.

The consumer turns this into `round(OverallWidth / pitch)` leaves, so at 1 m a
door within about 10 cm of a half-metre boundary flips between one leaf and two.
Entrance banks — runs of three, four, even six leaves, which this model really
has — are exactly the population near those boundaries.

Both are now closed, and they took two different readings. The **rotated wall**
is answered by the footprint's own principal axis (`planarWidthFeet`), measured
below. The **swing** is not: a principal axis run down a quarter disc measures
the swing rather than the door, and reads *worse* than the box it replaced. So
the width is now taken along the host wall's centreline, which is the direction
that makes the number a width at all — an opening's width is its extent along
the wall it perforates, whatever the leaf does in front of it. The exporter
already looks the host relation up to write `IfcRelFillsElement`, so the wall's
rebuilt location line was in reach; `hostedWidthFeet` follows it.

### 2b. Measured on the building — done

Both changes run against the real RVT (`8c294549…`, 70,336,512 bytes) and the
consumer's gate read the result:

| | before | after | Autodesk's own export |
| --- | ---: | ---: | ---: |
| flights aggregated | **0 of 108** | **108 of 108** | 123 of 123 |
| `IfcStair` containers | 0 | 82 | 92 |
| doors within 0.1 cell of a leaf boundary | **394** | **9** | 35 |
| gate verdict | **FAIL** | WARN | WARN |

The door figure is the one worth dwelling on. 394 of 1,921 doors sat close
enough to a `round(width / pitch)` boundary that a small change in
`OverallWidth` flips them between one leaf and two — a fifth of every door in
the building, against 35 from the paired export. Reading the width off the
footprint's own principal axis instead of an axis-aligned box takes it to 9,
which is fewer than the export's. That is the whole argument for the change,
and it was worth measuring rather than asserting: the bounding-box rule was
wrong in a way that mattered at a scale nobody had put a number on.

### 2c. The swing, and what the host wall costs it

`planarWidthFeet` closed the rotated-wall half of §2 and was measured on the
building: 394 fragile doors down to 9. The swing half stayed open, and on a
footprint that carries its swing the principal axis is *not* the leaf's long
axis — it runs down the diagonal of the quarter disc, and the extent along it
is the swing.

Measured through `makeIfc` itself on the fixtures in
`tests/door-host-width.test.ts` (an extruded plan ring, a host wall solid whose
location line runs at the stated angle, and the persisted host relation),
reported width and the `round(width / 1 m)` blocks the consumer rounds it to:

| footprint | angle | true | box (pre-`69eddf0`) | principal axis | host wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3′0″ leaf | 0° | 0.914 / 1 | 0.914 / 1 | 0.914 / 1 | 0.914 / 1 |
| 3′0″ leaf | 32° | 0.914 / 1 | 0.829 / 1 | 0.914 / 1 | 0.914 / 1 |
| 3′0″ leaf | 58° | 0.914 / 1 | 0.829 / 1 | 0.914 / 1 | 0.914 / 1 |
| 5′0″ leaf | 0° | 1.524 / 2 | 1.524 / 2 | 1.524 / 2 | 1.524 / 2 |
| 5′0″ leaf | 32° | 1.524 / 2 | **1.346 / 1** | 1.524 / 2 | 1.524 / 2 |
| 5′0″ leaf | 58° | 1.524 / 2 | **1.346 / 1** | 1.524 / 2 | 1.524 / 2 |
| 3′0″ leaf + swing | 0° | 0.914 / 1 | 0.965 / 1 | 1.329 / 1 | 0.914 / 1 |
| 3′0″ leaf + swing | 32° | 0.914 / 1 | 1.303 / 1 | 1.329 / 1 | 0.914 / 1 |
| 3′0″ leaf + swing | 58° | 0.914 / 1 | 1.287 / 1 | 1.329 / 1 | 0.914 / 1 |
| 5′0″ leaf + swing | 0° | 1.524 / 2 | 1.574 / 2 | 2.191 / 2 | 1.524 / 2 |
| 5′0″ leaf + swing | 32° | 1.524 / 2 | 2.143 / 2 | 2.191 / 2 | 1.524 / 2 |
| 5′0″ leaf + swing | 58° | 1.524 / 2 | 2.127 / 2 | 2.191 / 2 | 1.524 / 2 |
| 6′0″ leaf + swing | 0° | 1.829 / 2 | 1.879 / 2 | **2.622 / 3** | 1.829 / 2 |
| 6′0″ leaf + swing | 32° | 1.829 / 2 | **2.563 / 3** | **2.622 / 3** | 1.829 / 2 |
| 6′0″ leaf + swing | 58° | 1.829 / 2 | **2.547 / 3** | **2.622 / 3** | 1.829 / 2 |

Three of the fifteen change block count, and they are the three the principal
axis gets wrong: a 6 ft opening drawn with its swing is a **three-block hole
punched for a two-block door**, at every angle including 0°, where the box it
replaced was right. The host wall reads the true width exactly in all fifteen.

The block counts are the grading the item asked for and they are honest, but
they are counts over a *fixture*, not over the building. What is still
unmeasured is the population: how many of the 1,921 doors reach the exporter
carrying their swing, rather than a leaf `door-leaf.ts` has already cut out of
it. That needs a decode of the real RVT and the consumer's gate, the same way
§2b was measured.

Two gates keep the projection from being worse than what it replaces. The wall
run's centreline must pass within half the opening's plan diagonal of it —
which is what refuses a host id that landed on the perpendicular wall at a
corner — and the projected extent must be at least half the footprint's largest
box side. Neither firing, or a curved host with no straight centreline, falls
back to the principal axis and then to the box.

### 3. Decide what `Tag` is for, and grade the bounds fallbacks by class

**Two exports of one building share no GlobalIds.** Each producer derives them
its own way; Reviter compresses a hash of `namespace:kind:key`. Anything keyed
on GlobalId — a curated per-door overrides file, a per-element diff between two
builds — matches nothing across producers. Both files do write the Revit element
id into `Tag`, so `Tag` is the join that works, and the consumer should key on it
(that is filed on its side).

Whether the two could be made to agree is a genuinely measurable question rather
than a matter of taste. Autodesk derives its GlobalId from the element's Revit
`UniqueId`, and this recovery has the `UniqueId` for 41,709 elements. The paired
export supplies 38,187 known answers, so any candidate derivation can simply be
scored against them. It is worth an hour before it is worth an opinion.

**The 2,797 bounds fallbacks need a class breakdown, not a percentage.** An
axis-aligned box is nearly harmless for a wall, because a wall is a box. For a
stair it is a solid cube that seals the stairwell it stands in; for a railing it
is a wall where a guardrail belongs. The provenance property set already carries
what is needed to separate them, and the overlay already says where to look:
`IfcStairFlight` scores **75.0%** on both centre and size against the paired
export, against 99.8% for members and 100.0% for plates. Reporting
`bounds-fallback` per native category — rather than as one figure — turns 7.2%
into the short list of elements that will actually break a downstream model.

## One thing to offer that nothing else has

Neither source carries room semantics: the RVT reports `Rooms: 0` and the paired
IFC `IfcSpace: 0`. Reviter nevertheless *derives* zones from recovered walls —
[135 zones on level 311 from 1,989 wall records at a 1.4 ft grid, in about
0.45 s](unbc-cad-floor-audit-2026-08-01.md) — and labels them **Inferred**,
never as native Revit Rooms. The exporter can already write reviewed rooms as
`IfcSpace`.

That inference is worth more to a voxel consumer than to a viewer. Rounding a
building to 1 m cells merges any two walls closer than about 1.5 m into solid
mass, which swallows small rooms whole; on this model roughly 250 doors end up
opening into rooms that no longer exist, and the consumer has to *guess* from
voxel occupancy whether there was a room behind each one. A zone map computed at
full model resolution — before rounding destroys the evidence — answers that
directly, and it answers a second question too: an unreachable region that
contains no room does not need a corridor synthesised to reach it.

The honest framing is the one already in place. These zones are inferred, they
can merge across incomplete walls, and they are not Rooms. A consumer that
treats them as a *hint about where a room was* is using them for exactly what
they support, which is not true of a consumer that would label them in a
viewer.

## Two notes on coordinates

**This export is in project-internal coordinates.** Reviter reads Revit's
internal frame and does not apply a project base point or survey point; the
Autodesk export may carry shared coordinates. So the two files are not in the
same place, and any element-by-element comparison between them needs a
registration first. The method is already established here: pair elements whose
axis-aligned bounds agree to 0.01 ft on all three axes and let each pair vote.
On 2026-08-13 that put **1,642 pairs in a single 0.01 ft bin** against 122 for
the runner-up, and [the same
entry](unbc-glb-registration-and-stair-waist-2026-08-13.md) records
bounding-box centres and footprint overlap being tried first and being wrong by
feet. It transfers from IFC↔GLB to IFC↔IFC unchanged.

**The export is Z-up, and one of our own tables can be misread as saying
otherwise.** The 2026-08-02 validation reports the model spanning
"217.898923 × 19.400000 × 375.120452 metres", with the height in the middle.
That is web-ifc's axis convention, which is why the audit names the field
`spansWebIfcAxesMetres` — the file itself writes storey elevations on Z and
extrusions along `IFCDIRECTION((0.,0.,1.))`. Naming the field for its frame is
what keeps that readable; anyone re-deriving a transform from the printed triple
would insert a swap that is not needed.

## What closing these gaps would and would not establish

It would give this repository its first consumer-side test: an oracle that fails
on a missing *relationship*, which no schema validator and no triangle count can
see. The three IDS specifications already check that every wall and door carries
identity and states its provenance; none of them can check that a stair knows
its own flights, because nothing in the file has ever needed to know.

It would not say anything about a second building. Every rule here is still
fitted to one model, and joining a second tool to it doubles the tooling on the
same file. The part that transfers is the shape of the question — the consumer's
contract is a list of facts a *file* must carry, so it can be checked against a
model nobody here has seen.
