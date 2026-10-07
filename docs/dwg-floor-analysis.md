# Source-bound DWG floor analysis

Run `npm run cad:analyze` to reproduce the room/door/stair analysis developed in the separate OpenIndoorMaps CAD preview, using Reviter's current guarded door recognizer and floor-reference fitter. The output remains a separate drawing review package. It does not merge into the native model, create floor stops, assign access or generate routes.

## Input and command

The input is a saved `openindoormaps-cad-intake` version 1 folder derived from a DWG: `intake.json`, original `source/` drawing bytes, and checksummed `stage/floorplans.dxf`. The existing DWG decode/conversion and panel intake happen before this analysis. This command does not automatically infer trustworthy units or building identities from an arbitrary raw drawing. `--review` can supply the separate staged DXF folder when it is not inside the intake.

Install the Python dependencies in a virtual environment using `tools/dwg-analysis/requirements.txt`, then run:

```sh
npm run cad:analyze -- \
  --intake /absolute/path/cad-intake \
  --python /absolute/path/venv/bin/python \
  --out /absolute/path/new-reviter-cad-analysis
```

Output must be a new path. Source DWG, DXF and intake hashes are checked before and after extraction; a failure leaves its candidate directory recoverable. The canonical UNBC master and other chats' outputs are not replaced.

`tools/dwg-analysis/` carries the source-bound Python extraction helpers originating in OpenIndoorMaps, including its tested analytic short-jamb/closed-leaf supplement, tread grouping, bounded stair/possible landing recovery, polygon-hole preservation and illustrative GLB exporter. The copied intake helper/config are dependencies for the saved intake format, not a generic claim that UNBC panel rules apply to every DWG. Coordinate rules stay out of the application UI. Update the focused tests when changing either copy of these helpers.

## Results and preview

Serve the output on localhost and open `index.html`. The **Floor alignment and connections** section shows the current floor's alignment status, possible adjacent-floor matches and separate buttons to inspect each footprint. Source primitives and local room identities stay intact. A control fit defines a separate comparison transform; it does not alter the original per-floor drawing or place it on the campus.

The ZIP includes:

- `geometry.json`, source handles, room records, supported doorway thresholds, exact treads and bounded footprints;
- `detection-review.json`, unresolved room boundaries, arcs and stair-label ownership;
- `floor-analysis.json`, source/implementation bindings, orientation status, comparison transforms, unique stair correspondences, skipped/missing floors and ambiguous matches;
- `floor-controls.template.json`, the source-bound control-pair format;
- original DWGs, conversion evidence, the standalone viewer and schematic GLBs.

Floor comparisons sort explicit drawing ordinals and compare consecutive floors in the same building only. They use actual polygon overlap including holes, require unique reciprocal matches above 30% overlap, and omit areas with conflicting non-stair labels. A higher score cannot break an ambiguous match. Weak original alignment remains flagged. A missing intermediate floor is not silently bypassed.

## Check orientation using original features

Copy `floor-controls.template.json` to a separate review file. For each floor being aligned, supply at least three distributed source controls, directly referenced to the building's lowest-ordinal drawing. Remove entries you are not reviewing; empty pairs intentionally fail validation.

```json
{
  "floorId": "cad-11-2",
  "referenceFloorId": "cad-11-1",
  "pairs": [
    {
      "id": "west-original-rail-contact",
      "sourceHandle": "original-upper-drawing-handle",
      "referenceHandle": "original-base-drawing-handle",
      "pointMetres": [0, 0],
      "referencePointMetres": [0, 0]
    }
  ]
}
```

This fragment illustrates the fields; one point is insufficient. Coordinates must be on the indicated original primitives in `geometry.json`'s existing building-local metres, not raw sheet units or geographic coordinates. Select corresponding structural contacts, rails or other independently identified features; do not select presumed stair destinations just to increase overlap.

Keep the template's exact intake/source hashes. Run again with `--controls /absolute/path/reviewed-controls.json` and a new `--out`. Reviter's similarity fitter checks the unit scale to 0.1%, then produces a rigid rotation/translation without rescaling the drawing. At least three non-collinear controls must contact original finite strokes within their 20 μm display rounding allowance. All points participate: none are silently discarded. Maximum residual is 0.1 m and RMS is 0.05 m. Cross-building, chained, duplicated, stale, reflected, stretched or floating-point controls are refused.

