# Autodesk example improvements — 11 September 2026

Follow-up: [Pascal export verification and additional native recovery](pascal-export-verification-2026-09-11.md) recovers two more reference IDs in each sample. It supersedes the missing-element counts below; the earlier surface measurements remain a dated baseline.

Implemented and measured against the supplied Technical School, RAC Basic Sample Project, Snowdon walls view, and UNBC Fixed Library files. These are local converter changes; nothing has been published or committed.

## What changed

1. **Reports measure actual triangles.** The manifest now separates `persistedBoundsFeet` from `drawnBoundsFeet`, retains the legacy `boundsFeet` envelope, and records the emitted mesh sources and final geometry route. `recordSource` identifies the older inferred route. The comparison reads indexed triangle positions on the Autodesk side too, follows the active scene, and excludes unused vertices and non-triangle objects. Old audit files require regeneration; `--bounds persisted` is an explicit diagnostic mode.
2. **Ownership survives partition boundaries.** A bounded reader reassembles sequences 102 and 103 with element IDs, length echoes, block counts, and continuation checks. A failed inflate or malformed block cannot donate a partial object to its neighbour. Large verified drawable records reach the existing native decoder without increasing the broad byte scanner's 64 KB limit.
3. **Terrain gets native facets.** Complete, directly owned `GPolyMesh → FacetedTopology0` records produce native faceted geometry for Topography. The decoder requires a complete FIFO replay, matching ownership, measured flags, valid arrays, and vertices contained by the owning root. Nested or unmeasured forms remain unsupported. This recovers three Technical School terrain owners and four RAC owners, including terrain larger than one page.
4. **The eleven tall RAC footings are fixed.** The reader consumes `GComponentRef → InstanceInfo` as a related-component reference, allowing the embedded footing mesh to complete without adding the column below it. All eleven approximately 20.7-foot proxies become approximately one-foot native footings. The unrelated foundation `766598` still has a plan-size mismatch.
5. **Real family instances survive cached-symbol cleanup.** Sequence-102 `FamilyInstance` identity distinguishes a physical model instance from a reusable family symbol. A drawing helper referencing a real instance no longer causes that instance to be deleted. This recovers Technical School's 38 missing generic models and 27 parking elements, plus RAC's 12 electrical-equipment elements and six furniture elements.
6. **Large solar-panel symbols decode.** The 532 KB symbol `776839` spans five pages and now produces native geometry. All twelve panels pass the size check, but their positions remain wrong. This is partial recovery, not validated placement.
7. **Wall-light diagnosis advances.** The measured `GImposter → GenericPhotometricLight` metadata and its typed scalar properties now replay completely. The Sconce 4 symbol still fails on two curved faces with non-rectangular trims. It retains its existing proxy; the seven oversized lights are not fixed.
8. **View visibility is explicit.** Categories has a reversible **Building view** preset that hides Mass and Mass Floor, and **All categories** restores visibility. The converter's recovered geometry and export population are unaffected by this viewing choice.
9. **Fine local checks are repeatable.** `compare-element-surfaces.ts` isolates selected IDs, compacts their indexed geometry, and compares each at a configurable cell size. It requires whole-scene registration, so fitting each object cannot conceal a placement error. Missing geometry produces a status rather than a vacuous success.

## Measurements

The table compares the old saved drawn-bound audits with new conversions using the corrected reference-triangle reader. The population includes active reference elements containing triangles. Six mapped, non-surface IDs in each sample are reported separately. Consequently, these denominators and some percentages supersede the earlier review.

| Measure | Technical School before → after | RAC before → after |
| --- | --- | --- |
| Reference surface elements | 5,473 | 444 |
| Matched drawn elements | 5,404 → 5,470 | 414 → 434 |
| Missing reference surface elements | 69 → 3 | 30 → 10 |
| Matched elements passing size check | 5,370 → 5,435 | 364 → 393 |
| Size passes on the unchanged matched population | 5,370 / 5,404 → 5,370 / 5,404 | 364 / 414 → 375 / 414 |
| Whole-scene reference surface coverage | 46.6% → 90.4% | 55.9% → 80.8% |
| Whole-scene recovered surface coverage | 80.5% → 82.2% | 28.9% → 60.8% |

Bounds tolerance is 0.5 ft on every axis. Whole-scene surface checks use 0.5 m cells and approximately 0.87 m neighbour tolerance. Neither metric establishes full geometric fidelity. Both directional surface scores matter: recovering the reference while adding excess geometry is not an exact result.

All 27 parking elements now pass both position and size checks. Their earlier apparent 8.8-foot errors came from reference accessor envelopes; the drawn parking stripe is much narrower. Forty of 42 Technical School generic models pass size checks; two potted plants remain incorrect. All 100 Technical School doors pass the drawn-size check. The highlighted window shades retain their correct dimensions.

