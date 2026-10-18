# CADCraft-inspired Reviter interface implementation — 2026-10-18

The [interface assessment](cadcraft-interface-review-2026-10-18.md) is now implemented
as native React/Three.js controls. No CADCraft engine, branding or dependencies
were imported. Original model and drawing bytes remain unchanged.

## Available workflows

- **Commands:** Ctrl/Command+K or the Commands button opens a searchable, keyboard
  accessible palette. Model tools, camera orientations, panel toggles, object-ID
  selection, native level-ID selection, visibility and exports use guarded
  command definitions. Typed argument errors remain visible inside the dialog.
- **Visibility and selection:** Shift-click in the model/browser toggles objects;
  Shift-drag encloses left-to-right and crosses right-to-left. Rectangle selection
  uses projected bounds of drawn objects, respects complete clipping exclusion,
  and includes depth. Select Similar matches category and type. Hide/isolate
  operations retain up to 30 previous visibility states. IFC/overlay geometry
  filters triangle ownership and picking together. Unregistered reference GLBs
  cannot use RVT object visibility.
- **Workspaces:** Model inspection, Floor review, Drawing review and Focus presets
  remember panel widths and visibility. Separators support pointer dragging and
  arrow/Home/End keys. Widths are constrained to leave room for the viewport at
  narrow desktop sizes. The existing mobile sheet layout is retained.
- **Saved views:** Named bookmarks retain camera/source, render style, native floor
  selection, floor isolation, section settings and object/category visibility.
  Restoring a reference view requires the same reference-file hash. Save a
  standalone camera view from the Model workspace.
- **Model dimensions:** Existing distance, angle, coordinate and laser picks now
  become durable numeric review records. Canonical RVT/IFC anchors are in model
  feet; unregistered GLB anchors remain in that exact reference's scene frame.
  Labels project with the camera. Mesh vertex/midpoint snapping is optional and
  explicitly labelled as mesh-derived. Undo, redo, delete, export and import are
  available in the review workbench. Calibration remains a review multiplier.
- **Drawing precision:** The DWG worker returns flattened entity geometry alongside
  its SVG. The drawing overlay maps pointer coordinates through the actual
  letterboxing and zoom. A spatial grid supplies 12-pixel endpoint, midpoint,
  centre, line-intersection and nearest snaps; Alt bypasses snaps. Sampled curves
  are excluded from analytic endpoint/midpoint claims. Free, ortho and 45-degree
  polar constraints, original-coordinate entry and explicit numeric distances
  are available. Distance, angle, coordinates, planar area and perimeter can be
  saved, undone/redone and exchanged.
- **Drawing layers:** Search, hide, isolate and restore layers. Display colour and
  opacity overrides affect the derived view and sheet, preserving source bytes.
- **Review sheets:** Paper/orientation, fit or declared physical scale, title,
  source/date, layer legend, scale bar and dimensions are composed into a sheet.
  Named setups are reusable browser preferences. Unsupported units and scales
  that do not fit are reported. Sheets export as SVG and through browser Print /
  Save PDF. Use actual-size/100% printing with no additional margins or headers.

The new `reviter-workspace-review` version 1 exchange file identifies the primary
source by full SHA-256. Local storage uses that digest as its key. Import validates
the schema, source revision, anchors, camera and collection bounds before merging
views/dimensions by identity. It preserves unrelated local review entries. Existing
comment, markup and room-review exchange formats retain their prior semantics.

Browser storage can fail; the UI reports that situation and portable export
remains available. New review records are fixed user-authored anchors, not native
associative CAD dimensions or certifications of geometry accuracy. Stale source
revisions are rejected rather than rebound to nearby geometry. Review sheets
still use the existing recovered-linework renderer; they do not reproduce all
AutoCAD plot styles, hatches or linked content.

## Reproducing verification

Install the repository dependencies and the sibling OpenIndoorMaps dependencies
required by Reviter's existing imports. Chromium is a separate Playwright install.

```sh
npm ci
npx playwright install chromium
npm run typecheck
npm run test:interface
```

`test:interface` builds the Pages bundle and starts its own temporary local HTTP
server. It uses real DWG fixtures and a generated synthetic RVT container through
the actual metadata reader, conversion worker and WebGL renderer. No conversion
worker is mocked. Matching IFC and GLB reference files are generated from that
fixture. Desktop and phone contexts are independent.

Screenshots, downloaded review JSON, SVG/PDF sheets and machine-readable browser
results are written under ignored `artifacts/cadcraft-interface/`. The generated
RVT is a controlled parser/interaction fixture, not an architectural accuracy or
large-building performance benchmark. The existing Revit 2014 RFA fixture was also
opened manually; it renders diagnostic geometry without decoded element IDs.

Additional targeted coverage is in `tests/cadcraft-workspace.test.ts`, alongside
the existing viewer, picking, markup, review exchange and DWG tests. The browser
suite exercises both desktop and mobile controls, checks horizontal overflow,
and fails on browser JavaScript errors.

## Verification results

| Check | Result |
| --- | --- |
| Focused command, identity, precision, selection, viewer, markup, exchange and DWG tests | 69 passed |
| Automated desktop/mobile browser acceptance | 24 workflow groups passed; no browser JavaScript errors |
| TypeScript check | Passed |
| ESLint on changed source/test files | Passed without warnings |
| Production build and Pages build | Passed |
| Server-rendered HTML checks | 4 passed |
| Full unit suite | 2,220 passed, 22 skipped, 1 existing failure |
| Generated browser PDF | One Tabloid page, 792 × 1224 points |

The full-suite failure is
`tests/deterministic-math.test.ts` → “compiler geometry modules use no
implementation-approximated Math”. It identifies existing `Math.hypot`/power
calls in seven unchanged decoder/compiler files: `native-arrival-owner.ts`,
`native-terminal-refinement.ts`, `revit-2027-garc.ts`,
`revit-2027-gcondition-dir.ts`, `revit-2027-gellipse.ts`,
`revit-2027-gline.ts` and `revit-2027-owner-mesh-trim.ts`.
The same assertion fails in isolation; neither those files nor the assertion
were changed in this work. No geometry/compiler change was made to suppress it.

One pre-existing HTML smoke assertion expected “restore” while the current UI
says “restores”. It now accepts either grammatical form, retaining its check
for model/floor/GIS project restoration. All four HTML checks pass.

Browser and screenshot review found and corrected search-field Escape handling,
phone orientation/navigation overlap, compressed mobile drawing selectors and
narrow desktop panel sizing. Actual browser checks also cover directional box
selection, context-menu keyboard access, existing comments/markup, IFC/GLB pairing,
view restoration across sources, same-revision reload persistence, rejected
foreign review imports, layer changes, numeric polygon/angle dimensions, sheet
setup restoration and SVG/PDF generation.

Verification used Chromium with software WebGL on local built assets. Physical
printer calibration, Safari/Firefox and large-building performance were not
verified. A second synthetic container supplies two persisted native level IDs,
24 members per storey and native floor sketch rings; its floor-ID command and
saved-floor restoration round trip pass through the actual parser and UI.