A control-checked drawing correspondence still needs actual flight/landing continuity, floor elevations, served entrances, support and access evidence before entering the native preparation workflow. Tread count alone does not establish rise, direction, landing height, public access or wheelchair service.

## Checks

```sh
node --experimental-strip-types --test tests/dwg-floor-analysis.test.ts
/path/to/venv/bin/python -m unittest discover -s tests -p 'cad_*_test.py'
npm run typecheck
npm run build:pages
```

Inspect room/stair selections and floor comparison buttons on desktop/mobile. Recheck original source bytes, all manifest hashes and ZIP CRC before handing off the separate package.

## Every-building audit and Reviter workspace

The **DWG floor review** button in Reviter opens a separate workspace without replacing the loaded native model. Open a ZIP produced by `cad:analyze`. The ordinary **Open** action and dropping a ZIP also recognize this format by its root file identities and open this workspace automatically. This dispatch does not approve the package: parsing, hash checks, JSON extraction and preparation of the embedded drawing document still happen in a worker. Model project ZIPs retain their strict importer. The application renders its bundled viewer code; imported ZIP HTML is never executed. The original native workspace remains available through **Return to model**. **Download coverage audit** saves the complete sheet/pending-panel inventory.

**Compare floor layout** overlays another drawing from the same building in 2D using the report's separate comparison transforms. Purple dashed strokes are original source geometry; they do not certify supported slab or occupied space. Original per-floor geometry remains unchanged. **Labelled stair families** lists each source room label, its drawing level and nearby footprint hints. A recurring family with an unrepresented intermediate level stays flagged; it does not create a skipped-floor route. Label anchors and proximity are not landings.

To extend a previously preserved missing-building intake to all source sheets:

```sh
/path/to/venv/bin/python tools/dwg-analysis/build-campus-floor-intake.py \
  --review /absolute/original-cad-review \
  --existing-intake /absolute/preserved-missing-building-intake \
  --out /new/all-building-intake
npm run cad:analyze -- --intake /new/all-building-intake \
  --python /path/to/venv/bin/python --out /new/all-building-analysis
```

Registered split panels retain each original panel's rotation and translation. They are assembled into common building-local coordinates rather than merged in arbitrary sheet positions. A single unregistered panel uses dimension-preserving provisional wall correlation against a registered reference. A composite panel may be separated only when its disconnected source wall groups have unanimous native-level identities, consistent room-number floors and exactly one matching saved registration. Otherwise it remains in `pendingPanels`; its source labels, strokes and bounds are retained. Historical native registrations are drawing-comparison evidence only. Coverage `drawingFloors` retains the original sheet metadata; the intake records the attributed drawing floors. The coverage audit checks that every source-sheet room label is either analyzed or explicitly pending. Unassigned source anchors are recorded separately. A sheet audit is not manual verification of every room.

The Northern Sport Centre's drawings show a lower gymnasium/fieldhouse and changeroom level, a middle service/lobby/squash-court plan, and an upper training-track plan. Its source stair-label families include S101/S201, S102/S202/S302, S103/S303, S104/S304, and S105/S205. The side families have no labelled middle-level stop in this DWG; retain that absence for review rather than inventing a landing on that plan. Physical elevations and continuous served flights still need source sections or independent review.

## Assembled 3D drawing buildings

After importing the CAD ZIP, choose **3D building**. The selected drawing building opens in a WebGL scene using the same Three.js renderer family as Reviter's model viewer. All drawing floors share the report's separate XY comparison transforms. Choose one floor, all floors, or **Explode floor layers**; orbit, pan and zoom with the model controls. **Download building schematic GLB** exports the visible assembly with the source/geometry hashes and explicit illustrative-height and non-routing flags in its extras.

Mesh preparation and polygon triangulation run in the CAD worker. Inner polygon rings remain holes; unrecovered regions do not become solid slabs. Recovered room cells, measured wall pairs, original drawing strokes, supported door-symbol planes, flat tread evidence and bounded stair footprints have separate colours. Wall-pair candidates can be window/frame strips, so their material is not certified. Walls use 2.7 m illustrative height and door planes 2.1 m; the editable level interval defaults to 4 m. The interval is a layout assumption, not a measured elevation. No stair-rise mesh is manufactured from horizontal tread strokes.

