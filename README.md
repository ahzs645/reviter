# Reviter

Reviter is a browser-only Revit inspection and experimental geometry conversion library. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file is opened from the browser file picker, parsed in the tab, and converted in a dedicated Web Worker. The application has no file upload route, account system, telemetry, or remote conversion service.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 duplicated-bounds record detection, with native element IDs and axis-aligned bounds in feet
- release-gated Revit 2023 standard `ArcWall` decoding, with native centerline endpoints from the fixed record envelope
- standards-aware Revit `Material` definition decoding (name, packed color, and transparency) for reader-supported releases
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter now selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In Revit 2023, the proven standard `ArcWall` envelope stores two centerline endpoints. In the supplied Revit 2027 model, a different record signature contains two identical six-`f64` axis-aligned bounds blocks. Unknown signatures fall back to the coordinate-diagnostic scanner and are labeled diagnostic-only.

The 2023 centerline is native profile evidence, but its displayed thickness and height are still explicit defaults. A 2027 envelope is not an element's native shape. Native family meshes, curved faces, openings, compound-layer assignments, texture/image assets, parameters, constraints, and general typed BIM semantics remain undecoded. Material definitions decoded by the standards-aware reader are carried into GLB/IFC/JSON but stay unassigned until the element-material reference is proven. The IFC exporter therefore writes clearly described `IfcBuildingElementProxy` geometry; it does not mislabel proxies as native `IfcWall`, `IfcSlab`, or family geometry.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Materials |
| --- | --- | --- | --- |
| 2023 | standard `ArcWall` centerline record | default-width/default-height wall proxy | definitions when surfaced by the standards reader; assignments pending |
| 2024–2026 | version-specific wall record not yet proven | diagnostic fallback unless the standards reader produces elements | definitions supported by the standards reader |
| 2027 | supplied-project duplicated bounds + native element ID | axis-aligned envelope proxy | disabled in the current standards reader because 2027 is outside its verified range |
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
2. detects duplicated-bounds records and inventories leading-u32 evidence in every decompressible `Partitions/*` chunk;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join remains diagnostic evidence. A duplicated-bounds record is stronger: on the supplied pair, 119 joined records match all six Autodesk-derived bounds coordinates within `0.0001 ft`, and 125 match within `0.01 ft`. That validates the record as an element envelope, but not as a native shape or object class.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- duplicated-bounds recovery: 861 native-ID records, of which 804 have non-zero 3D volume
- RVT-only default scene: 803 axis-aligned element envelopes; one dominant container-like envelope is retained in audit/IFC output but hidden from the scene
- paired index evidence: 8,902 `ElemTable` IDs plus 2,943 partition-leading IDs
- Autodesk derivative cross-check: 59,582 stable Revit IDs and 51,420 fragments in the signed-in reference capture
- generated IFC validation: IFC4 opens in `web-ifc` with 804 products, 804 placed geometries, 27,336 vertices, and 9,648 triangles
- strongest class joins: 1,602 walls, 1,436 members, 466 plates, 355 curtain walls, 182 openings, 54 columns, and 28 doors
- reference gates: failed extents (`2.89× / 1.77× / 1.26×`), triangle density (`0.11×`), and typed semantics (`0%`), so the coordinate mesh is automatically rejected

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
```

The original model remains in `work/` and is not copied into `public/` or the deployment output.

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
