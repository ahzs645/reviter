# BmJsonExportEx static analysis

This note records a clean-room interface analysis of the isolated
`BmJsonExportEx` binaries. It does not reproduce ODA source code, bypass the
trial activation library, or make the native runtime redistributable.

The reproducible binary inventory covers every one of the 47 top-level files
in the isolated runtime (46 ELF objects plus `.DS_Store`). A fresh inventory on
28 July 2026 matched every committed name, byte count, and SHA-256 hash. The
[recursive ledger](generated/isolated-tree-inventory.md) separately accounts
for all 823 regular-file and symbolic-link entries, including the parser
prototype, decoded samples, and vendored dependencies.

## What the files are

The `.tx` extension is not a separate data format. Every `.tx` in the isolated
folder is an unstripped, x86-64 Linux ELF shared object. The executable and
`.so` libraries are ELF binaries as well. They cannot be imported by a browser
or converted directly into WebAssembly.

The relevant modules separate into four layers:

| Layer | Native modules | Responsibility |
| --- | --- | --- |
| File loading | `TB_Loader.tx`, `liboless.so`, `libTD_Zlib.so` | Open OLE storage and build the RVT object database |
| Object model | `TB_Database.tx`, `TB_Main.tx`, discipline modules | Elements, parameters, types, families, views, and references |
| Geometry | `TB_Geometry.tx`, `TB_GeometryUtils.tx`, `TB_ModelerGeometry.tx`, BRep libraries | Geometry graphs, BReps, surfaces, meshes, and tessellation |
| Example export | `TB_JsonExport.tx` | Walk an already-loaded database and write semantic JSON |

`libOdTrial.so` supplies the licensed trial activation path. It is not part of
the file-format or geometry algorithm.

## Recovered command flow

The launcher is not stripped. Its symbol table and disassembly establish this
flow:

1. Activate and initialise the ODA runtime.
2. Load `TB_Loader`.
3. Call `OdBmLoaderHostAppServices::readFile` for the input `.rvt` or `.rfa`.
4. Load `TB_JsonExport`.
5. Execute the registered `JsonExport` command.
6. Pass `-1` for a full model-tree export or a numeric `OdDbHandle` for an
   element/property export.

The command-line contract is:

```text
BmJsonExportEx <input file> [<output file>] [<element handle>]
```

The command itself prompts for a JSON output filename and an element ID whose
default is `-1`.

## JSON contract

`TB_JsonExport.tx` uses RapidJSON's `PrettyWriter`. The literal keys and writer
call order recover two envelopes.

The hierarchy route is structurally:

```json
{
  "data": {
    "type": "objects",
    "objects": [
      {
        "objectId": "",
        "name": "Model",
        "objects": []
      }
    ]
  }
}
```

The property route is structurally:

```json
{
  "data": {
    "type": "properties",
    "collection": []
  }
}
```

Element records written into those arrays use these fields:

- `object`: the element handle
- `name`: a display name assembled from category, family, type, or class data
- `externalId`: `OdBmElement::getUniqueId()`
- `properties`: parameter groups, each represented as a JSON object whose
  caption/value pairs are strings

Hierarchy-only grouping nodes use `objectId`, `name`, and nested `objects`.
Parameters come from both built-in and user parameter iterators and are grouped
using the parameter definition's group label. Values are formatted through the
ODA label utilities, including Yes/No formatting and unit-aware display.

This is a semantic export contract, not a mesh or BRep format.

## Evidence that the example does not export geometry

The undefined-symbol list for `TB_JsonExport.tx` contains these element calls:

- `objectId`
- `getClassDef`
- `getElementName`
- `getFamilyName`
- `getHeaderCategoryId`
- `getTypeID`
- `getTypeName`
- `getUniqueId`
- `getParam`