The newly recovered RAC panels pass size but all twelve fail position. Thirty of thirty furniture elements are now present; 28 pass size. RAC has 40 of 46 reference walls drawn, with 28 of the 40 passing size; 35 have final native BRep provenance. Native provenance does not guarantee agreement with this particular reference view.

### Fixed-registration checks at 0.1 m

Approximate neighbour tolerance is 0.173 m. These checks isolate each element; nearby geometry cannot fill its missing cells.

| Element | Recovered-only cells | Reference-only cells | Interpretation |
| --- | ---: | ---: | --- |
| RAC footing `512297` | 0 | 0 | Corrected footing agrees at this sampling resolution |
| Technical School parking `130846` | 0 | 0 | Recovered stripe agrees |
| Technical School shade `247523` | 0 | 0 | No size correction was needed |
| Technical School light `245151` | 152 | 0 | Tall proxy contains substantial excess surface |
| RAC foundation `766598` | 3,681 | 0 | Remaining plan overrun |
| RAC wall `599841` | 1,712 | 0 | Remaining excess wall surface |
| RAC solar panel `800280` | 287 | 150 | Shape/placement disagreement remains |

Zero unmatched cells at this resolution does not prove exact surfaces or preservation of every thin feature.

### Controls

- **UNBC:** 21 of 21 paired IFC checks pass. A fresh comparison of old and new outputs with the same corrected registration gives 237 missing-reference cells in both, and recovered-only cells decrease from 62 to 38. The earlier saved 223 missing cells used a different registration and are not an equivalent baseline. Current directional coverages are 99.996% recovered and 99.977% reference.
- **Snowdon:** all 1,310 reference surface elements are present; 1,246 pass the size check and all pass position. Reference surface coverage is 99.66%. The 8,515 recovered IDs outside its walls-only reference view are reported separately, not automatically classified as geometry errors.
- **Browser check:** imported RAC in Chrome, confirmed Building view hides Mass and All categories restores it. The scene renders with the recovered terrain and native symbols.
- **Automated checks:** 1,050 unit tests pass, one existing test is skipped; four rendered-page tests pass; TypeScript and production build pass. Source lint has zero errors and five existing warnings when ignored work artifacts are excluded. The unrestricted lint command also encounters five pre-existing CommonJS-import errors in `work/autodesk-tools/convert-local.cjs`.

## Remaining work, in actionable order

1. **Solar placement and conditional geometry:** start with RAC instance `800280` and symbol `776839`. Native dimensions agree within 0.018 ft, but the centre error is approximately 1.94 ft. Preserve the independently measured instance transform while investigating the symbol's selected representation; do not move it using Autodesk coordinates.
2. **Sconce curved trims:** Technical School symbol `245838`, instances `245151`, `245907`, `245958`, `246011`, `246012`, `246033`, `246129`. Asset replay is complete; face tokens 47 and 48 fail the existing sampled-planar and arc/surface-of-revolution readers. Add a bounded native trim implementation, not a forced one-foot envelope or partial face set.
3. **Terrain boundaries and planting:** the native terrain improves the broad surface dramatically, but Technical School owners `105545` and `111931`, and RAC `411452` and `490318`, still have significant boundary differences. RAC's five plants all fail size; six of Technical School's 30 planting elements fail size. Those remain proxy/placed-shape representations.
4. **Missing surface owners:** Technical School roof `140056` and slab edges `217842`, `217846`. RAC walls `234869`, `418079`, `427092`, `428588`, `497540`, `655533`; ceiling `697612`; stair-container IDs `513254`, `665557`, `725045`. Stair-container identity may differ from the rendered run/landing ownership; count this as a missing reference identity until checked, not proof the whole stair is absent.
5. **Confirmed shape mismatches:** foundation `766598`, twelve matched RAC walls, five RAC doors, remaining plumbing/site fixtures and furniture. Use the local comparison script and final provenance to choose the decoder responsible for each case.

## Reproducing the checks

```sh
python3 scripts/compare-glb-elements.py audit.json capture-dir --json comparison.json
python3 scripts/register-glb-by-elements.py audit.json capture-dir --out registration.json
node --experimental-strip-types scripts/glb-surface-diff.ts recovered.glb capture-dir/model.glb --registration registration.json --json surface.json
node --experimental-strip-types scripts/compare-element-surfaces.ts model.rvt capture-dir --ids 512297,800280 --cell 0.1 --registration registration.json --json local.json
node --experimental-strip-types scripts/probe-owned-records.ts model.rvt --comparison comparison.json --out-dir records --json ownership.json
```

Registration uses the known feet-to-metres scale, 0.3048, and a median translation from matched drawn bounds. It fails when there are no matches and reports size-ratio/offset diagnostics. It cannot fit arbitrary rotation or detect a systematic transform error shared by most matches.

Machine-readable comparisons, conversions, fine checks, and logs are in `work/example-improvements/`. Input hashes are embedded in element comparison reports. The supplied RVT and Autodesk reference files are unchanged.
