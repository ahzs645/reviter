# Native semantic integration from rvt-rs

This work starts from `claude/unbc-candidate4-rules` at
`4c13fd03e1ef994311f55e2312ef2590b898fb53` and selectively adapts Helen Kwok's
`rvt-rs` fork at `1c3d337dbd2a6810e9dfad68fe99857843d67387`. Reviter's geometry
recovery and indoor review/routing decisions are preserved. Original Drive RVT,
IFC, GLB and SVF files were read locally; none is included in this change.

## Delivered behavior

| Area | Integration | Boundary |
| --- | --- | --- |
| IFC GlobalIds | Native occurrence ids reconstructed from creation episode and original handle; deterministic fallback remains | Native ids need not equal every split/synthesized product in another export |
| IFC settings | Owned instance settings override inherited type settings; admitted classes and enums shape output and type grouping | Unknown settings are reported; semantic aggregate wrappers retain their stair class and disclose unsupported class changes |
| Properties and phases | Standard common-property mappings plus explicit created/demolished fields joined to native phase names | No inferred exterior/structural flags, phase order, active-view phase or phase-based geometry filtering |
| Native rooms | Source identities/names/numbers/levels and validated stored planar outlines; source spaces/footprints export separately from reviewed rooms | No guessed height/volume, cylindrical boundary approximation, access or navigation certification |
| MEP | Typed IFC categories; opt-in system candidates, measured connector layouts and relationship emission | Object-id membership remains a candidate; family connector graphs and nonempty real-file connection parity are unresolved |
| Design options | Proven primary sets and explicit all/primary IFC selection, with selection provenance | All alternatives remain by default; unknown/conflicting alternatives stay included; 2027 set decoding is unsupported |
| Capability/testing | Executable evidence-gated capability manifest, JSON schema, 864 bounded seeded parser mutations, pinned WASM staging workflow | Eligibility is not a completeness claim; existing WASM binary was not replaced |

Native source rooms and reviewed room candidates have distinct provenance and
identity namespaces. No geometric proximity match silently merges them. Source
room ids are reserved for `IfcSpace`, avoiding a second proxy/product with the
same GlobalId. Stored outlines export as plan curves, never invented volumes.
Missing storey joins retain building-level aggregation. Stale or unsupported
outline evidence produces metadata-only spaces.

The additional MEP container adapter is separate from semantic data modules so
the deterministic indoor compiler's dependency graph does not pull in the
renderer's platform-dependent colour transfer function.

## Usage

```sh
npm run extract -- model.rvt --out model.ifc
npm run extract -- model.rvt --out primary.ifc --design-options primary
npm run extract -- model.rvt --out candidates.json --experimental-mep
npm run extract -- model.rvt --out experimental.ifc --experimental-mep
```

The first two keep experimental MEP collection and emission off. JSON reports
now include `nativeRooms`, `nativeRoomCoverage`, `nativePhases`, `designOptions`,
`nativeIfcExportParameters` and optional `nativeMep` evidence. No missing
evidence is filled from the reference exports.

Library consumers use `convertRvtBytes(bytes, name, { experimentalMep: true })`
when they explicitly want additional MEP scans, then
`makeIfc(result, { includeExperimentalMep: true })` to export those candidates.
`makeIfc(result, { designOptionSelection: "primary" })` selects proven primary
options only in that IFC. `includeNativeRooms: false` omits the new native
source spaces. The scene, original file and reviewed annotations remain intact.

## Measurements on the supplied corpus

The [aggregate evidence](generated/rvt-semantics-validation.json) records input
hashes, geometry fingerprints and independent-reader results.

| Model | Release | Drawn element ids | Triangles | Native rooms / stored outlines | Named phases / created / demolished |
| --- | --- | ---: | ---: | ---: | ---: |
| RAC | 2025 | 461 | 195,555 | 14 / 13 | 3 / 515 / 0 |
| Technical School | 2025 | 5,507 | 393,145 | 91 / 42 | 2 / 6,119 / 0 |
| Snowdon | 2024 | 8,931 | 1,596,168 | 54 / 45 | 3 / 7,177 / 6 |
| UNBC | 2027 | 36,415 | 901,903 | 0 / unsupported | 2 / 41,337 / 0 |