Dashed orange links show only existing same-building, consecutive-ordinal footprint correspondences. Endpoints come from triangles inside the respective recovered stair areas. Missing intermediate drawings cannot be bypassed, and recurring labels alone do not create a link. These comparisons are neither physical flights nor routing edges. Native model, GIS, floor openings, access and the canonical master remain unchanged.

An optional checksummed `building-evidence.json` binds supporting documents and notes to exact drawing/geometry hashes. Its declared PDFs are preserved and checked during import; floor labels must belong to the stated building. Brochure descriptions may clarify lower/ground/upper usage or open-to-below spaces without supplying a geometric registration, floor height, stair rise or current access approval. The July 2024 Northern Sport Centre brochure supplies this distinction for Building 14: a partial middle plan and an upper track open to the sports halls below. Its stated 40 ft field-house ceiling is not a floor-elevation control.

## Drawing paths and door-side review

Run `npm run cad:paths -- --package /absolute/CAD-analysis-folder --out /new/separate-folder --python /absolute/venv/bin/python`. It checks the input archive, retains geometry/DWG/DXF bytes, then adds `drawing-paths.json`, summary and the implementation snapshot to a new ZIP. Normal Reviter Open loads its **Floor plans → Paths and door review** controls. Select start/destination, preview, inspect unresolved door symbols, and download the source-bound results. The same controls work in the standalone preview. Heavy extraction and path searches run in Python/the browser worker respectively.

The network is an authoring comparison, stored as `previewEdges`, with empty native `graphEdges`. Original strokes, measured door thresholds and polygon holes bound its cells. Delaunay triangles are retained only when wholly covered by their exact cell; every interior movement is independently tested for containment and fails closed. Door approaches inspect the first polygon on each normal ray, at three positions across the leaf, within 0.8 m. Both sides must uniquely identify different cells, have mesh support, and avoid original strokes other than that measured door's recorded leaf/arc/jamb supports. Same-cell bypasses, missing sides and foreign strokes remain separate review records. No gap or unmeasured entrance is filled.

Ordinary rooms can be endpoints but cannot be intermediate shortcuts. Named drawing circulation is permitted between endpoints; unlabelled cells require the explicit comparison option and stay unverified. A disconnected preview explains missing boundaries or doors. Paths can be indirect and incomplete where triangulation rejects pieces or the DWG contains furniture/detail strokes. No physical floor slab, indoor/outdoor status, public access, door operation, accessibility or cross-floor stair service is certified. Native master geometry/routing must be independently checked and regenerated before this becomes visitor navigation. Do not use illustrative 3D floor spacing as stair rise.

A previewed 2D path can be inspected in **3D building → Focus drawing path** on the same drawing floor. The separate floor comparison transform is applied; the magenta line remains tagged as an unverified drawing comparison in schematic GLB exports. Its height uses the illustrative floor spacing. Exact boundary containment supplies no pedestrian clearance or step-free proof. `drawing-paths-summary.json` lists missing room boundaries and door statuses separately for each building/floor; these flags are investigations, not automatic wall-patch approvals.

### Abstract doors, contact closures and temporary stair assumptions

`Door display` switches recognized swing/leaf strokes to measured thresholds in the 2D review; `3D door display` does the same in the assembled schematic. Unknown symbols remain visible. Door buttons and 3D panels retain source handles and measured widths. This display does not edit physical doors or navigation portals.

The drawing-path analyzer now closes selection at finite original supporting wall contacts where face discrepancy is at most 0.1 mm and each end margin is at most 0.4 m. Other intersecting strokes reject a closure, except bounded measured endpoint frame/leaf strokes. Every accepted closure records original endpoints, original thresholds, door width and frame witnesses. Import validates those identities and measurements. These are doorway selection closures, not wall extensions. `Area comparison` switches between original recovered polygons and contact-corrected drawing cells; both preserve holes and source room identities. `Selection closure comparisons` displays one correction at a time.

When the user explicitly requests assumptions, run `tools/dwg-analysis/assume-dwg-stairs.py --package /separate/candidate --building CODE --user-assumed`. It adds `stair-assumptions.json` without changing drawing geometry. A connection needs an overlapping original source footprint on both labelled stair contexts; the common point is transformed into each floor's local coordinates. Imported endpoints must align in building XY and lie inside both original footprints, outside holes. Whole floors and room text are never moved to force alignment. No recovered overlap means an unresolved record rather than a connection.

