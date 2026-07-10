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

The implementation also uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

## Paired regression workflow

After opening an RVT, choose its matching IFC export in the **Regression fixture** panel. Both files remain local. Reviter then:

1. parses native IDs from `Global/ElemTable`;
2. inventories the leading-u32 record evidence in every decompressible `Partitions/*` chunk;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join is recorded as diagnostic evidence, not yet treated as a decoded Revit object. On the supplied UNBC pair it strongly correlates with IFC walls, curtain walls, openings, and columns, which makes walls the first practical class for partition-body reverse engineering.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- standards-aware element result: zero validated building elements, nine diagnostic candidates, scaffold-only native IFC readiness
- Reviter recovery: roughly nine thousand focused coordinate candidates and about 108 thousand display triangles in approximately twelve seconds while indexing every partition chunk on the development machine
- paired index evidence: 8,902 `ElemTable` IDs plus 2,943 partition-leading IDs
- IFC join: 4,332 of 41,293 tagged IFC elements matched an RVT record (10.5%)
- strongest class joins: 1,602 walls, 1,436 members, 466 plates, 355 curtain walls, 182 openings, 54 columns, and 28 doors
- reference gates: failed extents (`2.89× / 1.77× / 1.26×`), triangle density (`0.11×`), and typed semantics (`0%`), so the coordinate mesh is automatically rejected

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
