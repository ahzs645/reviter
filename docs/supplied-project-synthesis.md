# What was taken from each supplied project

Reviter was started from a set of supplied reference projects. This entry
records what was carried over from each, what was deliberately left, and what a
second review found was no longer worth bringing. It was part of the README
until 2026-08-12.

| Supplied project | What Reviter uses |
| --- | --- |
| `rvt-app-main` | The MIT-licensed [`@phi-ag/rvt`](https://github.com/phi-ag/rvt) streaming metadata and thumbnail reader |
| `rvt-ts-viewer` | The partition-coordinate recovery approach, reworked into the reusable `lib/reviter` core and a transferable Web Worker pipeline |
| `rvt-rs-main` | The clean-room format status, support boundary, diagnostic model, and optional WebAssembly reader integration |
| `rvt2ifc-fe-master` | The openBIM viewer/export direction; current Reviter exports can be handed to IFC viewers |
| `rvt-convert-main` | Export-format and configuration ideas only; its Autodesk/Azure upload flow is intentionally excluded because it conflicts with client-only processing |
| `revitless-toolkit-master` | Clean TypeScript equivalents for PartAtom, shared parameters, type catalogs, OmniClass text, and legacy `BasicFileInfo`; its OLE/thumbnail layer is redundant with the existing browser reader |

A second review of the supplied projects found little left to bring over from the
browser ones: `rvt-app-main`'s Revit handling is a thin wrapper over
`@phi-ag/rvt` that Reviter already calls directly, `rvt-ts-viewer`'s recovery is
a subset of `lib/reviter/segment-scan.ts`, and `rvt2ifc-fe-master`'s IFC
type-code table is redundant now that `web-ifc` reports type names directly. The
remaining value was in `rvt-rs`: its `Formats/Latest` work is the basis for
[the schema inventory](rvt-stream-and-schema-coverage.md#embedded-schema), and
its published tag-drift dataset is what that inventory is checked against.

The Revitless review did not uncover another RVT geometry decoder. Its useful
portable surface has been reimplemented as worker-safe TypeScript in
`lib/reviter`, without .NET, filesystem APIs, or Autodesk runtime assemblies. For
this personal/internal build, its `Decompiled/*` Revit 2021 vocabulary is also
mechanically transposed into an explicitly marked optional compatibility module —
`lib/reviter/legacy-revit-2021.data.ts`, 8,075 rows preserving the old API enum
aliases, category and parameter-group labels, MEP classifications, shared-data
types, display units, symbols, and their cross-mappings. It is a 0.33 MB lazy
chunk rather than part of the initial viewer bundle, and it is not treated as
clean evidence by the RVT geometry decoder. That `Decompiled` tree is not in this
repository, so the transposition cannot be re-run here; the header of
`scripts/generate-legacy-revit-api.ts` records what it read. The toolkit's
vanilla and food-service OmniClass editions are bundled as static, on-demand text
assets for the local classification browser.

A separate [static analysis of the isolated ODA `BmJsonExport`
example](bm-json-export-static-analysis.md) documents its semantic JSON contract,
the native geometry API boundary, and the pieces that cannot be carried into a
browser from the supplied ELF binaries.

## The Autodesk Viewer capture

The captured Autodesk Viewer assets were inspected with the supplied `jsmap`
workflow, and for a while Reviter bundled a locally converted, quantized GLB of
Autodesk's server-generated derivative of the supplied building and used it as a
high-fidelity reference view.

**That asset no longer ships**, and the reason is in the README's Development
section: a 25.6 MB derivative of one specific project was in every clone, and
every other RVT found the feature permanently disabled. The capability stayed and
the asset went — pair your own GLB or glTF from disk. Reading the capture never
turned Autodesk Viewer into an RVT decoder; what it contributed was the mesh
hierarchy and material conventions a good conversion produces, and the
[navigation constants](../app/studio/autodesk-navigation.ts) measured off a live
session.
