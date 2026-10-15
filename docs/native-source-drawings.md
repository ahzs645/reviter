# Native source drawings and annotations

Reviter now projects source-owned tags, dimensions and detail curves from the pinned native graph reader and exports a bounded SVG annotation preview for an exact native view ID. Drawing bytes and ownership witnesses stay separate from converted model geometry, room enclosures and navigation.

The upstream `src/elements/{drafting,annotations}.rs` describes useful features, but its illustrative `Tag`, `Dimension` and normalized field aliases do not match the observed root records in these RVTs. The adapter follows actual same-byte structural schema fields: `IndependentTag`, `RoomTag`, `LinearDimString`, `RadialDim`, `DBDrawing` and `CurveElem`. Every projected record still needs complete graph consumption, a restated owner ID, supported release/schema context and exact record digest/bounds. Every owned-object traversal needs a unique pointer edge with matching token, class and byte boundaries.

`native-record-inventory.ts` adds drawing→viewport IDs and view→drawing/viewport IDs, native tag head/orientation and host/link references, room-tag ownership, stored dimension segment values and witness element references, owned straight text leaders, and optional curve driver geometry. Sentinel IDs and stored values remain visible; they are not evaluated Revit API values or regenerated dimensions.

`native-drawing-svg.ts` exports `listNativeDrawingViews(report)` and `makeNativeDrawingSvg(report, { viewId })`. Its SVG supports:

- Owned text-note RTF plain text, using stored paper font size and native view ratio, with XML escaping and bounded text/group parsing.
- Exact owned straight text leaders; curved leaders stay unresolved.
- Native tag-head point markers. Marker style is presentation; displayed tag labels and family glyphs stay unresolved.
- Optional finite `GLine` detail curves through `CurveElemDriver`, requiring `m_detail=true`, `m_useOffsetPos=false`, exact view ownership and a direction in the native view plane.
- Optional native `GArc` detail circles/arcs, with exact driver ownership, supported native flags/ranges, positive radius, orthonormal in-view basis, no offset/driver reversal and no fill. An exact periodic-circle flag with stored zero endpoints establishes a full turn; zero endpoints by themselves do not.
- Optional finite owned dimension lines. Unbounded `GLine` intervals, dimension witness points and stored values do not become invented dimension graphics.

The source view frame must have a finite origin, orthonormal right/up/view directions and right-handed orientation. Projection uses dot products in Revit feet, with SVG Y inverted. Exact owner IDs and explicit element hiding are honored. A source template, unsupported release, absent/mismatched frame or missing supported primitive produces no SVG. The SVG includes source record provenance and retention status in metadata.

Autodesk's [About views](https://help.autodesk.com/cloudhelp/2025/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Views/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Views_About_views_html.html) documents the right/up/view axes, paper scaling, cropping and separate model/view/sheet transforms. The preview does not claim Revit render equivalence: it does not evaluate model visibility, crops, category/template/filter rules, dependent view inheritance, family glyphs, dimension formatting or viewport-to-sheet layout. RTF plain text also leaves font substitution, alignment, wrapping and styling unresolved. Microsoft documents [Rich Edit RTF/text stream formats](https://learn.microsoft.com/en-us/windows/win32/controls/em-streamout); this adapter performs bounded extraction rather than invoking a Rich Edit layout engine. All successful previews are explicitly **partial**.

## Reproduce

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/export-native-drawing.ts /path/model.rvt --view-id 245424 \
  --out /path/annotations.svg --report /path/preview.json \
  --evidence-out /path/evidence.json

# Focused detail-curve selection
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/export-native-drawing.ts /path/model.rvt --view-id 958303 \
  --classes CurveElem --out /path/detail-lines.svg --evidence-out /path/curves.json

# Independently reopen projected fields, pointer edges, owners and source SHA
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-native-drawing.ts /path/evidence.json --view-id 245424 \
  --rvt /path/model.rvt --out /path/source-audit.json
