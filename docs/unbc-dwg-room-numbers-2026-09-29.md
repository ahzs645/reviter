# UNBC room numbers from the survey DWG, 2026-09-29

The supplied UNBC model (`unbc.rvt`, Revit 2027, 12 levels) has **no native
Rooms**, and Autodesk's paired IFC has no `IfcSpace`. The campus survey drawing
(`UNBC floor plan Basic.DWG`, 9.8 MB) numbers almost every room on 53 floor-plan
sheets. This entry records how those numbers were turned into room boundaries
on the Revit levels, and how the boundaries are carried to Pascal and IFC. All
figures come from runs on 2026-09-29 against these two files.

The work landed in five steps, each measured before the next was built on it:

| Step | Commit | Code |
| --- | --- | --- |
| Read the DWG's room tags | `dfcfd60` | `lib/reviter/dwg-entities.ts`, `dwg-plan.ts`, `dwg-room-labels.ts`, `scripts/dwg-room-labels.ts` |
| Register each sheet onto a Revit level | `7332a2a` | `lib/reviter/dwg-registration.ts`, `scripts/register-dwg-sheets.ts` |
| Heal the model's wall joins | `dff7a0a`, `60ac18c` (and `b62051f`, curved walls) | `lib/reviter/heal-walls.ts`, `export-pascal.ts` |
| Carry rooms through Pascal and IFC | `86e97ba` | `lib/reviter/room-annotations.ts` |
| Build one room per label | this entry | `lib/reviter/dwg-rooms.ts`, `scripts/build-dwg-rooms.ts` |

## Result

- **1,855 rooms from 1,864 labels** on the 38 registered sheet drawings (36
  sheets plus two halves of a split sheet). No label that was placed failed to
  make a room. The 9-label difference is loose TEXT repeating a tagged number on
  the same sheet. Each of those became a second seed of the tagged room instead
  of a second room.
- **360 of the DWG's 2,224 labels have no room**, because they sit on the 16
  sheets that did not register. Of those, 11 sheets are buildings or floors the
  RVT does not model (Physical Plant, EFL, Maintenance, Northern Sports Centre,
  Bioenergy, Teaching Lab penthouse), and 5 registered only ambiguously.
- **1,410 rooms (76 %) are closed.** A closed room's barrier-closed region holds
  no other label and does not reach outside. 443 shared their region with other
  labels and were split by the flood. Only 2 regions reach the exterior.
- **Confidence:** 1,387 rooms at ≥ 0.9, 9 at 0.75–0.9, 455 at 0.5–0.75, and 4
  below 0.5.
- **Offices:** 530 of the 586 rooms named "Office" are closed. Their median area
  is 9.3 m², with 5th–95th percentiles of 7.5–18.6 m².
- The Pascal scene with 1,855 `zone` nodes passes Pascal's own
  `validateBuildJson` with **0 schema issues** on both repository HEAD
  `d819ad4` and npm `@pascal-app/core` 1.0.3.
  - HEAD's only warnings are the 141 `opening_outside_wall` warnings the healed
    scene already had.
  - npm reports no warnings.
- The IFC holds **1,855 `IfcSpace`**. `web-ifc` 0.0.77 opens the file, finds
  a body on every space, and tessellates all 1,855 of them. A space's `Name` is
  its number, e.g. `10-B510`, and its `LongName` is the room name.
- **Runtime:** 256 s end to end, single-threaded:
  - converting the RVT: 63 s;
  - healing wall joins: 131 s;
  - decoding the DWG: 10.5 s;
  - the room flood on all 21 sheet clusters: 9.6 s;
  - the IFC: 12 s;
  - the 17 verification PNGs: 28 s.

Per building (labels on registered sheets → rooms, closed):

| Building | Registered sheets | Labels | Rooms | Closed | Labels on skipped sheets |
| --- | ---: | ---: | ---: | ---: | ---: |
| 02 Physical Plant | 0 | 0 | 0 | – | 51 (not modelled) |
| 03 CJMH | 4 | 310 | 310 | 253 | 0 |
| 04 Research Lab | 8 | 215 | 215 | 194 | 4 (L5 penthouse, ambiguous) |
| 05 Library | 4 | 250 | 248 | 131 | 19 (basement, ambiguous) |
| 06 Conference Centre | 2 | 95 | 95 | 65 | 9 (basement, ambiguous) |
| 07 Agora | 3 | 213 | 206 | 108 | 25 (L0/L2 sheet, ambiguous) |
| 08 Teaching Lab | 4 | 236 | 236 | 201 | 3 (penthouse, not modelled) |
| 09 NHSC | 2 | 126 | 126 | 95 | 47 (LVL 1, ambiguous) |
| 10 Teaching & Learning | 11 | 419 | 419 | 363 | 12 (atrium L2/L3, L5 mech) |
| 11 EFL, 12 Maintenance, 14 NSC, 19 Bioenergy | 0 | 0 | 0 | – | 190 (not modelled) |

