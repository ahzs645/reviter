# CADCraft interface patterns for Reviter — 2026-10-18

Recommendation: adapt CADCraft's command-driven interaction, visibility tools,
workspace persistence and precision feedback in Reviter's existing React/Three.js
studio. Keep Rust reuse as a separate experiment for a bounded geometry problem.

The subsequent implementation and its acceptance checks are recorded in
[the implementation report](cadcraft-interface-implementation-2026-10-18.md).
The source-review observations below describe the baseline before those changes.

This review checks CADCraft at
[`3370a91fe96d0f8752622d041b7fed199a2bbac0`](https://github.com/storytold/cadcraft/tree/3370a91fe96d0f8752622d041b7fed199a2bbac0)
and Reviter at `b6345cb64cbcaada59240fc12b08742c41c3b69b`.
CADCraft's checked-in apartment and paper-layout screenshots were inspected along
with source. Neither application was run for this assessment. Effort below is
relative implementation scope, not a delivery estimate.

## What to bring over

| CADCraft interface/option | Reviter adaptation | Existing foundation | Scope |
| --- | --- | --- | --- |
| Command line, aliases, autocomplete, shared command definitions | Searchable palette with actions and typed arguments: select ID, switch floor, fit, hide/isolate, export review. Add command history after the registry is established. | `ViewerToolbar.tsx`, `viewer-tools.ts`, callbacks in `app/ReviterStudio.tsx` | Medium; a full CAD prompt interpreter is larger |
| Layer manager and temporary object isolation | Search categories/DWG layers; hide, isolate, restore previous state, show all; later add display colour and opacity overrides. | Category visibility in `ReviterStudio.tsx`; layer identities in `lib/reviter/dwg-plan.ts` | Medium; per-object visibility needs picking/rendering support |
| Named views and navigation overlay | Save camera plus source, floor, section and visibility. Add a small orientation control using Reviter's existing camera presets. | Camera requests, `ModelViewpoint`, comment capture/restore in `ModelCanvas.tsx` | Medium |
| Dock resizing and workspace persistence | Remember panel widths, open panels and active tabs. Provide Model inspection, Floor review and Drawing review presets. | `BrowserDock.tsx`, `PropertiesDock.tsx`, `ReportDock.tsx`, fixed widths in `app/globals.css` | Medium for widths/presets; arbitrary floating docking is larger |
| Window/crossing selection, Select Similar | Start with additive selection and category/type queries; then directional rectangle selection and batch isolate/review. | Single `selectedElementId`, `ObjectList.tsx`, `viewer-picking.ts`, selection rendering in `ModelCanvas.tsx` | Medium–large |
| Object snaps, dynamic input, ortho/polar tracking | Start in 2D plans with endpoint/midpoint and nearest; show snap kind and location. Follow with intersection/centre and constrained numeric distances. | Measurement tools and canonical coordinate conversion in `viewer-tools.ts`; decoded DWG entities | Medium–large |
| Dimensions, leaders, annotation styles | Persist distance/angle first, then planar area/perimeter; show labels and editable style/offset. | Runtime measurements in `scene-tools.ts`; persistent markup/comments and `review-exchange.ts` | Medium–large |
| Paper space, page setups, plot scale | Named review sheets with title block, physical scale, scale bar, legend, source and review date. | DWG plan tabs, `DwgWorkspace.tsx`, `lib/reviter/dwg-print.ts` | Medium–large |
| Status bar and tool prompts | Display current units, source, active constraint, snap type and pending measurement instruction; expose relevant toggles while measuring. | `ViewerToolPanels.tsx`, `MeasureMode`, `MeasureUnit` | Small–medium after snap state exists |
| Layer states and configurable property views | Named visibility sets and pinned/favourite properties for common reviews. Keep decoded/inferred/edited markers. | `PropertiesDock.tsx`, provenance-bearing `PropertyRow` in `types.ts` | Medium |
| Command-backed automation | A typed internal dispatcher can later serve batch review actions and an explicit automation API. | Existing conversion workers and source identities | Later; the registry alone does not provide an automation service |

## The interface shape I recommend

Keep the model as the central working surface. Use the existing left Browser for
Objects / Categories / Comments, adding a Layers view in drawing contexts. Keep
Properties on the right. Put command search in the toolbar, and expose saved
views close to the camera controls. Show precision prompts and snap/unit state
near the viewport only when the active tool needs them.

Keep workspace layout presets separate from model saved views. A layout is a
user preference; a saved view is model review data. Resizing the browser should
not change a portable camera bookmark. On phones, use a palette button and the
existing sheet-based shell; desktop panel widths must not carry into it.

CADCraft's dense drafting tool palette is useful as a catalogue of possible
tools. Reviter should initially expose the inspection, measurement and review
subset through its existing toolbar, tool panels and command search. A drafting
mode with line/arc/hatch/block authoring is a separate product decision.

## What the earlier assessment needs to make explicit

- **A context menu already exists.** `app/ReviterStudio.tsx` provides Walk from
  here, Zoom extents/object, Clear selection, Copy object ID, Show properties and
  Hide this category. Extend it with isolate/restore/select-similar as those
  capabilities arrive; route existing actions through the same registry.
- **Camera viewpoints already exist on comments.** `ModelViewpoint` stores source,
  position, target, up and FOV. Standalone saved views still need floor, section,
  visibility, persistence and model identity. Coordinate registration must be
  explicit when restoring a view across RVT, IFC and reference GLB sources.
- **Measurements already include distance, angle, calibration, coordinates and
  laser modes.** The missing work is precise picking, durable measurement data,
  portable exchange and additional dimension types. `ModelCanvas.tsx` currently
  commits surface-hit points into runtime scene objects and display labels.
- **The DWG drawing surface is an SVG image.** `DwgWorkspace.tsx` displays an
  `<img>` with zoom and inspection hit mapping. Snapping cannot be obtained just
  by adding buttons: it needs entity geometry, transforms and a spatial index,
  with an interactive overlay or a different drawing surface. Reuse decoded
  entities rather than treating raster/image pixels as drafting coordinates.
- **Drawing tabs and print preview already exist.** `dwg-print.ts` fits recovered
  linework into a physical page with a 12 mm border. True scale, reusable page
  setups, title blocks and composed sheets are the additions.
- **Portable identity needs strengthening.** Existing comment/markup exchange
  identifies a source with filename and byte length; room review has an
  additional lightweight fingerprint. Neither is a full content digest. New
  dimensions/views should use a robust model identity and versioned validation,
  with explicit migration for existing sidecars.

## The command pattern worth adapting first

CADCraft's
[`CommandSpec`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/engine/src/cmd/mod.rs)
combines ID, label, menu location, shortcut, aliases, parameters, enabled check,
execution and undo/interactive behaviour. Its layer manager likewise executes
engine commands rather than editing a separate UI-only state.

For Reviter, create a small typed registry with stable IDs, labels/search terms,
availability reasons, argument validation and execution. Bind toolbar, palette
and context menu to those same operations. Derive shortcut handling from the
registry while respecting text inputs, editable fields and first-person controls.
Return a visible result/error; disable unavailable actions with a reason.

Initial commands can be `view.fit`, `selection.focus`, `selection.clear`,
`element.select`, `floor.select`, `category.hide`, `visibility.restore`,
`panel.toggle`, `review.export` and tool activation. These are proposed IDs.
Adding the dispatcher should not require replacing React state or introducing
a full document engine. Long exports should use their existing asynchronous
flow and expose pending state; sharing a command entry does not itself make
an expensive operation asynchronous.

## Precision and persistence boundaries

Snaps should use a screen-space capture radius so zooming does not change their
usability. Rank candidates deterministically, show the winning snap type and
anchor, and allow temporary bypass. Hidden/clipped geometry should follow the
same eligibility policy in selection, snapping and display.

In 2D, prefer original line/arc entities and their transforms. In 3D, a triangle
vertex is not automatically a native CAD endpoint: tessellation can add vertices
that have no design meaning. Mark mesh-derived candidates and fallbacks with
their geometry provenance. A bounds envelope must not appear to be a verified
wall face just because the dimension has many decimal places.

Store annotation coordinates in canonical model feet when registration is
known, and original DWG units with a declared transform for drawing anchors.
`dwgFeetPerUnit()` already returns null for unspecified/unitless drawings; ask
for a unit/calibration choice before promising physical scale in that case.
Calibration belongs to the review overlay and must not rescale the source.

A dimension record needs its mode, numeric anchors, units, source/model identity,
geometry provenance, optional element/entity references, label/style and creation
metadata. Store numeric values, not only formatted strings. If reliable native
anchors are unavailable, preserve fixed anchors and identify them as such rather
than claiming CADCraft-style associative dimensions. On model revision, validate
references and flag stale anchors instead of silently attaching to a nearby object.

Reuse the sidecar persistence/exchange and markup undo patterns. Keep source RVT,
DWG and GIS bytes intact. Review redlines and dimensions are user-authored
annotations; they do not certify room enclosures, access or navigation geometry.

## Integration options

| Option | What is reused | Fit and cost | Recommendation |
| --- | --- | --- | --- |
| Adapt in React/TypeScript/Three.js | Interaction patterns; selected algorithms may be ported with attribution | Fits current renderer, workers, picking, source identity, mobile shell and offline workflow | Default |
| Narrow Rust/WASM module | A bounded geometry or DXF operation | `cadcraft-geom` is relatively small; engine snapping depends on CADCraft Drawing/entities/rendering. Needs a wrapper, adapters, build/version pipeline and performance measurements | Prototype only when there is a concrete gap |
| Separate CAD workspace | CADCraft's own UI and document engine | Two application states/renderers, independent undo and coordinate/identity bridges. Browser DWG is unavailable in the reviewed version | Consider if full 2D authoring becomes a requirement |

CADCraft's
[`crates/dwg/src/lib.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/dwg/src/lib.rs)
explicitly rejects DWG open/save on wasm32. Reviter already uses
`@mlightcad/libredwg-web`; embedding CADCraft would not replace that browser path.
Its
[`ViewCube`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/ui-egui/src/viewcube.rs)
documents a 2D WCS plan view with no 3D direction or view twist. Use Reviter's
camera machinery for a real 3D orientation widget.

The upstream
[`file-format parity record`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/docs/file-format-parity.md)
also describes save losses. Any separate authoring workspace must be evaluated
against real reference drawings and preserve originals; a successful save is not
evidence of complete entity preservation.

## Implementation sequence and acceptance

1. **Registry and palette.** Wire existing fit/focus/tools/panels/exports first,
   then typed element/floor selection. Verify keyboard focus restoration, Escape,
   missing-model availability and equivalent behaviour from menu and palette.
   A mobile button must expose the same actions.
2. **Visibility controls.** Add isolate/restore and a searchable layer/category
   manager. Ensure visible geometry, picking and subsequent snaps agree. Restore
   the exact previous visibility state, including nested isolation, and prevent
   IDs from leaking between models. Add per-object hiding with selection support.
3. **Saved views and workspace presets.** Extract reusable camera capture/restore
   from comments, save the full review state, and persist bounded panel widths.
   Verify source/unit transforms and camera/floor/section/visibility round trips;
   resize to a narrow window and recover a usable viewport. Layout and model
   identity failures must fall back cleanly.
4. **Multiple selection.** Keep an active object for Properties alongside a set
   of selected identities. Add query-based Select Similar before rectangle
   selection. Define visible-only versus through-selection and clipping rules;
   verify picking/highlights on batched meshes and source changes.
5. **2D precision and persistent dimensions.** Start with endpoints/midpoints,
   explicit units, distance and angle. Verify known entity coordinates, nested
   transforms, unknown DWG units, screen-space tolerance, undo and sidecar
   round trips. Then add area/perimeter, more snap modes and 3D candidates.
6. **Scaled review sheets.** Extend the existing DWG print path. Test a known
   length at a declared scale in the generated physical page; browser print must
   use 100% sizing without extra fitting. Check labels/title blocks, page bounds,
   unknown units and visibility. Display print limitations honestly.

For implementation, extend relevant existing tests such as
`tests/viewer-tools.test.ts`, `tests/viewer-picking.test.ts`,
`tests/review-exchange.test.ts`, `tests/model-markup.test.ts` and
`tests/dwg-layouts.test.ts`; add focused command/visibility checks as needed.
Run scoped checks, typecheck/build and desktop/mobile interaction checks when
code lands. No runtime integration or performance claim is established by this
source review, and no application code was changed for it.

## Upstream source and reuse terms

Other useful implementation references at the reviewed commit:

- [`docking.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/ui-egui/src/docking.rs): panel identities, serialized layout, hidden-panel restoration and validation.
- [`layers.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/ui-egui/src/layers.rs): layer table, filters, layer states and command-backed edits.
- [`snap.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/engine/src/snap.rs): snap modes and candidate metadata, with CADCraft document dependencies.
- [`select.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/engine/src/select.rs) and [`selecttools.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/engine/src/cmd/selecttools.rs): window/crossing, similarity and temporary isolation.
- [`view.rs`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/crates/engine/src/cmd/view.rs): command-backed zoom, layout and named views.

CADCraft code is MIT OR Apache-2.0; preserve the applicable notices when copying
code. The
[`NOTICE`](https://github.com/storytold/cadcraft/blob/3370a91fe96d0f8752622d041b7fed199a2bbac0/NOTICE)
excludes ArtCraft branding from that licence, identifies acadrust as MPL-2.0,
and notes separate font terms for optional embedded fonts. Inspect the dependency
closure of any reused module; the top-level licence does not replace dependency
or asset terms. No CADCraft code or branding was copied into Reviter here.
