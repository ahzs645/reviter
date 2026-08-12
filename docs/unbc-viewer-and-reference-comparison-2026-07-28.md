# What the rendered view shows, and what a CAD viewer was worth copying

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

The viewer is where a recovery stops being a table of numbers, and three
separate rounds shaped it: what the shaded view can and cannot honestly show,
what a shipped read-only CAD viewer turned out to do (much less than expected),
and the overlay and walk modes that let a recovery be judged against a second
conversion of the same building in place.

## What the rendered view can and cannot show

The shaded view draws each element flat in its category colour, so the palette is what separates one category from another on screen. It was previously a narrow pale band that rendered the whole building as a single wash; it is now separated in hue and value, which is why glazing, doors, and framing read apart. The other render mode uses per-vertex colour, and that is tinted by category too rather than by elevation alone.

**Most walls used to be missing from the view, and the cause was the scene's entry condition rather than the decoder.** The scene was assembled only from elements carrying a duplicated-bounds record, and most walls do not have one — 2,818 wall records exist against roughly 7,400 wall objects. Those walls did have native geometry the whole time. Elements with a rebuilt solid and no bounds record now get a record synthesised from the solid itself, which takes walls in the scene from 1,250 to **6,846**, against 7,381 `IfcWallStandardCase` plus 1,835 `IfcCurtainWall` in the paired export.

The curtain-wall suppression that also hides records was checked while looking into this and left alone: of the 1,569 records it hides, 1,488 are genuinely `IfcCurtainWall` containers whose panels and mullions are drawn separately, and only 27 are ordinary walls.

Curtain wall panels are drawn as glazing rather than as opaque panels. They are the glass of a facade, and drawing them opaque walls the building off from its own interior — with them glazed, the structure behind a curtain wall is visible, which is the point of looking at the model at all.

What remains is a real limit rather than a cosmetic one. Curtain panels and mullions dominate this model by count and are drawn as envelopes, because they are loadable-family instances whose geometry sits in family-document blobs — the same reason their type names do not resolve.

## What a CAD viewer already does, and what Reviter took from it

A bundle of the AutoCAD web application was read for its interaction design — not its code, none of which is here — and the most useful thing in it was a single array: the command allowlist that application applies when a drawing is opened read-only. Twenty commands. Measure, zoom, pan, properties, layers, blocks, xrefs, find, undo, compare. Absent from the entire bundle: isolate, section planes, a view cube, a navigation bar, zoom-to-selection, select-similar. Visibility is one light bulb per layer; orientation is a text button reading `Top` that opens a list of ten. A shipped read-only CAD viewer is *less* graphical than the one Reviter had, not more, and six things followed from that.

**The properties panel is headed by the object, not by the word "Properties".** Their header is the object type — `Line`, `Block Reference`. Reviter's is now the decoded category, with the element id demoted to the subtitle, which answers *what is this* before *which one is this*.

**The object list is windowed rather than capped.** It rendered the first 180 rows and told you to search for the rest, which was the one place the interface admitted it could not show you the model. Rows are a fixed height, so only those inside the scroll viewport exist: 31,391 objects render **19 rows**. Picking in the viewport now scrolls the list to the selection, which it never did.

**One control for orientation, with the ten names every drawing package uses.** A three-faced view cube and a separate 3D/Plan switch held the same idea in two places, and neither could say "SE isometric". Both are replaced by a text button showing the current view, opening `Top · Bottom · Front · Back · Left · Right · SW · SE · NE · NW isometric`. The derivative viewer shares the table rather than keeping a second copy: the SVF is y-up and metres, so its pose is the shared one rotated, `(x, y, z) → (x, z, −y)`.

**Categories are a layer list with a bulb per row.** Turning a category off filters the triangle index by the per-triangle element id the meshes already carry, so the vertices stay exactly where the converter put them and the pick table is filtered in step. 24 categories on the supplied model, largest first. This is the honest version of "isolate" for tens of thousands of envelopes, and it is the one AutoCAD actually shipped.

**Hovering names what is under the cursor** before you commit to clicking it, on the raycaster picking already used, throttled to one resolve per frame.

**Zoom to object** joins zoom extents — their floating nav has both, and framing one element was impossible before.

The vocabulary moved with it: *element* → **object**, *Model browser* → **Objects**, *Search* → **Filter**, *Fit* → **Zoom extents**, *Render style* → **Visual style**. Four words did **not** move. *Recovered*, *drawn*, *envelope* and *fidelity ledger* have no CAD equivalent because authored geometry never needs to express how much of itself is reconstructed guesswork, and renaming them into CAD vocabulary would be a claim about provenance that is not true.

Deliberately not taken: a command line, whose whole value is thirty years of muscle memory for a language only that application speaks; a ribbon, around a twenty-command surface; object snap, because snapping to a recovered envelope implies a precision the data does not have; and `ByLayer`-style inheritance, which exists to control authoring. Measure is in their read-only allowlist and is legitimate here, but it is not in yet: measuring a recovered envelope gives envelope dimensions, and a readout that does not say so would be a lie.

## Overlay and walk, in the studio