A building is the one the sheet belongs to. Agora 1C carries 14 Library
`05-1xx` rooms, and they count under 07 here.

Rooms per Revit level: L3 `311` (0 ft) 396 · L6 `694` (14.4 ft) 501 · L8
`400176` (24.3 ft) 325 · L10 `402367` (34.1 ft) 346 · L4 `1487816` (3.3 ft) 165 ·
L2 `1450417` (−3.3 ft) 65 · L9 `1487353` (29.9 ft) 47 · L1 `2295121` (−7.2 ft) 10.

## 1. The DWG's room tags (`dfcfd60`)

The full record is `work/findings/dwg.md`. The short version:

- **The room number is an attribute.** It is the `ROOMNUM` ATTRIB of a
  `room_data` block reference on layer `0_room_data`. The same INSERT's
  `ROOMUSE` ATTRIB is the room's name ("Office" ×616, "Corridor" ×199, "Stair"
  ×95). Both are centre-justified on the INSERT point, which is the middle of
  the room.
- **There are 2,224 labels:** 2,197 tags plus 27 loose TEXT numbers. One label
  is malformed (`?????????`, on 09 Med LVL 1). Numbers are `BB-RRRR`, with the
  building first. `03-S201` appears twice: once on CJMH L2, and once on the
  "02 Plant LVL 1" sheet, which did not register.
- **The drawing is in millimetres.** The header says unitless, but the 8 m scale
  bar is 8,000 units long, and registration later fitted a free scale of
  0.9995–1.0006 × 10⁻³.
- **No room boundaries are drawn.** Only 3 closed polylines outside the sheet
  frames exceed 3 m², so boundaries have to come from the walls.
- **Parser fixes were needed before any label could be read:**
  1. Attribute values were dropped entirely. LibreDWG nests them under
     `raw.text`, and the INSERT's attributes were never emitted.
  2. Text had no bounds, so no sheet or section ever contained a label.
  3. Justified text was read at its left baseline, about 0.5 m left of the
     tag's centre.
  4. MTEXT formatting codes and TEXT `%%` codes were kept verbatim.
  5. Arc bounds were whole circles.
  6. The OCS extrusion (0, 0, −1) that MIRROR leaves was ignored, which drew
     1,274 ARCs and 129 CIRCLEs reflected out to x = −721,017.
- **Sheets are layouts.** The 54 paper-space layouts name the plans. One of
  them, "Full Campus Main Floor", is an overview, which leaves 53 sheets. Each
  label is assigned to exactly one sheet.

## 2. Registering sheets onto Revit levels (`7332a2a`)

The full record is `work/findings/registration.md`, and the per-sheet data is in
`work/findings/dwg-registration.json`.

- **Method.** For each sheet, the `1_Wall_Exist` linework is sampled. Candidate
  rotations come from wall-bearing histograms. An FFT cross-correlates the
  sheet against a high-passed proximity map of every level's wall faces, and
  robust point-to-line ICP refines the best candidates. The level is the one
  whose wall faces the placed sheet lies on best, scored as the share of sheet
  points within 0.15 m of a face.
- **Result.** 38 records registered, 10 were ambiguous and 17 were no-match. That
  is 53 sheets plus 12 split parts. Every registered sheet fits with an RMS of
  27–63 mm and an inlier share of 51–82 %. Rotations are clean multiples of the
  campus grid: 90°, 122°, −148°, 180°, −90° and −58°.
- **Every sheet is mirrored** relative to Pascal's plan. Pascal's plan axis is
  −Y, so DWG → Revit feet is a proper rotation. `dwgToFeet` in
  `build-dwg-rooms.ts` composes the registration matrix with the Pascal frame,
  and a test checks that its determinant is positive.