`3D building → Show assumed aligned stair connections` switches these magenta comparisons on/off. Continuous flights are assumptions, elevations remain unknown, and unlabelled intermediate stops are not added. Native graph edges remain empty. The switch is included in schematic GLB metadata; assumptions and unresolved records travel in the review ZIP. Drawing-boundary, floor-support, actual served landing and access checks are still necessary before visitor routing.

### Reviewed floor surfaces and open-to-below areas

`cad:paths` also accepts `--surface-recipe /absolute/source-bound-recipe.json`. This creates a separate `floor-surfaces.json` companion, preserves original geometry bytes and regenerates drawing path cells. A recipe declares the source/geometry hashes, floor/room identity, ordered original primitive chains (outer ring first, then protected inner rings), a bounded endpoint join limit, the human confirmation of open-to-below use and remaining review. No building coordinates belong in generic application logic.

The importer reconstructs each ring from those exact source strokes. Only endpoint rounding within 20 μm is joined to an original vertex; an overlapping stroke start may be trimmed to an existing finite contact within the declared maximum of 2 mm. Larger gaps fail. The Python compiler independently checks simple polygon topology, room seed containment and hole ownership. The path report binds the exact surface companion hash. Every floor cell is clipped away from protected holes; triangulation and paths retain the openings. Stale reports, filled cells or edges crossing an opening are rejected.

In **Floor plans → Reviewed floor surfaces and openings**, inspect the original source and protected orange outline. **Area comparison** switches original recovery versus regenerated cells. **3D building → Show reviewed floor surfaces** switches the opaque drawing surface on/off; the protected opening is never filled by that switch. **Look down at floor** makes the inner ring easy to inspect. Schematic GLB exports include the hole and the reviewed-surface metadata.

For Building 14, the human confirmed the upper track centre is open to below and clarified that the middle feature separates the soccer field and basketball court below; it is not an upper bridge. The revised comparison includes the confirmed accessible corner areas through the separate provisional facade envelope described below, retaining the complete inner opening. Do not fabricate a bridge, physical slab height, railing height or stair arrival from this comparison. Physical native routing remains a separate preparation step.

### Full floor comparisons and stair-door approaches

A painted track line is not the usable floor perimeter. Where a human confirms
that corner areas are connected, `floor-surfaces.json` may record a reversible
`assumedFacadeEnvelope`: four original inside-face plane witness groups, with at
least 35% finite support on each derived edge. This is a provisional floor
interpretation, never a physical wall, slab or native route approval. Scoped
`excludedWallPairIds` retain measured boundary strips and column projections;
the existing source inner rings remain protected openings in every cell and
path. Show reviewed floor surfaces switches this interpretation in 3D.

Separately checked `boundaryCells` use original finite stroke intervals and
measured doorway threshold intervals to replace faulty shared stair regions.
Closed doorway selection boundaries and the two-sided door comparison stay
separate. Reconstructed stair areas remain endpoint-only: these drawing cells
and doors do not establish stair rise, landings, served stops or access. Do not
use a same-region bypass as proof that the physical door is defective.

A revised recipe must bind `supersedesFloorSurfacesSha256` to the previous exact
companion. Regeneration preserves the old companion and recipe in checksummed
`evidence/floor-surface-history/`, keeps source bytes unchanged, and rebuilds
paths before a revised package is imported.


## Drawing paths between floors

Paths and door review now offers a destination floor and an explicit **Use assumed aligned stairs between floors** switch. The worker searches the same checked floor graphs plus source-bound `stair-assumptions.json` crossings. A crossing attaches only to a uniquely owned, meshed stair cell with a polygon-contained approach that excludes holes; missing landings never snap to the nearest room. Ordinary rooms remain endpoint-only. Unknown intermediate stops are not added. The length reports horizontal drawing distance, excluding unverified stair rise. Floor segments and dashed assumed crossings appear in the assembled 3D comparison and its GLB export. Turning off assumptions removes cross-floor search edges.

Use **Unmeshed spaces and nearby entrances** to inspect a label's original source context and unresolved swings. A proximity match does not certify door ownership, elevator shaft bounds or served stops. The reusable circulation interpretation below recovers Building 14's 14-302 lobby and electrical entrance, including their original double-leaf witnesses. The 14-E305 identity remains unmeshed. Neither the lobby recovery nor the working west stair comparison establishes a lift route.

## Reusable circulation interpretation

Run the same source-bound interpretation for a building code, or `all`, rather
than writing building coordinates into UI code:

