# Pascal review export

The export menu now offers **Pascal review** for large models, **Pascal per element** for separately editable drawn element parts, and **Pascal editable** for simplified semantic building nodes. Review mode is implemented in the exporter and works for any recovered model; it no longer needs the UNBC-specific postprocessing script.

## Measured results

These files were generated from the saved UNBC, RAC Basic and Technical School conversion results used in the previous comparison. File sizes are MiB (1,048,576 bytes).

| Model | Original mesh blocks | Review mesh blocks | Original JSON | Review JSON | Reduction in file size |
| --- | ---: | ---: | ---: | ---: | ---: |
| UNBC | 43,275 | 621 | 323.4 MiB | 280.9 MiB | 13.1% |
| RAC Basic | 770 | 75 | 19.8 MiB | 17.1 MiB | 13.7% |
| Technical School | 5,782 | 109 | 47.0 MiB | 40.6 MiB | 13.8% |

UNBC retains 936,185 source triangle faces and references to 36,339 represented Revit elements. Its object count falls by 98.6%. The new file is also about 12.4% smaller than the earlier 320.6 MiB grouped UNBC experiment.

UNBC was imported into the supplied patched Pascal editor at `http://localhost:3002/` through Load Build. The import dialog accepted 634 nodes (one building, twelve levels and 621 meshes). The model rendered, automatically framed after replacement, and responded to Orbit Right in the in-app Browser. The browser reported no errors, only the existing Three.js Clock deprecation warning. This checks 3D Solid mode; identical lighting, materials and 2D performance are not asserted.

## What changes

Review mode batches parts by level and source mesh/material, up to 2,048 source triangles per block. Original level assignment is preserved, including associated Revit levels and the elevation fallback. It keeps independent vertex identities across Revit owners, shares repeated source indices within an owner, and preserves source triangle IDs and winding.

The JSON uses shorter local vertex/edge IDs, omits the per-face `body` material slot that Pascal's schema supplies by default, and stores compact source-triangle ownership ranges. Element category/type/family/provenance metadata is stored once on the building instead of repeated per mesh part. No coordinate rounding, triangle decimation or position-based vertex welding is applied. Required topology edges and scene materials remain present.

Review meshes are editing units. Pascal does not currently expose each original element inside a group as an independent editable node. Choose **Pascal per element** when that distinction matters. The original 43,275-block UNBC file still has the browser performance limitation documented in the preceding review.

The file remains large enough that browser-local autosave cannot be assumed to preserve it. Keep the exported file. Grouping improves object overhead; it does not eliminate JSON parsing, validation or expanded-memory costs.

## API and command line

The existing API and CLI defaults are unchanged. Review grouping is explicit and only valid with drawn geometry.

```ts
makePascalSceneJson(result, {
  geometry: "drawn",
  drawnGrouping: "review",
});
```

```sh
npm run extract -- model.rvt --out model.review.pascal.json --pascal-geometry drawn --pascal-grouping review
```

Use `--pascal-grouping element` or omit that flag for the original element-part layout. The CLI still uses semantic geometry unless `--pascal-geometry drawn` is supplied.

## Ownership metadata

Each review block carries:

- `sourceGlbMesh` and `sourceMesh`: the original mesh identity used by the native audit.
- Face IDs `fN`: original source triangle index N within that mesh.
- `revitElementIds`: the represented, known element IDs in this block.
- `sourceTriangleRanges`: tuples `[firstSourceTriangle, triangleCount, revitElementId]`; a null owner means unknown. They address persistent `fN` IDs, not positions in the editable face array, so reordering faces does not misassign ownership. Newly authored faces have no original source identity.

The building's `metadata.revitElements` maps known element IDs to the available recovered metadata. Source ownership is retained even when no element metadata record was recovered. These are import provenance fields, not a live semantic-editing integration.

## Validation

- 28 export/CLI tests passed, covering batching limits, triangle/owner coverage, level placement, mirroring, material references, edge completeness, stable ownership after face reordering, invalid input and default per-element behavior.
- Type checking, targeted lint and the production build passed. The TypeScript configuration now excludes `work/`, which contains diagnostic scripts and copies of the external Pascal editor, while continuing to check product source, scripts and tests.
- All three files passed Pascal's actual schema validator and scene loader, without lost nodes or roots.
- Native geometry audits passed for RAC and Technical School. All rendered triangles match the source GLB positions and winding.
- UNBC renders 928,192 matching triangles and retains the same 33 above-tolerance omissions as before. Their maximum altitude is 0.01858 mm. Its strict native audit still reports failure; this change does not repair that renderer limitation. Another 497 nondegenerate omitted triangles are below the 0.01 mm tolerance, and 7,463 source triangles are degenerate. Maximum rendered vertex error is 0.00841 mm.

Artifacts, model files, metrics and full native audit reports are under `work/pascal-export-optimization/`. The export generator in that directory reproduces the files from the saved conversion caches, without reconverting the RVTs.

These results use the supplied Pascal source with the previous import/rendering optimizations. JSON schema compatibility alone does not establish acceptable performance in every upstream Pascal release.