- **Level choice, and the one override.** The T&L atrium's full-height walls
  are modelled once, on the ground floor, so "10 TandL Atrium LVL 4" fits L4
  (3.3 ft). Its siblings put floor 4 on L10. `emissionLevel` uses the level every
  other registered sheet of that building and floor agrees on whenever the
  sheet's own level is not among theirs. Split parts are exempt, because they
  inherit their parent's floor name. On this data the rule fires exactly once:
  Atrium LVL 4, from `1487816` to `402367`.
- **The frame still agrees at build time.** For each sheet, the build measures
  the share of DWG line samples within 0.5 ft of a model barrier on its level
  (`dwgOnModelShare`). It is 0.69–0.92, with a median of 0.86. The lowest are
  the Conference Centre L3, where the RVT chords the DWG's true arcs, and the
  atrium on L10, whose walls are modelled on L4.

## 3. Healing wall joins (`dff7a0a`, `60ac18c`, `b62051f`)

The full record is `work/findings/walls.md` and
[Exporting to Pascal § Wall joins](pascal-scene-export.md).

- **The model's joins are graphical.** 14,334 of 14,884 straight-wall ends
  (96 %) are open on their location lines. Most stop exactly at the partner's
  near face, and Revit cleans the join up in its drawing. Autodesk's own IFC
  ends the `Axis` at the same point for 96 % of them. The model was authored
  this way; it is not a parser artifact.
- **Real gaps are a minority.** 708 ends stop short of a crossing wall and 377
  stop short of a collinear continuation. There are two populations: under 2 cm
  (snapping slop) and 0.2–1 m (deliberate breaks).
- **`healConvertResult`.** It moves ends only along their own axis: at most
  0.35 m, closing gaps of at most 0.15 m, with a contact guard. It makes 7,958
  end moves and takes line-open ends from 14,334 to 6,280 and body-open ends
  from 2,099 to 1,158. The Pascal export (`healJoins`) records every move on
  its wall node.
- **Curved walls.** `b62051f` fixed mirrored curved walls, which were rejected
  for a left-handed cylinder frame. That brought 10 missing walls into the
  Pascal export (curved walls went from 68 to 78).
- **What healing is worth to rooms.** The room raster seals any gap narrower
  than about 0.17 m by itself. Healing therefore matters for the 0.1–0.15 m
  gaps it closes, and for making the Pascal walls mitre. It does not decide
  room shapes. The rooms are built from the healed result so that the zones and
  the Pascal walls agree.

## 4. The room builder (`lib/reviter/dwg-rooms.ts`)

`roomRegions(input, options)` is pure. It takes one level's barriers and label
seeds in Revit feet. The four adapters at the end of the module build those
inputs: `levelRoomBarriers`, `levelFloorBound`, `dwgPrimitivesWithin` and
`dwgBarrierSegments`.

### Barriers

Everything is rasterised on a **0.4 ft (0.12 m) grid**. A cell is a barrier if
its centre is within the barrier's half-thickness, and never less than 0.71 of
a cell. That minimum makes a single drawn line seal a 4-connected flood at any
angle.

- **RVT walls** cut the plan 4 ft above the level, like `derived-rooms.ts`. That
  includes walls from any level whose height spans the cut, because a two-storey
  wall based on the floor below still divides this one. The inputs are healed
  wall solids, arc chords, curtain panels and mullions (from their oriented
  boxes). Across all sheet windows that is 40,713 wall segments and 23,448
  curtain elements.
- **Door closures (6,419).** Each door's own box footprint is used, widened to
  its host wall's thickness. The model's wall solids run straight through their
  door openings (door 1031690's host 978609 is a single solid across the
  1,600 mm opening), so these mostly close curtain-wall doors and openings
  modelled as wall gaps.
- **DWG linework.** This is the sheet's `1_Wall_Exist` layer, transformed into
  feet. Of 146,196 lines and 11,259 arcs and circles on the registered sheets:
  - all lines are kept. An earlier version dropped lines under 46 mm, but 82 %
    of the 126,619 such lines are links in a chain (curves drawn as runs of tiny
    segments), and dropping them opens the curve.
  - **534 arcs with a radius of at least 8 ft** are curved walls and are chorded.
  - **1,744 door swings** (radius 1.8–4.3 ft, sweep 90° ± 12°) are replaced by
    their two radii: one closes the opening, and the other is the open leaf.
  - **8,066 other arcs and 915 circles are dropped.** These are fixtures,
    columns and small swings.
  - **2,211 stair-tread lines are dropped.** A run is at least 5 parallel lines
    of equal length (±15 %), overlapping along their length and ≤ 1.3 ft apart.
    The T&L stairs draw each tread twice, with a nosing line 25 mm off. The
    first version stopped the run at those doubled lines and dropped nothing
    there, which left stair rooms cut into strips.
