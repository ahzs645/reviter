# Editing in the studio, read against IFClite's interface — 2026-08-19

A companion to [the IFClite evaluation](ifc-lite-evaluation-2026-08-19.md),
which covered libraries. This one is about the **interface**: which parts of
IFClite's viewer are worth copying, and what it would take for Reviter to let
someone actually change something rather than only look at it.

Read against `apps/viewer` at `6ce17fa` — 356 `.tsx` components, a 90-slice
Zustand store, a 3,255-line mutation slice.

## The constraint that decides everything

**Reviter cannot write RVT, and realistically never will.** Reading the format
took 89 research entries; writing it is a different and much harder problem, and
a corrupted `.rvt` is worse than no `.rvt`.

So an edit in Reviter is not a change to the building. It is a **user assertion
layered on a recovery**, and the only way it reaches the world is through
export — IFC above all, since [probe 1](ifc-lite-evaluation-2026-08-19.md)
showed Reviter's IFC parses cleanly in an independent implementation with
`Reviter_Recovery` and the Revit element ids intact.

That has a consequence the interface has to carry. Reviter's whole discipline is
separating what was decoded from what was inferred — `categorySource`,
`renderGeometryProvenance`, `GeometryExact`, the "How this geometry was made"
card. A user edit is a **third** provenance class, and it is the least reliable
of the three. An interface that lets someone type over a decoded parameter and
then shows the result in the same grey text as the decode has quietly destroyed
the property the whole project is built on.

So: editing is worth adding, and it must be visibly a different thing.

## Reviter already edits — one entity type, one path

This is not a new capability, it is an existing one that covers one case.
`lib/reviter/room-review.ts` already does all of it for derived rooms:

- a **disposition** per candidate (`unreviewed` / `accepted` / `dismissed`) —
  the user overruling a derivation;
- **user-authored fields** — number, name, long name, description, department,
  occupancy, accessibility, notes, height;
- an **export decision** per room (`ifc.export`) and an IFC-schema-constrained
  enum (`ifc.predefinedType`, restricted to the three `IfcSpaceTypeEnum` items
  Reviter is willing to emit);
- persistence as a **sidecar** keyed to the model (`review-exchange.ts`), never
  written back into the source; and
- consumption by `makeIfc(result, { rooms })`, which emits only accepted rooms.

That is an overlay-plus-review-plus-export pipeline already in the codebase. The
question is not "should Reviter be able to edit" — it already can. The question
is whether that pattern generalises from derived rooms to decoded elements, and
IFClite's viewer is a good place to see what the generalised version looks like
when it is mature.

## What IFClite's editing surface actually is

Five things, and they are separable:

**1. One global mode switch.** `uiSlice.editEnabled`, surfaced as a single pill
in the toolbar. Their own comment says why: *"so the user has one switch for 'am
I editing anything?' rather than per-panel toggles."* A named `AUTHORING_TOOLS`
set (`addElement`, `split`, `spaceSketch`, `cesium-placement`) flips the mode on
when entered and is forced back to `select` when the mode is left, with a
comment noting that duplicating that check in two places is exactly how the two
states drift apart.

**2. An overlay, never a destructive write.** Edits go into a
`MutablePropertyView` / `StoreEditor` sitting on top of the parsed store. The
parse result is not modified. `getEffectiveChanges()` reads the live overlay.

**3. Per-model undo/redo and change sets.** `mutationSlice.ts` keeps
`undoStacks` / `redoStacks` keyed by model, plus named change sets.

**4. A wide but bounded operation set.** Properties, quantities, attributes,
positional attributes, entity type, georeference fields; geometry as
translate / set-position / rotate / split (wall, linear, slab-by-line) /
duplicate / remove; creation of wall, slab, beam, column, door, window, space,
roof, plate, member, plus auto-generated spaces from walls.

**5. Review before export.** `ExportChangesButton` shows a badge with the
pending-change count; `ExportChangesReviewDialog` lists previous → new grouped by
model then entity, and the button re-derives the groups at click time and
*refuses to export* if the overlay changed while the dialog was open. Export
then runs `exportToStep(store, { applyMutations: true })`.

And one detail worth singling out, because it is the most Reviter-shaped thing
in their whole UI. `GeometryEditCard` resolves the entity's placement chain, and
when the placement is not a simple `IfcLocalPlacement` chain — mapped
representations, missing `ObjectPlacement`, 2D-only placements — it **renders
the Move controls disabled with an explanation**, while leaving Duplicate and
Delete working. It does not silently move the wrong thing. Reviter has that
problem at far greater scale: a `GeometryProvenance=approximate` bounds envelope
is not a body, and "move this wall" against one means something different than
against a native BREP.

## The export is not the weak link — correcting this entry

