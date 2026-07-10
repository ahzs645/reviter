# Reviter

Reviter is a browser-only Revit inspection and experimental geometry conversion library. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file is opened from the browser file picker, parsed in the tab, and converted in a dedicated Web Worker. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 nested duplicated-bounds record detection, with native element IDs, record codes, field counts, and axis-aligned bounds in feet
- evidence-backed display classification for walls, doors, panels, frames, columns, railings, slabs/roofs, coverings, windows, stairs, and ramps in the supplied 2027 model
- a standards-aware Revit `Material` schema adapter for reader-supported releases (real-file extraction and element assignment are not wired yet)
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

A 2027 envelope is not an element's native shape. Native family meshes, curved faces, openings, compound-layer assignments, element-material references, parameters, constraints, and general typed BIM semantics remain undecoded. Appearance/material strings, colors, and embedded previews exist in the partition corpus, but production extraction and assignment are not implemented. The IFC exporter therefore writes clearly described `IfcBuildingElementProxy` geometry; it does not mislabel proxies as native `IfcWall`, `IfcSlab`, or family geometry.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Materials |
| --- | --- | --- | --- |
| 2023 | fixed `ArcWall` six-coordinate record detected as a bounds hypothesis | production promotion disabled pending paired proof | schema adapter only; real extraction pending |
| 2024–2026 | version-specific geometry record not yet proven | diagnostic fallback only | schema adapter only; real extraction pending |
| 2027 | supplied-project nested duplicated bounds + native element ID and record classification | filtered, category-styled axis-aligned envelope proxies | category display fallbacks; native assignment pending |
| unknown | no release-specific decoder | diagnostic fallback only | no claim |

## Supplied-project synthesis

| Supplied project | What Reviter uses |
| --- | --- |
| `rvt-app-main` | The MIT-licensed [`@phi-ag/rvt`](https://github.com/phi-ag/rvt) streaming metadata and thumbnail reader |
| `rvt-ts-viewer` | The partition-coordinate recovery approach, reworked into the reusable `lib/reviter` core and a transferable Web Worker pipeline |
| `rvt-rs-main` | The clean-room format status, support boundary, diagnostic model, and optional WebAssembly reader integration |
| `rvt2ifc-fe-master` | The openBIM viewer/export direction; current Reviter exports can be handed to IFC viewers |
| `rvt-convert-main` | Export-format and configuration ideas only; its Autodesk/Azure upload flow is intentionally excluded because it conflicts with client-only processing |

The implementation also uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

The captured Autodesk Viewer/OTG assets were recovered with the supplied `jsmap` workflow and used only as a regression/output-format oracle. Autodesk's browser viewer consumes server-generated derivative meshes and materials; it is not an RVT decoder and is not shipped or called at runtime.

## Paired regression workflow

After opening an RVT, choose its matching IFC export in the **Regression fixture** panel. Both files remain local. Reviter then:

1. parses native IDs from `Global/ElemTable`;
2. detects every strict nested duplicated-bounds record in each decompressible `Partitions/*` page and inventories leading-u32 evidence;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join remains diagnostic evidence. A duplicated-bounds record is stronger. Correlation against the supplied IFC joins 25,180 unique recovered IDs to known IFC products/types and yields strong record-code clusters for walls, doors, panels, members, columns, railings, slabs, roofs, coverings, and windows. This validates the record as an element envelope and supports the supplied-model display classification, but it still does not prove a native shape or a universal Revit object class mapping.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- nested duplicated-bounds recovery: 35,677 record occurrences, 35,633 unique native IDs, and 33,985 non-zero 3D envelopes
- RVT-only default scene: 28,225 category-classified element proxies; 1,569 curtain-wall/opening wrapper envelopes and 4,191 unclassified envelopes remain auditable/exportable but are hidden from the default view
- generated scene: 225,800 vertices, 338,700 triangles, and 21 category batches
- paired index evidence: 8,902 `ElemTable` IDs plus 37,324 partition-record IDs
- Autodesk derivative cross-check: 59,582 stable Revit IDs and 51,420 fragments in the signed-in reference capture
- Autodesk derivative presentation evidence: 22 materials and no bitmap textures; its screenshot look comes primarily from detailed meshes, technical shading, feature edges, and shadows
- strongest supplied-pair clusters include 1,044 standard walls, 1,294 doors, 15,654 members, 4,972 plates, 95 columns, 136 railings, and 53 slabs
- local RVT-only conversion completes in about 12 seconds on the development machine after replacing byte-by-byte scanning with native typed-array signature search

The bounds signature is currently confirmed for this supplied Revit 2027 file. It must be regression-tested on more RVT versions before being treated as a general Revit decoder.

## Library surface

```ts
import {
  convertRvtBytes,
  makeDxf,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
} from "./lib/reviter";

const bytes = await file.arrayBuffer();
const result = convertRvtBytes(bytes, file.name, {
  maxSegments: 12_000,
  // Read from BasicFileInfo; release-specific native decoders are disabled if omitted.
  revitVersion: 2027,
});

if (result.ok) {
  const obj = makeObj(result);
  const dxf = makeDxf(result);
  const svg = makePlanSvg(result);
  // Historical API name; duplicated-bounds results export as IFC solid proxies.
  const ifc = makeIfcCenterlines(result);
  const audit = makeReport(result, null);
}
```

For production UI work, use `lib/reviter/worker.ts` as the entry point so large files do not block the main thread.

IFC reference analysis is deliberately isolated in `lib/reviter/ifc-worker.ts`, keeping the 3 MB parser bundle and its WebAssembly binary out of the main interface bundle until an IFC is actually selected.

## Development

```bash
npm install
npm run dev
npm test
npm run test:pages
```

The original model remains in `work/` and is not copied into `public/` or the deployment output.

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