- **Bound.** The level's floor slabs are the bound (`Floors` category members of
  the level). A free cell outside every slab starts as exterior. Slab openings
  smaller than 1,000 ft² are filled, because stair wells are slab holes and a
  stair room's flights stand in one. Larger openings, such as the CJMH L2 atrium
  void, stay exterior. Slabs cover the level only patchily: 890 of the 1,864
  seeds sit outside every slab. A seed outside the bound lifts the bound for its
  whole barrier-closed component, so those rooms are bounded by walls alone.

### Flood

The flood is a **seeded watershed** on the free-space distance transform. The
priority is each cell's clearance from the nearest barrier, **capped at half a
neck width (2 ft)**.

- **Floor wider than 4 ft is one level.** It floods breadth-first from every
  label at once, so labels sharing a corridor or an open-plan area split it by
  distance.
- **Narrower openings are crossed last.** An unclosed door (clearance ≈ 1.5 ft)
  or a wall gap is crossed only after all the wide floor either side is
  claimed. Two rooms that leak into each other therefore meet at the leak.
- **The exterior is a competitor.** It starts from the window's edge and from
  cells outside the bound, so a leak to the outside becomes a boundary instead
  of a room the size of the site.

Two findings from looking at the plans shaped this:

- **An uncapped clearance starves labels.** The first version ordered every
  cell by its exact clearance. A label placed near a wall then lost the whole
  of a shared corridor to a label that had reached the corridor's centreline
  first. The watershed runs along the ridge before a low seed ever pops.
  153 rooms came out under 1 m², including corridor 10-2026 at 0.05 m².
- **The fix has two parts.** First, the priority is capped as described above.
  Second, each seed **climbs the clearance** to open floor before the flood,
  claiming its path. After the fix, 17 rooms are under 1 m², and those are
  mostly real closets or labels in slivers.
- **The fix is tested.** "a label drawn against a wall still gets its share of
  a corridor" checks it.

### Seeds

- **One seed per label.** The point is the tag's registered anchor. Loose TEXT
  whose number matches a tag on the same sheet becomes a second seed of that
  room (9 cases).
- **A seed inside a barrier** moves to the nearest free cell within 3 ft. This
  happened 23 times, and the largest move was 1.8 ft.
- **Two rooms never share a marker cell.** Duplicate numbers with different
  INSERT handles stay separate rooms. Duplicates across levels are listed in
  the report: `07-400`, `07-203`, `06-213`, `06-S204` and `06-S205`. All are
  TEXT cross-references between sheets.
- **Malformed numbers are skipped and reported.** The one on the survey,
  `?????????`, is on a sheet that did not register.

### Polygons

- **Smoothing.** Each region is closed and then opened with a 3 × 3 square.
  This fills the one- and two-cell slits that drawn door leaves cut, and drops
  one-cell spurs. A cross-shaped element was tried first. It chamfered every
  corner, and Douglas–Peucker then skewed rectangles.
- **Tracing.** The boundary is traced along cell edges (outer ring
  counter-clockwise; holes clockwise and kept if ≥ 4 ft²). It is simplified by
  Douglas–Peucker at 1.5 cells (0.6 ft), which puts the 58° and 32° wings on
  their true angle rather than snapping them to the axes. The median room has
  8 vertices (95th percentile: 27), and 24 rooms have holes.
- **Disconnected regions.** A region that comes out in pieces keeps its
  largest piece. This happened to 6 rooms.

### Diagnostics and confidence

Per room the report records:

- `closed` and `sharedComponent`: how many labels share the room's
  barrier-closed component (median 5 for a shared component; the maximum is 70,
  on Agora 1S);
- `competedWith`: the rooms it touches with no barrier between;
- `touchesExterior` and `componentOpen`: whether the room, or its component,
  reaches the exterior;
- `nudgedFeet` and `outsideBound`: how far the seed moved off a barrier, and
  whether it sat outside every slab;
- `closedByRvt` / `closedByDwg`: whether the RVT walls and doors alone, or the
  DWG lines alone, would have closed the room;
