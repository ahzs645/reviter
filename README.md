# Reviter

Reviter is a browser-only Revit inspection and experimental geometry conversion library. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file is opened from the browser file picker, parsed in the tab, and converted in a dedicated Web Worker. The application has no file upload route, account system, telemetry, or remote conversion service.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- truncated-gzip partition decompression
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC proxy centerlines, and JSON audit data

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter scans decompressed partition data for plausible 3D line records, removes duplicates and spatial outliers, and extrudes the retained centerlines into overview solids. These are useful for orientation and forensic work, but they are not decoded walls, floors, doors, families, materials, parameters, constraints, or a faithful BIM handoff.

The included IFC exporter deliberately writes `IfcBuildingElementProxy` centerlines with an experimental description. It does not label inferred lines as native `IfcWall` elements.

## Supplied-project synthesis

| Supplied project | What Reviter uses |
| --- | --- |
| `rvt-app-main` | The MIT-licensed [`@phi-ag/rvt`](https://github.com/phi-ag/rvt) streaming metadata and thumbnail reader |
| `rvt-ts-viewer` | The partition-coordinate recovery approach, reworked into the reusable `lib/reviter` core and a transferable Web Worker pipeline |
| `rvt-rs-main` | The clean-room format status, support boundary, diagnostic model, and optional WebAssembly reader integration |
| `rvt2ifc-fe-master` | The openBIM viewer/export direction; current Reviter exports can be handed to IFC viewers |
| `rvt-convert-main` | Export-format and configuration ideas only; its Autodesk/Azure upload flow is intentionally excluded because it conflicts with client-only processing |

The implementation also uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, and [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export. For downstream IFC parsing, [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) is a browser-native option, but it reads IFC—not RVT.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- standards-aware element result: zero validated building elements, nine diagnostic candidates, scaffold-only native IFC readiness
- Reviter recovery: roughly nine thousand focused coordinate candidates and about 108 thousand display triangles in approximately four seconds on the development machine

Exact recovery counts can move as the filtering algorithm improves. They must not be treated as Revit element counts.

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
const result = convertRvtBytes(bytes, file.name, { maxSegments: 12_000 });

if (result.ok) {
  const obj = makeObj(result);
  const dxf = makeDxf(result);
  const svg = makePlanSvg(result);
  const ifc = makeIfcCenterlines(result);
  const audit = makeReport(result, null);
}
```

For production UI work, use `lib/reviter/worker.ts` as the entry point so large files do not block the main thread.

## Development

```bash
npm install
npm run dev
npm test
```

The original model remains in `work/` and is not copied into `public/` or the deployment output.

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