The first draft of this section treated route B below ("edit inside an IFC
store") as the expensive one, largely on the assumption that Reviter's IFC is a
lossy derivative. The [2026-08-02 export validation](unbc-rvt-to-ifc-export-2026-08-02.md)
says otherwise, and the numbers change the argument:

| Measure | Reviter IFC4 export | Paired Autodesk IFC2X3 |
| --- | ---: | ---: |
| IFC elements | 44,009 | 41,312 |
| Products with readable geometry | 39,846 | 39,355 |
| Triangles | 961,316 | 934,123 |
| Revit tags with native `UniqueId` | 41,709 | 38,187 |
| Material definitions | 69 | 30 |

IfcOpenShell reported no schema, reference or IFC4 EXPRESS-rule violations on
the full model. On element count, triangles, identity coverage and materials,
Reviter's export is *ahead of* the file Revit's own exporter produced from the
same building.

That matters here for one reason: **the IFC is the only Reviter output that
carries geometry, semantics, identity and provenance in one file.** GLB has the
geometry and no semantics. The JSON audit has the semantics and no standard
geometry. Anything that edits a Reviter model and expects the result to survive
is editing towards the IFC whichever route it takes.

Two corrections follow.

**The express-id bridge is cheap, not expensive.** The earlier entry claimed the
studio's viewport, picking and batching key on Reviter records rather than
express ids, "so the whole UI would need a bridge". The exporter already writes
`Reviter_Recovery.RevitElementId` on every tagged product and 41,709 of them
also carry the native `UniqueId` — and [probe 1](ifc-lite-evaluation-2026-08-19.md)
confirmed both survive an independent parse. The bridge is one `Map` built at
parse time, not a rewrite.

**The real blocker is size, and it is in our own doc.** That same audit records
the export as **162 MB** for the 67 MB sample model — twice the Autodesk IFC,
because bodies are per-element `IfcTriangulatedFaceSet` rather than parametric
extrusions — and notes that IFC creation is currently **synchronous in the
browser** and should move to a worker. Making an IFC round-trip the substrate
for *interactive* editing would pay that cost to open a properties panel. That,
not the data mapping, is what keeps interactive editing on a native overlay.

## What "edit" would mean in Reviter — three routes

| Route | How | Buys | Costs |
| --- | --- | --- | --- |
| **A — native overlay** | Generalise `room-review`: an `ElementOverrides` sidecar keyed by Revit element id, applied by `makeIfc` | No new dependency, no second model in memory, provenance stays in Reviter's own vocabulary, works offline in the existing worker pipeline; edits are readable without materialising 162 MB | Reviter writes every editor itself; no element *creation* without a lot of new geometry code |
| **B — export then edit in an IFC store** | `makeIfc` → `parseColumnar` → `StoreEditor` + `addWallToStore` etc. → `exportToStep({applyMutations:true})` | A whole authoring operation set immediately, including element creation, undo/redo and change sets, against an export that already validates | 162 MB materialised and parsed before the first edit, with export currently synchronous; +1.46 MB gzipped WASM; two models in memory |
| **C — A for interactive editing, B for batch** | Overrides sidecar in the studio; IFC-store route for offline/CLI authoring and element creation | Neither path pays the other's cost — the panel stays responsive, and batch work gets the full operation set | Two mechanisms, and the override semantics have to agree between them |

**Recommendation: C, and the split is by workload rather than by phase.** Almost
every edit worth making on a *recovery* is an override of something already
decoded — a category the consensus got wrong, a type name that did not resolve,
a parameter Revit does not surface, a `GeometryExact` claim the reviewer
disputes. Those belong on the overlay: they are small, they are per-element, and
a reviewer makes them while looking at the model.

Element *creation* — patching the [undrawn census](unbc-undrawn-element-census-2026-07-28.md)
by hand — and any bulk transformation over the whole building are the cases that
genuinely want an IFC store, and they are also the cases where materialising the
export is not a waste, because the export is the deliverable anyway. Moving IFC
creation into a worker is a prerequisite for both, and it is already on the
record as needed.

## The interface, piece by piece

| IFClite | Worth it | Why, in Reviter's terms |
| --- | --- | --- |
| **Global `editEnabled` pill** | **Yes, first** | Not a nicety here. The studio must make "I am looking at a recovery" and "I am asserting things over a recovery" two visibly different states. One pill in `ViewerToolbar`, one flag, tools forced back to select on exit. Copy their `AUTHORING_TOOLS` discipline verbatim. |
| **Overlay model (no destructive write)** | **Yes** | Already how `room-review` works. Extend, do not invent. The `ConvertResult` must stay exactly what the decoders produced — it is the evidence. |
| **Undo/redo stacks** | **Yes** | `room-review` has no undo today, which is survivable for a handful of rooms and not for parameter edits across 39,159 elements. |
| **Review-before-export dialog** | **Yes** | The single highest-value piece. A recovered model plus user overrides, exported as one IFC, is exactly the artefact where "which of these did a person assert?" must be answerable before the file leaves. Their re-derive-and-refuse-if-changed behaviour is worth copying too. |
| **`GeometryEditCard`'s honest gating** | **Yes — the pattern, not the code** | Gate on `renderGeometryProvenance` instead of on placement-chain shape. `native` → geometry edits meaningful; `reconstructed` → warn; bounds-envelope fallback → disable with an explanation, exactly as they do. |
| **`BulkPropertyEditor`** (query-driven mass edit) | **Yes, high value** | Per-element editing is close to useless at Reviter's scale. The edits that pay are categorical: "every one of the 6,248 curtain panels gets this type name", "every element whose category came from record-code consensus is flagged for review". This is where editing earns its place in a recovery tool. |
| **`PropertyEditor`** (inline, schema-aware, undo/redo) | **Yes, scoped down** | Their 1,731 lines include IFC4 schema validation Reviter does not need at first. What Reviter needs is narrower and stricter: an override is a *typed* value against a known `BuiltInParameter`, and the enum-valued ones must stay constrained the way `spacePredefinedType()` already constrains its three items. |
| **`CommandPalette`** | **Yes, cheap** | `ViewerToolbar` is deliberately one crowded row whose own header notes the panel toggles are pinned so they never scroll out of reach. A palette is the pressure valve, and it is a self-contained component. |
| **`EntityContextMenu`** | **Yes, cheap** | Right-click on a selected element → isolate, hide, copy properties, edit. Reviter has the actions already; it lacks the menu. |
| **`AddElementPanel`** | **Later** | Route B. The honest use is patching known recovery gaps, and anything placed by hand must be marked synthetic in the export — a `Reviter_Recovery` value that is neither `native` nor `reconstructed`. |
| **`HierarchyPanel` / `SearchModal` filter builder** | **Maybe** | `ObjectList.tsx` is 115 lines against their filter builder's several files. Worth reading for the filter-expression UI, not worth porting. |
| **`LensPanel`** (rule-based colour/filter) | **Maybe** | Pairs with `@ifc-lite/lens` from the library review; would replace ad-hoc colouring in `scene.ts`. |
| **Ribbon (`AuthorTab` etc.)** | **No** | A five-tab ribbon is right for a 356-component app. Reviter's toolbar is one row on purpose. Take the Author tab's *contents* as a checklist, not its chrome. |
| **`ClashPanel`, `ComparePanel`, `ZonesPanel`, `SheetSetupPanel`, `CesiumOverlay`, `PointCloudPanel`, `CollabPresenceLayer`, `ChatPanel`, `ScriptPanel`** | **No** | Federation, geo-placement, point clouds, CRDT collaboration and sheet layout are outside what Reviter claims to do. |
| **Zustand store / shadcn-ui / Tailwind ribbon primitives** | **No** | `ReviterStudio.tsx` is a 2,430-line composition root with its own conventions. Adopting their state library to get an edit overlay is backwards. |

## The first concrete change

`app/studio/types.ts:70`:

```ts
export type PropertyRow = { key: string; label: string; value: string };
```

A flat, pre-stringified display row — `ReviterStudio.tsx:909` formats parameters
to `"3.0000 ft"` before they reach the dock. Nothing downstream can tell a
decoded value from a derived one, and there is nowhere to put an edited one.

That type is the bottleneck for the whole feature, and widening it is the first
commit:

```ts
export type PropertyRow = {
  key: string;
  label: string;
  value: string;
  /** Where the displayed value came from. Governs how it is rendered. */
  provenance: "decoded" | "inferred" | "edited";
  /** Absent when the field cannot be overridden, with the reason why. */
  edit?: { kind: "text" | "number" | "enum"; unit?: "feet"; options?: readonly string[] }
        | { kind: "locked"; reason: string };
  /** The decoded value, kept when `provenance === "edited"`. */
  decodedValue?: string;
};
```

Once rows carry that, `PropertiesDock` can render an override differently from a
decode, show what the decode said underneath, and disable the fields that must
not be touched — with a reason, the way `GeometryEditCard` does. `makeIfc` then
needs one thing: overrides applied on top of `ElementBoundsRecord`, and a
`Reviter_Recovery` property recording that a human, not a decoder, produced the
value.

## Staged plan

1. **Widen `PropertyRow`** with provenance and editability. Nothing is editable
   yet; the dock just stops pretending every row is the same kind of fact.
2. **`editEnabled` pill** in `ViewerToolbar` + the forced-tool-reset discipline.
3. **`ElementOverrides` sidecar** — generalise `room-review`'s shape to
   `ElementBoundsRecord`, keyed by Revit element id, persisted through
   `review-exchange.ts` alongside comments and markup, with undo/redo.
4. **`makeIfc` applies overrides** and marks them in `Reviter_Recovery`.
   Extend `tests/export-ifc.test.ts` to assert an overridden value is emitted
   *and* flagged — and re-run [probe 1](ifc-lite-evaluation-2026-08-19.md) so an
   independent reader confirms the flag survives.
5. **Review-before-export dialog**, listing decoded → asserted per element.
6. **Bulk edit by category / evidence class** — the one that pays at 39,159
   elements.
7. **Command palette and context menu** — cheap, and by now there are enough
   commands to justify them.
8. **Move IFC creation into a worker** — already on the record as needed for a
   162 MB export, and a prerequisite for anything that treats the IFC as an
   editable substrate rather than a final artefact.
9. *Only then* the route-B store for element creation and bulk authoring.

Steps 1–5 add no dependency on IFClite at all. Its viewer is worth reading as a
worked example of the same problem solved at scale; only step 8 would import
any of it.