```

The CLI selects the view separately before the annotation selection so an annotation retention cap cannot evict its frame. The default focused selector is `TextNote,IndependentTag,RoomTag,AreaTag`, bounded to 2,048 retained / 4,096 decoded records and 64 MiB output. Optional detailed dimensions and curves should use explicit classes or IDs. The general source inventory retains its curated selector so annotation-heavy files do not exceed its existing decode cap.

## Model evidence

[Generated validation](generated/rvt-native-drawing-validation.json) records exact RVT SHA256 values, retained class counts, source-field/pointer comparisons, primitive owner/digest comparisons and browser checks. Private RVTs and raw graphs remain outside Git.

| Source model / native view | Source preview evidence | Source selection |
| --- | --- | --- |
| RAC / 312 | 3 text notes, 19 tag-head markers | Complete; two unbounded dimensions omitted from the wider validation selector |
| RAC / 245424 | 4 text notes, 2 straight leaders, 26 tag-head markers | Complete |
| RAC / 958303 | 3 source detail lines | Complete curve selector |
| School / 312 | 77 tag-head markers | Complete; five unsupported owned annotations omitted from the wider validation selector |
| Snowdon / 1350631 | 2 text notes, 56 tag-head markers | Partial: 2,048 annotation records retained; 595 omitted by retention budget |

The wider RAC/School validation selected `LinearDimString` explicitly alongside the focused default. Source audits compare every projected field with its original graph value and every owned pointer path with the original graph edges. Chromium independently reopens all five SVGs, checks exact rendered DOM owner IDs, finite view boxes and no scripts; visible straight leaders/text and three native detail lines were inspected. Sixteen scoped tests cover prior inventory gates plus drawing owner/frame/visibility checks, RTF budgets/escaping, unbounded dimension rejection and nested tag/curve ownership.

A negative Snowdon witness selecting all detailed dimensions reaches the unchanged 4,096 decoded-record cap, returns `budget-blocked` without completed summary/schema context, and refuses the drawing. It is not reclassified as a complete drawing or silently admitted with missing source context.


## Source-native circular detail extension

`native-drawing-arcs.ts` adds circular detail primitives without changing scene geometry, IFC bodies or room/navigation boundaries. The exact full-circle tag `0x00080004` and zero stored endpoint pair follow pinned upstream [RE-100 / first_circle](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/partition_beam_axes.rs#L255). Nonzero bounded intervals use the supported `0x01080004` tag; all other flags or contradictory intervals remain unresolved. The native GArc evaluator is `center + radius * (cos(t) * x + sin(t) * y)`, matching the pinned [parametric profile evaluator](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/native_parametric_surface.rs#L141).

The SVG uses a circle for a proven periodic record and exact [SVG elliptical-arc commands](https://www.w3.org/TR/SVG2/paths.html#PathDataEllipticalArcCommands) for a bounded circular interval. Sweep follows the native basis after the source-view Y inversion; a bounded full turn splits into two arcs to avoid SVG's coincident-endpoint ambiguity. Source interval, evaluated interval, center, basis, radius, body digest and raw-record index stay in metadata. Presentation extents use analytic circle extrema rather than a source bounding box.

Actual RAC source owner `941493`, in native view `245424`, now renders its stored circle with radius `0.4880464958558832` feet. Its owned `CurveElemDriver → GArc` pointers, five source geometry fields, exact native flag and source digest were reopened independently. Chromium renders the same source circle; four radial samples agree within `0.00000313` feet. School view `3390` provides a negative witness: eight finite family arcs have `m_useOffsetPos=true` and unsupported family flags, so their offsets are not guessed. Its twelve already supported source detail lines remain visible.

[Extension validation](generated/rvt-native-circular-detail-validation.json) records the two source SHA256 values, exact native circle field/flag witnesses, browser counts and partial/withheld outcomes. Synthetic tests additionally verify circular arc sweep in both native handednesses, bounded full turns, exact periodic tags, and rejection of missing ownership, flags, fill, offsets, reversed drivers or out-of-plane bases. This extends the partial source preview; native sheet transforms, crop evaluation and curved text leaders remain unresolved.
