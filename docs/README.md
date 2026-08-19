# Reviter's research record

Reviter is a clean-room decoder for a proprietary format, so almost everything
it does was arrived at by measuring rather than by reading a specification.
These files are that record: what was probed, what the controls said, what was
tried and rejected, and what is still not reachable.

**Two kinds of document live here, and they are not interchangeable.**

- **Entries dated in their filename or their header** are observations from runs
  on a specific model on a specific day. Almost all of them are the supplied
  67 MB Revit 2027 project ("the UNBC model"), which is not in this repository —
  so nothing re-derives their figures, no test checks them, and a run today would
  give different numbers. They are evidence for why a rule is written the way it
  is, not a description of current behaviour.
- **Undated topic files** describe a format, a decoder or a boundary. Where they
  quote a number it is usually from the same one building, and they say so.

For what Reviter currently claims to do, read the [README](../README.md). For why
a rule exists, read here.

## The 2026-07/08 audit of the supplied Revit 2027 project

These eleven entries were the README's investigation narrative until 2026-08-12.
Read in this order they are roughly the order the work happened.

| Entry | What it settles |
| --- | --- |
| [Coverage measurements](unbc-coverage-measurements-2026-07-30.md) | The per-class coverage and agreement tables, the reconciliation of the three drawn-coverage percentages, and the sample-evidence ledger |
| [The paired-export harness](unbc-paired-export-harness-2026-07-28.md) | `verify-pair.ts`'s twenty-two assertions and where each threshold comes from, the storey/wing hold-out, and the geometric overlay |
| [Which bounds copy is the element's](unbc-bounds-record-copies-2026-07-28.md) | An element's extent is written twice; which copy to read, tested on classes the rule was not fitted to, and the solids drawn on the wrong element |
| [Wall bodies](unbc-wall-surfaces-and-solids-2026-07-28.md) | Trimmed analytic surfaces, walls rebuilt from plane triples, curved walls rebuilt from cylinder triples, and why the diagonal walls are unreachable |
| [Stairs and railings](unbc-stair-and-railing-geometry-2026-07-28.md) | Railing sweeps, the path filed one id up, stair-run companion records, landings drawn from their ring, and the raked solid that does not exist |
| [Doors, windows and openings](unbc-door-window-opening-geometry-2026-07-28.md) | A door's record is its opening plus the swing; a window is bounded by the opposite faces; the openings row double-counts |
| [Drawn but not elements](unbc-drawn-but-not-elements-2026-07-28.md) | Boundary sketches, unnamed storey-sized plates, top rails, and cached family shapes — all drawn, none of them building elements |
| [Element object framing](unbc-element-object-framing-2026-07-28.md) | The length-behind-the-object framing, the markers besides `0x08c6`, the placement hiding in the `0x07ef` objects, and the chunks needing a preset dictionary |
| [The undrawn census](unbc-undrawn-element-census-2026-07-28.md) | Everything still not drawn, grouped by cause rather than class, and the product-vs-element counting error |
| [The viewer and the reference comparison](unbc-viewer-and-reference-comparison-2026-07-28.md) | What the shaded view can honestly show, what a shipped read-only CAD viewer was worth copying, and the overlay and walk modes |
| [Supplied-project synthesis](supplied-project-synthesis.md) | What was taken from each of the supplied projects, and what was deliberately not |

## Format and decoder boundaries

| Entry | Subject |
| --- | --- |
| [Stream coverage and the embedded schema](rvt-stream-and-schema-coverage.md) | Every CFB stream, how deeply each is decoded, and the `Formats/Latest` class inventory |
| [Validating on a second building](validating-on-a-second-building.md) | What fitting every rule to one model has cost, rule by rule, and what to look at first on a second file |
| [ODA `BmJsonExport` static analysis](bm-json-export-static-analysis.md) | The semantic JSON contract and the native geometry boundary that cannot cross into a browser |
| [`rvt-rs` loader analysis](oda-loader-analysis.md) · [semantic graph](oda-semantic-graph-analysis.md) | The vendored Rust/WASM reader's structure and support boundary |
| [Parser prototype review](rvt-parser-prototype-review.md) | The early prototype the current parser replaced |
| [IFClite evaluation, 2026-08-19](ifc-lite-evaluation-2026-08-19.md) | What an external client-side IFC toolkit has that Reviter does not, four probes against Reviter's own IFC output, and what is worth taking |
| [How an element record is laid out](revit-element-record-layout.md) | The frame, the field encodings, the deferred-object queue, and what they explain |
| [Revit's embedded enumeration tables](revit-enumeration-tables.md) | The embedded enumeration tables, the Revit category labels they supply, the parameter enumerators, and what `-1001101` turns out to be |

## Revit 2027 geometry replay

The largest cluster here: the `Geometry` → `Face`/`GEdge`/`EdgeLoop` replay, the
surface classes it reaches, and the ownership rules that attribute them.

| Area | Entries |
| --- | --- |
| Replay envelope and FIFO | [general FIFO replay](revit-2027-grep-general-fifo-replay.md) · [dynamic queue subset](revit-grep-dynamic-queue-subset.md) · [`GGroup` FIFO boundary](revit-2027-ggroup-fifo-boundary.md) · [release boundary](revit-2027-grep-release-boundary.md) · [`GLine` and the replay envelope](revit-2027-gline-and-replay-envelope.md) |
| Faces, edges and loops | [face static](revit-2027-face-static.md) · [face child replay](revit-2027-face-child-replay.md) · [edge loop static](revit-2027-edge-loop-static.md) · [edge 1423 boundary](revit-2027-edge-1423-boundary.md) · [planar topology](revit-2027-planar-topology.md) · [planar co-edge retiming](revit-2027-planar-coedge-retiming.md) |
| Analytic surfaces | [analytic surfaces](revit-2027-analytic-surfaces.md) · [arc and surface of revolution](revit-2027-arc-surfrev.md) · [cylinder and cone trims](revit-2027-cylinder-cone-trims.md) · [cone apex sector](revit-2027-cone-apex-sector.md) · [`GArc`](revit-2027-garc.md) · [`GPolyline`](revit-2027-gpolyline.md) |
| Meshes and tessellation | [planar owner mesh](revit-2027-planar-owner-mesh.md) · [planar sampled BRep](revit-2027-planar-sampled-brep.md) · [native BRep handoff](revit-2027-native-brep-handoff.md) · [`GPolymesh` reader boundary](rvt-2026-gpolymesh-reader-boundary.md) · [tessellator static analysis](tessellator-static-analysis.md) · [native tessellation policy](native-tessellation-policy.md) · [browser BRep tessellator](browser-brep-tessellator.md) · [neutral topology adapter](browser-brep-neutral-topology-adapter.md) |
| Ownership and slots | [`GArray` ownership](revit-2027-garray-ownership.md) · [geometry class slot resolution](geometry-class-slot-resolution.md) · [geometry slot 2343](revit-2027-geometry-slot-2343.md) · [missing owner route inventory](revit-2027-missing-owner-route-inventory.md) · [embedded `GElement`](revit-2027-embedded-gelement.md) · [conditioned geometry](revit-2027-conditioned-geometry.md) · [`condInt16` drawable coverage](revit-2027-condint16-drawable-coverage.md) |
| Symbols and families | [nested symbol composition](revit-2027-nested-symbol-composition.md) · [family geometry table](revit-2027-family-geom-table.md) · [2026 element grep carrier](revit-2026-element-grep-carrier.md) · [2026 grep child reader map](revit-2026-grep-child-reader-map.md) · [2026 source representation targets](revit-2026-source-representation-targets.md) |
| Stairs and railings | [base railing stairs](revit-2027-base-railing-stairs.md) · [railing nested roots](revit-2027-railing-nested-roots.md) · [nested grep railing plan](nested-grep-railing-plan.md) · [baluster instances](revit-2027-baluster-instances.md) · [stairs aggregate](revit-2027-stairs-aggregate.md) · [top rail recovery](revit-2027-top-rail-recovery-report.md) |
| Materials and fills | [`GStyle` material fallback](revit-2027-gstyle-material-fallback.md) · [face material binding](revit-2027-face-material-binding.md) · [fill pattern data](revit-2027-fill-pattern-data.md) · [fill grid](revit-2027-fill-grid.md) · [`GFilling`](revit-2027-gfilling.md) |
| Gaps | [IFC geometry gap](revit-2027-ifc-geometry-gap.md) |

## Identity, relations and materials

[Native identity](rvt-native-identity.md) ·
[associated-level relations](rvt-associated-level-relations.md) ·
[host relations](rvt-host-relations.md) ·
[transmission data](revit-transmission-data.md) ·
[material decoder](rvt-material-decoder.md) ·
[compound-structure materials](rvt-compound-structure-materials.md) ·
[family material relations](rvt-family-material-relations.md) ·
[family symbol materials](rvt-family-symbol-materials.md) ·
[remaining material carriers](rvt-remaining-material-carriers.md) ·
[element table ownership](element-table-ownership-analysis.md) ·
[BM JSON export static analysis](bm-json-export-static-analysis.md)

## Audits of the supplied building

Dated audits, each one run against one model on one day.

[IFC parity baseline](unbc-ifc-parity-baseline.md) ·
[GLB registration and the stair waist, 2026-08-13](unbc-glb-registration-and-stair-waist-2026-08-13.md) ·
[RVT to IFC export, 2026-08-02](unbc-rvt-to-ifc-export-2026-08-02.md) ·
[three-source audit, 2026-08-01](unbc-three-source-audit-2026-08-01.md) ·
[CAD floor audit, 2026-08-01](unbc-cad-floor-audit-2026-08-01.md) ·
[planar BRep audit](unbc-planar-brep-audit.md) ·
[faceted topology probe](unbc-faceted-topology-probe.md) ·
[`GPolymesh` object context audit](unbc-gpolymesh-object-context-audit.md) ·
[identity-tree material gap audit](unbc-identity-tree-material-gap-audit.md)