- `dwgRegionIoU`: the overlap with the region the DWG lines alone enclose, where
  that region is closed and under 20,000 ft².

`roomConfidence` starts at 0.9 when the room is closed, 0.65 when its
component is shared, and 0.4 when its component is open. It then adjusts:

- +0.1 when the DWG-only region matches (IoU ≥ 0.85);
- −0.15 when the room touches the exterior;
- −0.1 when the seed was moved more than 0.5 ft;
- −0.3 when the room is under 10 ft².

Measured:

- **Neither source closes rooms alone.** The RVT alone closes 618 rooms and the
  DWG alone closes 994. Together they close 1,410, and 389 of those closed
  rooms need both sources.
- **Where the DWG alone closes a room, the result agrees with it.** The IoU
  median is 1.00 and the 10th percentile is 0.93. The DWG was drawn for these
  labels, so this is the check that the fused raster did not distort the
  rooms.

### What the plans show

Verification plans are in `work/findings/rooms/`. There is one PNG per
registered sheet on L3 `311` (the ground floor of CJMH L0, Res Lab L1, Library
L1 and Agora L1) and on L6 `694` (T&L 2000W/2500E, CJMH L1, Teaching Lab L2,
and others), plus CJMH L2 on L8. Each shows RVT walls in grey, door closures in
orange, DWG lines in blue, room fills, and number, name and confidence. The
outline is black when the room is closed, amber when it is shared, and red when
it is open.

- **Cellular floors come out room for room.** On T&L 2000W, CJMH L1/L2 and
  Teaching Lab L2, every office along a corridor is its own closed room.
- **Doorways do not leak.** Corridors do not bleed into offices through their
  doors.
- **The CJMH L2 atrium void stays empty.** It is a large slab opening.
- **Corridors are split into the DWG's own numbered segments.** The DWG numbers
  a corridor loop in segments (T&L 2000W has 10-2002, 10-2010, 10-2026 and
  10-2066; CJMH L2 has four). The flood splits the loop between those labels
  by distance. The split lines are straight cuts across the corridor wherever
  the fronts met. They do not follow any drawn line, because none exists.
- **Stairs.** Removing treads gives most stair rooms their flights: 63 of 75
  stair rooms are closed, with a median of 10.5 m². Some still end at a
  handrail or wall line drawn between landing and flight. 10-S201 on T&L 2000W
  is one example.
- **Open-plan floors are split into Voronoi-like cells.** On Library L1 and
  Agora 1C, open areas carrying several labels are divided by straight
  boundaries. The labels are the only evidence of where one "room" ends, so
  these rooms carry 0.65 and should be reviewed.

## 5. The round-trip format (`86e97ba`)

`work/findings/export-format.md` is the full record. Rooms are stored as a
**`RoomAnnotationSet` sidecar in Revit model feet**
(`work/out/unbc.rooms.json`, `format: "reviter-room-annotations"`). Pascal
metres depend on the conversion's centring origin, which moves whenever the
RVT's outermost drawn element moves. Each annotation carries:

- `key`: minted once from the DWG INSERT handle (`rm-<level>-<hash>`);
- `levelId`, `number`, `name`, `polygonFeet`, `holesFeet` and `labelPointFeet`;
- `source` per field: number and name `dwg`, polygon `derived`;
- `dwg` provenance: file name, SHA-256, sheet, INSERT handle, tag, layer, raw
  text, the anchor in DWG units, and a registration id (sheet key plus the
  hash of its matrix);
- `confidence` and `heightFeet`.

`heightFeet` is the building's storey height: the gap to the next registered
floor above, else the one below, else 12 ft. It is a floor-to-floor height, not
a ceiling height, and the IFC needs one to extrude a space.

Re-running the build **merges** into an existing sidecar through
`mergeRoomAnnotations`, matching by key, then DWG handle, then number. Fields a
person edited (`source: "manual"`) are never overwritten. A changed proposal
for a manual field is recorded as a conflict, and a deleted room stays a
tombstone. `--fresh` starts over.

The same annotations are written two ways:

- **Pascal.** `appendRoomZones` writes one `zone` per room: `spaceRole: "room"`,
  `roomNumber`, name, the polygon in the scene's frame, colour by review state,
  and the full record in `metadata.reviter`. Each zone sits under its level
  node. Before appending, the build checks that the input scene is in this
  conversion's frame. It compares the stamped `site.metadata.reviterFrame`, or
  failing that, one healed wall's start (0.000000 m off on this run).