For all four models the complete generated GLB is byte-identical to the export
from the requested base branch. Geometry fingerprints also preserve vertices,
indices, per-triangle element ownership and origin. This proves preservation of
that baseline output, not complete agreement with Revit or every possible model.

All four generated IFCs reopen with the independent IFC-lite reader and pass the
existing recovery-evidence IDS. These checks concern IFC readability and
provenance, not a converter completeness claim.

Independent Autodesk SVF joins match all 159 native room names/numbers on the
three older models. The 100 emitted planar outlines agree with reference room
areas within 0.1% (observed differences are floating-point precision). Curved
room faces are rejected: the initial planar-only attempt could close the outer
ring while silently losing a column/shaft hole. Remaining outlines stay
unresolved. The supplied UNBC source has no admitted native room headers; its
reviewed indoor records are a separate input, and 2027 stored room solids remain
unsupported.

Phase-property comparisons match 13,440 Autodesk values with zero mismatches,
including six demolition fields on Snowdon. UNBC's supplied IFC has no Phasing
sets, so its lifecycle fields have native schema/identity checks without that
independent property witness.

UNBC's paired IFC matches reconstructed GlobalIds for 38,061 of 38,187 distinct
tagged native elements. Product-level discrepancies mostly concern synthesized
openings and repeated tags. These are not counted as blanket exact parity.
Snowdon also stores the same cached IfcGUID on two different native elements;
those cached strings are deliberately not used as occurrence identity.

None of these four RVTs yields an admitted owned IFC export override. Override
precedence, class/enum rejection and independent-reader serialization therefore
have fixture-based validation, rather than a real-model override parity claim.

Snowdon resolves both expected option sets and their primaries. Its Autodesk
reference covers a coordination walls view, not every project product, so that
capture cannot prove whole-project IFC omission parity. RAC and School have no
admitted option sets; UNBC 2027 retains alternatives as unsupported evidence.
An actual `--design-options primary` CLI export removes 27 tagged occurrences
from Reviter's default Snowdon IFC (eight walls, nine slabs and ten proxies),
adds none, and records the selection policy in `Reviter_ExportSelection`.

RAC's recovered electrical system matches its independent SVF native identity
and unnamed circuit value. The supplied references do not verify nonempty MEP
membership or connector topology, which is why additional collection/emission
requires an explicit experimental opt-in. See [MEP evidence](native-mep-evidence.md).

## Checks and reproducibility

```sh
npm ci
npm run typecheck
npm run test:unit
npm run test:pages

node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-semantic-corpus.ts model.rvt --out work/after \
  --baseline work/before/model.json

node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-ifc-export-independent.ts --ifc work/after/model.ifc
```

The corpus audit reads the file's release instead of forcing the original UNBC
fixture's 2027 release. A source-hash or geometry-fingerprint disagreement exits
nonzero. Optional `--reference-glb` measures registered voxel surface agreement;
that registration is not absolute placement proof, and view-scoped captures
must not be treated as complete model references.

Final checks: 1,882 unit tests pass, two optional native audits skip, TypeScript
and lint over changed code pass, and the static Pages build/check passes. The
Vinext production build also completes. Full repository lint still reports the
same 113 errors and 75 warnings on the untouched base and integration branch.
`npm test` stops at the same pre-existing rendered-page assertion on both:
`tests/rendered-html.test.mjs` expects the obsolete phrase “restore the model,
floor reviews and GIS references together”. The unit suite was run separately;
these baseline failures were not hidden or relabelled as passing.

A Chromium smoke test of the built static app opens RAC through its real file
picker, reaches Ready with no page errors, and downloads an IFC containing 14
native spaces, 13 stored footprints and native phasing. The broader existing
`browser-check.mjs` reaches Ready on RAC but then stops at its derived-floor-region
assertion (zero regions); that review/navigation check is not represented as a
passing semantic smoke test or repaired by changing the original geometry.

The shipped `lib/rvt-wasm` artifacts retain their original hashes. Rust and
wasm-bindgen were unavailable for a candidate compile, so the staging pin/build
workflow is supplied without promoting an untested replacement binary. See
[capability contracts](rvt-capability-contracts.md),
[native IFC semantics](rvt-ifc-native-semantics.md),
[native phases](native-phases.md), and [native rooms](native-room-recovery.md).
Apache-2.0 license and upstream copyright/NOTICE attribution are retained.
