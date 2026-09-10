# Autodesk Viewer capture pipeline

Keep an Autodesk Viewer's published 3D model as a complete raw SVF bundle and a
portable GLB. Capture uses the existing signed-in browser session; conversion runs
locally. No Autodesk API keys are needed or saved. These tools are separate from
Reviter's native RVT decoder and are not bundled into the app.

## Capture and convert

1. Open the model's 3D view in Autodesk Viewer and wait for it to load completely.
2. Open that tab's DevTools Console and run [capture-viewer.js](capture-viewer.js).
   The optional `exportName` near the top controls the filename. The script saves
   `autodesk-model-svf.tar` with the SVF, geometry packs, materials, textures when
   present, property database, checksums, and a record of live geometry counts.
   Codex can also execute this script through the supported Chrome developer
   tools connection when asked to capture an open viewer.
3. Run the following from the repository root. Choose a new output folder for
   each capture; existing exports are never overwritten.

```sh
# Once per checkout; dependencies are pinned in tools/autodesk/package-lock.json.
npm run autodesk:setup

npm run autodesk:convert -- "$HOME/Downloads/autodesk-model-svf.tar" \
  --out work/autodesk/my-model
```

The converter also accepts a gzip-compressed capture TAR. It validates the archive
and inventory before extracting. Each asset is confined to the capture directory.
The command needs no network after setup.

To retain the original model origin, add `--keep-origin`. The default GLB is
centred, in metres, with Y pointing up. Unit and axis conversion still apply with
`--keep-origin`; exact transform matrices are recorded in `summary.json`.

## Files retained

```text
work/autodesk/my-model/
  source.tar             Original capture, byte for byte (.tar.gz when supplied)
  raw/
    model/view/model.svf  Main SVF archive
    model/view/*.pf       Geometry packs
    model/view/...        Materials, fragment lists, cameras, and other assets
    objects_*.json.gz     Property database
    capture.json          Viewer version, source units, live counts, asset hashes
  raw-manifest.json       SHA-256 for the original capture and each raw file
  gltf/                  Intermediate glTF and binary/image resources
  model.glb              Self-contained GLB, with textures embedded when present
  fragments.json         Fragment IDs, Autodesk dbIds, and output node mapping
  summary.json           Counts, transforms, hashes, versions, validation outcome
  validation.json        Full Khronos glTF Validator report
  conversion.log
```

**Keep the entire raw folder or original capture archive.** The small `.svf` file
references its neighbouring assets; it is not a standalone copy of the model.

The browser loader sometimes decompresses gzip resources. The capture script
restores those gzip wrappers before saving. The importer also supports our older
captures by restoring wrappers in `raw/`, while preserving the original TAR
unchanged. No geometry is changed in the raw files.

GLB conversion preserves every drawable fragment, triangles, lines, and points.
It performs no mesh simplification or position quantization. Source fragment IDs
and Autodesk dbIds are written into node `extras` as well as `fragments.json`.
Only used materials appear in the GLB; the complete source material definitions
remain in the raw bundle. Revit's parametric behavior and full BIM property
database are not encoded in GLB.

The pipeline compares source geometry totals with the GLB, and with live counts
when the capture includes them. Missing assets, count differences, validation
errors, or a truncated validation report cause a nonzero exit status. Diagnostics
and captured data remain available after failure. Warnings are recorded in the
validation report. Image loading fails explicitly when a manifest asset is
missing; it does not silently substitute a placeholder for an uncaptured image.

A streaming viewer can expose a separate SVF derivative with slightly different
tessellation. The capture script downloads that SVF and reads its own ZIP manifest
using native browser decompression. If the converter reports a difference from
the live streaming counts, inspect it before rerunning with
`--allow-streaming-differences`. This option records both sets of counts and their
deltas in `summary.json`; it applies only to streaming captures. The SVF-to-GLB
geometry checks remain strict in every mode.

## Support and verification

- Requires a published **SVF** 3D derivative and the viewer's `NOP_VIEWER` API.
  Both native SVF viewers and streaming viewers with a corresponding SVF
  derivative are supported. The script fails clearly on views without an SVF
  derivative or on 2D views. Autodesk's internal
  loader APIs can change, so future viewer versions may require an update.
- Captures the active model and selected published 3D view. It includes geometry
  outside the current camera frame. It does not add other views or linked models
  loaded as separate viewer models.
- Preserves the model's geometry and basic material conversion. Autodesk's
  lighting, shadows, feature-edge rendering, and full material shader behavior
  are viewer features and may look different in another GLB viewer.
- The archive importer accepts the regular-file USTAR layout generated here,
  rather than arbitrary TAR variants with links or special entry types.

```sh
npm run test:autodesk
```

Tests cover the browser-generated archive, gzip restoration, hashes, unsafe and
damaged archives, preserving raw files, GLB buffer alignment, images, transforms,
instancing, and Autodesk identity metadata.

Verified on September 10, 2026 against Autodesk Viewer 7.126.1 with the open
`Technicalschoolcurrentm.rvt` model: **6,542 fragments, 1,399,046 triangles, and
2,209 line segments** in both the live viewer and the GLB. All 23 geometry packs
were captured. Full Khronos validation reported zero errors, warnings,
informational messages, or hints. The sample model has no bitmap textures;
image packing is covered by a synthetic test.

Additional models verified the same day:

| Model / view | Fragments | SVF and GLB triangles | Live streaming triangles |
| --- | ---: | ---: | ---: |
| Snowdon Towers Sample Architectural / Coord - Arch Walls | 2,632 | 88,844 | 88,810 |
| racbasicsampleproject / {3D} | 738 | 414,160 | 414,160 |

Snowdon's 34-triangle cross-derivative difference is recorded explicitly. Its
SVF-to-GLB counts match exactly. The basic sample also retains 96 line segments.

Dependencies: [forge-convert-utils](https://www.npmjs.com/package/forge-convert-utils)
and [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator).
The converter wrapper supplies two deprecated Node `util` functions required by
forge-convert-utils 4.0.5 on newer Node releases.

Model files belong in ignored `work/` storage or another local output directory.
They are not committed or deployed with this tool.