- **IFC.** `annotationsToReviewedRooms` feeds the existing IfcSpace path in
  `export-ifc.ts` through `makeIfcCenterlines(result, { rooms })`. `export-ifc.ts`
  did not change: `Name` is the room number, `LongName` the room name, the
  `Reviter_RoomReview` Pset carries the provenance, and the space is an
  extruded solid under its exact storey. IfcSpace GUIDs are `guid("space",
  "ann-<key>")`, so they become stable across RVT revisions once the GUID
  namespace fix planned in `export-format.md` §5 lands.

`npm run extract` gained **`--rooms <sidecar.json>`** for `.pascal.json` and
`.ifc` outputs, so a fresh export can carry an existing sidecar without the DWG.

## 6. Re-running the pipeline end to end

From the repository root, with `work/unbc.rvt` and `work/floorplan.dwg`:

```sh
# 1. Labels (≈ 11 s) — optional; the room build re-reads the DWG itself.
node --experimental-strip-types scripts/dwg-room-labels.ts work/floorplan.dwg \
  --json work/findings/dwg-room-labels.json

# 2. The healed Pascal scene the registration and zones are placed in (≈ 3 min).
npm run extract -- work/unbc.rvt --out work/out/unbc.healed.pascal.json

# 3. Register every sheet (≈ 7 min). Registration was fitted against the
#    unhealed export; the frame is the same, and healing moves ends by ≤ 0.35 m.
npm run extract -- work/unbc.rvt --out work/out/unbc.pascal.json --no-heal-joins
node --experimental-strip-types scripts/register-dwg-sheets.ts work/floorplan.dwg work/out/unbc.pascal.json \
  --json work/findings/dwg-registration.json

# 4. Rooms (≈ 5 min): sidecar, report, Pascal zones, IfcSpaces, verification plans.
node --experimental-strip-types scripts/build-dwg-rooms.ts work/unbc.rvt work/floorplan.dwg \
  work/findings/dwg-registration.json \
  --out work/out/unbc.rooms.json --report work/out/unbc.rooms.report.json \
  --pascal-in work/out/unbc.healed.pascal.json --pascal-out work/out/unbc.rooms.pascal.json \
  --ifc-out work/out/unbc.rooms.ifc \
  --svg-dir work/findings/rooms --svg-level 694 --svg-level 311 --svg-sheet "03 CJMH LVL 2" --png

# 5. Validate the Pascal scene with Pascal's own validator
#    (harness in work/pascal-validate/, see export-format.md "Reproducing").
node work/pascal-validate/validate-file.mjs work/out/unbc.rooms.pascal.json head
node work/pascal-validate/validate-file.mjs work/out/unbc.rooms.pascal.json npm

# Later exports can carry the sidecar without the DWG:
npm run extract -- work/unbc.rvt --out model.pascal.json --rooms work/out/unbc.rooms.json
npm run extract -- work/unbc.rvt --out model.ifc --rooms work/out/unbc.rooms.json
```

Step 4 without `--pascal-in` exports the Pascal scene itself with `healJoins`,
which heals a second time. Step 4 also takes `--cell` (default 0.4 ft) and
`--fresh`, which ignores an existing sidecar.

## Limitations and open items

- **Unregistered sheets have no rooms.** Five sheets are ambiguous: Library
  basement, Agora L0/L2, Conference basement, NHSC L1 and the T&L atrium L2/L3.
  Their floors are only partly modelled, or two plans share one sheet. The
  registration record keeps their best placement. Emitting them would need a
  per-sheet override of level and placement.
- **Shared components are split by distance, not by evidence.** That covers
  443 rooms, mostly corridors, open plan and reception/work-area suites. The
  split is where the flood fronts met. These carry 0.65 and should be reviewed
  first.
- **Slabs are a weak bound here.** 890 seeds are outside every slab. Enclosure
  therefore rests on walls and DWG lines. The 2 rooms whose components reach
  the exterior are 06-215 Vestibule (an entrance) and 03-S303 Stair.
- **Some stair rooms stop at a drawn handrail line** between landing and
  flight.
- **The zone is not linked to its walls.** It is not `autoFromWalls`, so moving
  walls in Pascal does not re-trace it. `boundaryWallIds` could be filled from
  the walls whose cells border each region.
- **Heights are storey heights.** `heightFeet` is floor to floor.
