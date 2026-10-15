# Additional pristine upstream geometry-mode comparison

This supplements the main scaffold-mode comparison with four fresh isolated calls to the **untouched** `rvt-rs` WASM bundle pinned at `1c3d337dbd2a6810e9dfad68fe99857843d67387`. It does not reconvert Reviter or change either converter. [Generated evidence](generated/rvt-upstream-geometry-mode-validation.json) records exact source and output SHA256 values, all four verified binary hashes/provenance, walker settings, timings, warnings, independent reader checks and mode-contract findings.

| Input / release | WASM API result | IFC products / represented | Reported bounding-box bodies | Independent geometry contract check |
| --- | --- | --- | --- | --- |
| RAC / 2025 | Converted | 550 / 478 | 354 | Passed |
| School / 2025 | Converted | 5,743 / 5,679 | 5,128 | Passed |
| Snowdon / 2024 | Converted | 6,854 / 6,253 | 3,295 | Passed |
| UNBC / 2027 | Converted sparse IFC | 0 / 0 | 0 | Failed: no typed elements or geometry |

The bounding-box column is the exact native `ExportDiagnostics.exported.bounding_box_bodies` counter. It is not a heuristic based on a reopened mesh having eight vertices or twelve triangles. The report separately retains native `body_sources`, warnings and unsupported-feature diagnostics; legitimate box-shaped elements must not automatically be classified as proxies.

The observed geometry-mode product and represented-product counts equal the previous scaffold-mode counts on these four inputs. This does not make the modes interchangeable for other files, or establish that the outputs have identical geometry/semantics. Geometry-mode IFC bytes have their own recorded hashes.

## Content policy and quality validation are separate

The upstream source's [`ExportQualityMode::Geometry`](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/ifc/mod.rs#L655) validation requires typed elements and **some** exported geometry. It does not require complete geometry, native bodies for every element, or reference-surface agreement. The [geometry content policy](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/ifc/export_content.rs#L84) includes geometry and requires category mapping.

The [content exporter](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/ifc/mod.rs#L845) explicitly leaves quality validation to callers. The [native CLI](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/bin/rvt_ifc.rs#L170) and [Python binding](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/rvt-py/src/lib.rs#L92) invoke validation. The pinned [WASM binding](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/rvt-wasm/src/lib.rs#L156) parses the requested quality mode and returns content/diagnostics **without** invoking that validator.

Consequently UNBC is an observed WASM success with sparse content and a failed independent check of the source-defined geometry contract. It must not be reported as an upstream API refusal, an automatic downgrade by this harness, or evidence that every upstream path can export 2027 geometry. Its diagnostics explicitly say no building elements were exported and output is scaffold-only. `diagnostics.mode="default"` names the document-export diagnostic strategy; it does not replace the submitted `geometry` content-policy selector.

## Independent reopens

All four IFCs reopened in both web-ifc and IFC-Lite. Web-ifc entity populations matched the original lexical inventories and produced finite, nonempty mesh products for 438 / 5,481 / 5,934 / 0 products respectively, totaling 6,296 / 70,822 / 117,464 / 0 triangles. The difference from represented-product counts reflects what that reader streams, not an automatically missing or accurate shape. No invalid vertex/index/placement arrays were observed. IFC-Lite independently recovered IFC4 catalogs for all four files.

These checks establish readable entity catalogs and finite tessellation. They do not validate IFC templates, native authorship, reconstruction accuracy, common-frame placement or surface agreement with Autodesk exports. The raw RVTs and generated IFCs remain outside Git.

## Reproduce the upstream-only worker

Use an existing comparison settings file, set `upstreamMode` to `geometry` and `upstreamWasmJs` to the separately retained pristine bundle, then call the isolated worker for each source file:

```sh
node --experimental-strip-types --max-old-space-size=6144 \
  --import ./scripts/register-test-typescript.mjs scripts/compare-rvt-readers.ts \
  --worker upstream /path/model.rvt /path/upstream-geometry.ifc \
  /path/upstream-geometry.json /path/geometry-settings.json
```

Run one model at a time with a 900-second process deadline. The source campaign used the same declared walker limits as the scaffold comparison: 128 MiB scan, 100,000 candidates, 16,000,000 trial offsets, 1 MiB record decode and 1,000 container records. These limits constrain particular scans and are not global model-memory or accuracy guarantees.