It contains no call to `OdBmElement::getGeometry`, `OdBmGeometry::brep`,
`OdBmGeometry::getFaceMesh`, or another mesh/tessellation function. The
geometry libraries are transitive runtime dependencies of the loaded BIM
database, not evidence that the JSON command serialises geometry.

## Geometry API boundary found in the other modules

The unstripped geometry/database symbols expose the native pipeline that a
licensed native exporter would use:

```text
OdBmLoaderHostAppServices::readFile(...)
  -> OdBmDatabase
  -> OdBmElement::getGeometry(options, object)
  -> OdBmGeometry::brep(...)
     or OdBmGeometry::getFaceMesh(...)
  -> vertices, faces, normals, materials, transforms
```

Other relevant exported methods include:

- `OdBmElement::getGeomExtents`
- `OdBmElement::getMaterialIds`
- `OdBmElement::getDrawableSubElementsIds`
- `OdBmGeometry::getBoundingBox`
- `OdBmGeometry::getEdges`
- `OdBmGeometry::getFaceMesh`
- `OdBmGBrep::getFaces`
- `OdBmGPolyMesh::getFacetedTopology`
- `OdBmModelerGeometryPE::setTriangulationParams`

These symbols reveal the abstraction boundary, but not a browser-portable
implementation. The RVT object reader, runtime type system, regeneration
rules, family instance resolution, BRep kernel, and tessellator remain native
ODA components.

## What can be brought into Reviter

The portable ideas are:

1. Treat loading, semantic extraction, and geometry extraction as separate
   stages.
2. Use a stable element handle as the join key between geometry and properties.
3. Offer both whole-model and selected-element semantic exports.
4. Group built-in and user parameters by a display group.
5. Carry explicit geometry provenance and missing-field declarations.

Reviter now implements a clean TypeScript version of that boundary:

- `convertRvtBytes` accepts local bytes and builds a `ConvertResult`.
- `elementManifest` emits one evidence-ranked semantic record per recovered
  element.
- `makeReport` writes IDs, categories, type links, recovered parameters,
  geometry provenance, bounds, and decoder coverage.
- GLB, OBJ, DXF, SVG, IFC proxy, and JSON generation stay client-side.

The ODA contract also guided four persisted browser decoders that are no
longer hypothetical:

- native Revit `UniqueId` for all 74,437 `Global/ElemTable` records;
- 50,205 exact `OwningElementId` model-tree edges;
- three referenced loadable-family definitions naming 143 placed instances;
- 54 native material definitions and 5,413 geometry-level assignments.

Those are partial semantic populations except for identity. Reviter reports
their evidence and coverage explicitly; it does not promote them to complete
family regeneration, spatial containment, or per-face material assignment.

## What is still missing for a general browser RVT converter

| Capability | Example runtime | Reviter status |
| --- | --- | --- |
| OLE/container and compressed streams | ODA loader | Implemented client-side |
| Release and document metadata | ODA database | Implemented client-side |
| Complete typed RVT object database | ODA database/runtime schema | Partial, release-specific |
| Full element hierarchy and `UniqueId` | ODA model tree/element API | UniqueId complete; persisted owning-element tree partial |
| All built-in and user parameter storage types | ODA parameter system | Partial numeric instance tables |
| Native family instance geometry | ODA regeneration and geometry graph | Partial placed/shared shapes; 3 family names, no full regeneration |
| General BRep evaluation | ODA BRep/modeler kernel | Not implemented |
| General tessellation | ODA modeler geometry | Browser planar/convex and analytic paths; no proven general stored-mesh replay |
| Exact material assignment | ODA element/face material APIs | 54 definitions and 5,413 geometry assignments; no per-face map |

There are therefore two viable routes:

- Continue Reviter's clean, release-specific TypeScript decoders and expand the
  holdout corpus one record family at a time.
- Obtain a browser/WebAssembly-supported ODA SDK and license, then implement a
  thin adapter around the native API boundary above. The supplied Linux
  binaries alone are insufficient for that route.