The overlay below started as an offline script. It is now a view mode: load an RVT, pair its IFC export in the **Regression fixture** panel, and the geometry-source switcher gains **Overlay**.

The three geometry sources were mutually exclusive, so comparing recovery against the export meant switching between them and remembering what you saw. Both are z-up and share the project's datum — only units and the origin the recovered scene is drawn around separated them, which is a scale and a translation rather than a registration problem. The export is parented to a group carrying exactly that transform rather than having its vertices rewritten.

The colouring is the point of the mode:

- the **recovery** is solid
- an exported element the recovery also has is a **quiet ghost**
- an exported element the recovery is **missing** is picked out in **red**

So the 6,939 elements the coverage table counts as absent become something you can look at and point at, in place. Picking still works in this mode; it searches recursively, because the recovered meshes sit a level deeper than before and the export's meshes carry no element ids.

**Walk** joins Pan / Zoom / Orbit in the viewport navigation bar. Orbiting is how you look at a building from outside and the wrong way to understand it from inside — a corridor, a stair, a floor-to-ceiling height all read differently at eye level. Mouse look uses a normal viewport drag without locking the system pointer, `W A S D` moves, `Shift` runs, `Space` and `C` rise and fall, and `Esc` leaves. The eye sits 5.6 ft above the model's floor and the scene is already drawn in feet, so nothing needs scaling. Yaw and pitch are tracked directly rather than accumulated onto the camera's quaternion, which drifts into roll and tips the horizon over; leaving walk mode hands the camera back where the walker left it instead of snapping to the last preset.

Walking the *recovered* model used to lag, shimmer and throw blocky artefacts that the paired reference walkthrough did not, and each had its own cause rather than one shared one. The reference path indexes its walkable surfaces into a spatial grid; the recovered path was handing all ~860k triangles to `Raycaster.intersectObjects` **every frame** for wall collision, plus ten times a second for the floor probe — that was the lag, and both probes now query the same kind of plan-binned index, built once on walk entry (`WalkSurfaceIndex` for floors, `WalkCollisionIndex` for the steep triangles a step can hit, so a step opens a handful of cells instead of the scene). The "pixelation" was shadow texels, not screen pixels: a 2048² shadow map stretched over a square fitted to the *longest* site axis put one texel every ~1.1 ft at eye level, and the whole scene re-rendered into it every frame besides — the map is now 4096² over the model's bounding sphere and re-renders only when the scene actually changes, since neither the sun nor the building moves with the camera. The shimmer on coplanar faces was depth precision: walk mode pulled the near plane to 0.02 ft against a far plane still framed for orbit, a 1:300,000 range on a 24-bit buffer; walking now uses 0.1 ft near against a far that only has to clear the building. The recovered path also ran at 2× device pixels against the reference's 1.5× for no visible benefit, and its proxy edge hairlines — legible as a drawing from orbit, moiré at eye height — hide while walking, the same way the reference dims its outlines.

## Comparing against a reference conversion

Reviter can draw a second conversion of the same building beside its own so the two can be judged against each other. Pair a GLB or glTF from the **Reference model** button, the same way a paired IFC export is supplied; it is read locally and never uploaded. A reference carries no element ids, so the object, category and property panels stay on the RVT diagnostic source — it is a yardstick, not a decode.

Measured against one such reference (an Autodesk conversion of the supplied 2027 project, 51,420 fragments), the recovery's extents agree: 704.0 x 1228.4 x 62.3 ft against the reference's 714.9 x 1229.6 x 63.7 ft, and the per-category size medians are ordinary — mullions 3.82 ft, doors 7.25 ft, walls 12.32 ft, with 1 mullion of 19,316 and 0 doors of 1,933 above a sane size bound. The recovery is not systematically over-extending anything.

One real defect surfaced from that comparison and has since been fixed by decoding more of the file rather than by patching the symptom: element **447970** carried a `Curtain Wall Mullions` category token while measuring 72,315 sq ft with a 0.66 ft z-span — the same footprint and thickness as floor 503705 beside it. Probing the token's byte neighbourhood showed the mullion's own id *nearer* to the token than the plate's, but absent from the resolver's known-id set because that element owns no bounds record; the nearest-preceding rule fell through past the true owner and donated the token to the plate. The resolver now checks candidates against the persisted `Global/ElemTable` id set, flags an assignment as **donated** when a nearer real-but-undrawn element id was skipped, and lets a donated-only label yield to the element's own record-code cluster when that cluster clears the ordinary consensus floors and disagrees. `447970` inherits **Floors** from its 98.4%-pure cluster and draws as the slab it is; 65 of 385 donated-only labels are overridden this way, including 26 records the paired export itself names `IfcCurtainWall` — assembly wrappers that had taken their children's tokens and drawn as duplicate plates, and which now join the deliberately held-back wrapper set. Donated labels that nothing contradicts — including the drawing-aid labels the scene admission rules depend on — are kept, because the blunt alternative (resolving against the full ElemTable set) was measured and would have stripped 300 direct labels and re-admitted the stair helper boxes. See [`validating-on-a-second-building.md`](validating-on-a-second-building.md) for the assumption this rests on.