```sh
npm run cad:paths -- --package /absolute/current-CAD-folder \
  --out /absolute/new-CAD-candidate --python /absolute/venv/bin/python \
  --interpret-building 14
```

This stage preserves `geometry.json`, DWG, DXF and floor registrations byte for
byte. It saves `circulation-review.json` separately and binds the regenerated
path report to its exact SHA256. Python reconstructs the comparison; the
Reviter importer independently checks original finite segment identities,
measured points, projections, leaf witnesses and source hashes before using it.

The processing order is reusable:

1. Retain original labels as identities and seeds, not room outlines.
2. Match quarter ARC or near-circular ELLIPSE symbols against original radial
   leaves, finite jambs and paired-leaf contacts. A displaced symbol centre can
   be tolerated only with those independent witnesses; radius alone is
   insufficient. Unknown symbols remain original source strokes.
3. Record exact endpoint-to-finite-stroke contacts no larger than 2 mm. Split
   the target at its recorded source projection; never round the entire drawing
   to a grid or modify original wall thickness. These comparison joins are
   reversible interpretations, not physical wall-patch approvals.
4. Polygonize original strokes and supported threshold closures. Retain holes,
   report absent/shared identities, and use constrained triangulation for the
   interpreted floor. A shared area is not a separately verified room.
5. Reject interior path legs crossing residual source strokes, including
   dangling partitions that are invisible to an outer polygon alone. Named
   circulation can be intermediate; ordinary rooms remain endpoint-only.
6. Scan original parallel wall-cap pairs for logical doorless entrance
   proposals. Require a finite unobstructed span and a cut that actually divides
   a shared labelled region. Preserve exact source witnesses and prospective
   room groups. Window/fixture ownership still needs review: these proposals
   are **not applied**, never become doors, and never enter the path graph.
7. Check stair footprints, actual meshed approaches, source-aligned floor
   correspondence and explicitly switchable continuity assumptions separately.
   A repeated stair label does not establish a landing or elevator stop.
8. Keep physical slab support, indoor/outdoor ownership, operation, public
   access and accessibility unverified until independent source evidence is
   available. Never fill a real atrium or infer a bridge from a separator below.

In Reviter's **Floor plans → Drawing interpretation and remaining boundaries**,
inspect one measured source contact at a time, focus missing/shared labels, and
preview each **Doorless entrance boundary proposal** against current areas.
Green shows the candidate division; magenta marks the logical threshold.
**Show current areas** removes the proposal. **Download interpretation evidence**
saves the source-bound scan. The same evidence and implementation snapshot
travel in the separate review ZIP. Native master routing remains independent.

For Building 14, this interpretation recovers the large lower sports areas and
many ground-floor rooms, plus the upper lift lobby and electrical room. It does
not certify all floor routes: shared doorless rooms, missing ground circulation
and stair-flight-to-landing ownership remain explicit investigations. The upper
centre remains open to below; no centre bridge is added.

Constrained comparison meshing subtracts a **20 μm numerical buffer** around
remaining source barriers. This makes dangling partitions and stair rail strokes
visible to triangulation rather than simply rejecting large triangles after the
fact. It only removes comparison area; it does not infer wall thickness, floor
support or pedestrian clearance. Every accepted leg still passes the original
stroke check. Ordinary rooms and unmatched stair landings remain excluded.

For an explicitly expanded, user-confirmed floor comparison with a provisional
facade envelope, the previous outer source delineation is interpreted as a floor
marking within that broader surface. This assumption is saved as exact
`sourceFloorDelineationHandles`, bound to the reviewed surface hash. Protected
inner opening chains and original measured wall strips cannot be cleared by it.
Original source strokes remain visible. This interpretation must stay
provisional until independent physical evidence confirms it.

Paired stair riser strokes must not become interior path barriers. The circulation
interpreter records original finite LINE/LWPOLYLINE segment identities and their
recognized stair/tread witness. Matching spans differ by at most 30 micrometres
along the tread and by at most 25 mm across it. Import independently reconstructs
those checks. Only exact witnessed segments are abstracted in polygonization and
barrier meshing; railings, stair openings and original drawing bytes remain.
Floor plans → Drawing interpretation → Paired stair riser interpretation shows
one original stroke beside its recognized tread. This improves drawing comparison
approaches and does not certify stair heights, stops or visitor access.
