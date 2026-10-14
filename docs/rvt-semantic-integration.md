# rvt-rs semantic integration — 2026-10-14

This branch adds native IFC identities, conservative IFC semantics and
source-authored room/MEP/design-option evidence to Reviter while preserving its
geometry pipeline. It starts from `claude/unbc-candidate4-rules` at `4c13fd0` and
pins upstream to `helenkwok/rvt-rs@1c3d337`. Six agents implemented and reviewed
the seven areas; the integration was tested on real source files.

## Implemented behavior

| Area | Result | Limits |
| --- | --- | --- |
| Revit IFC GlobalIds | Products, exact levels, supported ordinary types and opted-in native room/system roots use validated creation identities | Explicit stored IfcGUID overrides, synthesized sub-elements and exporter-specific family/type variants still fall back |
| Export overrides | Instance/type precedence, supported entity/predefined-type mappings, explicit No/NotExported suppression and conflict-safe fallback | Native keyed string framing is admitted 2024–2026; numeric flags are honored only when the existing parameter decoder actually recovers them; arbitrary entities and USERDEFINED are unsupported |
| Common property sets | Typed Reference, FireRating, IsExternal, LoadBearing and supported covering Finish values; raw instance/type parameters retained | No inferred phase Status: phase-name and export-phase evidence is insufficient |
| Native source rooms | Boxless identity retention, names, own record bounds and measured stored-solid outlines; opt-in source IfcSpaces | Outline layouts are admitted 2023–2025; unresolved outlines remain identity-only; source rooms never certify routing boundaries; vertical extrusions explicitly record approximate ceiling geometry |
| MEP | Schema/owner/checksum-bound system-reference evidence, measured 2025 connections, opt-in IFC systems/ports/relations | Membership remains payload-reference evidence with documented extra references; connection recovery is partial; unknown placement/direction and unconnected/native-graph ports remain unresolved |
| Design options | Bounded streaming primary-option decoding, explicit all/main-and-primary export choice | Positive evidence is 2024; 2025 admits the upstream layout without a positive set fixture; other releases and unresolved choices retain geometry |
| Capability contracts/fuzzing | Executable release/evidence contracts and bounded seeded parser/converter mutations | Contracts describe decoder admission, not complete geometry support; fuzzing excludes WASM and arbitrary CFB allocation-table mutations |

Reports now retain room, MEP and design-option evidence. Rooms and MEP export
are explicit library/CLI options, without changes to indoor review or routing:

```ts
makeIfc(result, { nativeRooms: true, mep: true, designOptions: "main-and-primary" });
```

The optional WASM was rebuilt as 0.4.0 from the pinned commit. Its adapter uses
an explicit scaffold quality mode and bounded walker limits. Revit 2027
metadata opens, but its full optional-reader path remains excluded. The WASM
grew from 0.9 MB to 4.1 MB; source commit, toolchain and output hashes are in
`lib/rvt-wasm/provenance.json`. The JavaScript geometry pipeline is independent.

## Model verification

Models and reference conversions came from the user's
[Drive folder](https://drive.google.com/drive/folders/1Dx_v2v6M1LI02E4sngLyoyVMdnohijLT).
The files remain outside Git. Complete observations, source SHA-256 hashes,
reference metadata, export choices and scope are in
[the validation summary](generated/rvt-semantic-integration-2026-10-14/summary.json).

| Model | Release | Scene triangles | Scene hash vs base | Rooms / outlines |
| --- | ---: | ---: | --- | ---: |
| RAC Basic | 2025 | 195,555 | Identical | 14 / 14 |
| Technical School | 2025 | 393,145 | Identical | 91 / 85 |
| Snowdon Towers | 2024 | 1,596,168 | Identical | 54 / 47 |
| UNBC | 2027 | 901,903 | Identical | No native rooms recovered |

Every model also matches the base mesh count, bounds count, origin and scene
extent. Hashes include positions, indices, colors and triangle ownership. This
proves scene preservation, not geometric equivalence to every Revit export.
All generated IFCs reopened as IFC4 with web-ifc; this check validates readable
schema/entity populations and does not constitute complete EXPRESS-rule or
geometric conformance validation.

UNBC has **35,161 unambiguous shared numeric IFC Tags, all with matching Revit
GlobalIds**. The comparison excludes 2,945 ambiguous Tag groups and records 266
output-only and 2,367 reference-only groups. IFC class mappings can differ even
where identities agree. The supplied Autodesk GLBs were inspected for metadata,
instancing and bounds. Their Autodesk dbIds are not assumed to be Revit IDs,
and Snowdon's coordinated walls view is not treated as a full-model export.

Snowdon resolves Bandstand Options primary `1500724` and Bleacher Seating
primary `2059970`. Its final audit requests main-and-primary IFC selection while
the source scene remains unchanged. RAC, School and Snowdon opt-in room exports
reopen with 14, 91 and 54 IfcSpaces respectively. Missing level evidence is kept
under the building rather than assigning a nearest storey. Supplied models
produced no positive keyed IFC override values, so those mappings are covered
by synthetic framing, conflict/precedence and independent-reader tests rather
than claimed real-model override parity.

Additional SHA-verified MIT mechanical/plumbing witnesses from upstream's
registry provide positive MEP validation. Mechanical recovers 5 systems and
69 of 73 reference connections with no extra connections. Its full Reviter
conversion with `--mep` reopens with 5 IfcSystems, 138 ports and 69 connections;
74 unambiguous product GlobalIds match the reference. Plumbing recovers 120 of
126 reference connections plus one native join to an owner absent from the
reference IFC. Raw membership totals include the documented reference-candidate
ambiguity. See [the MEP evidence details](native-mep-integration.md).

## Checks and reproduction

- Unit suite: **1,871 passed, 2 skipped, 0 failed**.
- Typecheck and production build: passed.
- Rendered HTML: 4 passed; an inherited `restore`/`restores` assertion typo was corrected.
- ESLint on all changed source/tests: passed. Repository-wide lint retains the base's **113 errors and 75 warnings**, confirmed by running lint on the unchanged base checkout.
- Seeded malformed-input run: 256 inputs, 2,560 target runs, 0 failures; exact corpus digest is retained in the generated report.
- WASM provenance/network-import checks and actual model metadata/diagnostics smoke checks: passed.

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-rvt-semantic-integration.ts model.rvt \
  --reference-ifc revit.ifc --baseline baseline.json \
  --native-rooms --mep --design-options main-and-primary \
  --json audit.json --out recovered.ifc --evidence room-evidence.json

npm run test:capabilities
npm run test:fuzz
npm run fuzz:rvt -- --seed 5396052 --cases 256 --output fuzz.json
node scripts/rebuild-rvt-wasm.mjs
```

[Attribution and Apache-2.0 notices](rvt-semantic-attribution.md) identify adapted
upstream files and Reviter's changes. No geometry/viewer replacement, navigation
promotion, deployment, or source-model replacement is part of this branch.
