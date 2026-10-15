# Native MEP evidence and IFC export

The page decoder and pinned-reader model adapter complement one another.
The model adapter recovers the complete reference topology on the three
Revit 2025 RE1 MEP witnesses below; IFC emission still intersects that evidence
with the products Reviter actually exports.

`lib/reviter/native-mep.ts` adapts rvt-rs commit `1c3d337`'s Apache-2.0
`partition_mep_systems.rs` (RE-162) and `partition_connector_pairs.rs`
(RE-138/141). Systems are admitted for Revit 2024–2027; the reference
measurement is Revit 2025. Connector layouts are admitted only for 2025.
Neither admission claims geometry coverage for those releases.

Systems require a file-local schema class, a declared element identity, a
complete native data-object size echo, and a matching Adler-32 checksum.
System names are the measured printable counted string or electrical circuit
number. Disagreeing records suppress the name. Membership is a reference to
the system's ElementId in an element's checksum-verified object; it is not a
fully decoded system field. Its source page and byte offset are preserved.
As upstream RE-162 documents, unfiltered references may include warning
records and additional family instances. IFC emission intersects membership
with products actually exported by Reviter.

Connections require the measured two-reference counted list, both flags equal
to one, both declared identities, and validated owner indices. Curve joins use
the measured connector-manager anchor and later-block precedence. Fitting
joins require native DuctFitting or PipeFitting category evidence, which can
arrive after the list. Spatial proximity is never used. Complete consecutive
pages may share a bounded 64 KiB tail; damaged chunks and stream changes
cannot be joined. Checksum work is bounded per page and compact references are
capped at one million, with partial-evidence limitations reported.

`export-ifc-mep.ts` emits IfcSystem, IfcRelAssignsToGroup,
IfcDistributionPort, IfcRelNests and IfcRelConnectsPorts. Port placement,
direction and classification remain unset. It creates ports only for observed
joins whose two owner products were exported. The pinned-reader adapter below
also adds unconnected family-symbol ports and native-graph joins.

IFC emission is opt-in with `makeIfc(result, { mep: true })` or the semantic
audit CLI's `--mep` flag. The conversion report retains all evidence and
limitations regardless of that export choice. System roots use proven native
GlobalIds when their history identity is available; ports and relationships
retain deterministic derived identities.

## Validation

Twenty source-evidence unit cases exercise checksum corruption, conflicting names, circuit
names, release gates, native index handling, later-block precedence,
reciprocal deduplication, unknown endpoints, late fitting evidence, complete
and damaged page splits, and export filtering.

The SHA-verified MIT models and paired IFCs from `Drshelden/IFC-ECS` are
identified in rvt-rs `research/witness-registry.json`. Source files were kept
outside this repository. Run:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-native-mep.ts RE1-Mechanical.rvt RE1-Mechanical.ifc --out evidence.json
```

| Model (Revit 2025) | Systems | Native memberships | Recovered joins | Matching reference joins | Missing reference joins |
| --- | ---: | ---: | ---: | ---: | ---: |
| RE1 Mechanical | 5 | 78 | 69 | 69 of 73 | 4 |
| RE1 Plumbing | 8 | 138 | 121 | 120 of 126 | 6 |

Mechanical's names and memberships match RE-162's measured systems: Supply
Air 58, Return Air 8 and OTH 1/2/3 with 2/2/8 members. Plumbing's four
additional raw membership references are consistent with RE-162's documented
warning/family caveat. Its additional native join `442378:2/444124:0` has an
owner (`442378`) absent from the paired Revit IFC. The source relationship is
preserved in evidence and can be emitted only if Reviter actually exports both
owners. This table describes the page decoder alone. The native-model
projection closes its reference topology gaps as measured below.

| File | SHA-256 |
| --- | --- |
| RE1-Mechanical.rvt | `d559720177aa0ec435133f804e7c45d60da2deb9d5585bb3d55f4830139c014b` |
| RE1-Mechanical.ifc | `9e56cf7246ce86ef73646dd588a1efb8a4756e5e102b30e28b3b58577a454db0` |
| RE1-Plumbing.rvt | `03689df2aa426031a216e65051b9f19d3265d6fe96884dd47373b17435f9e54c` |
| RE1-Plumbing.ifc | `294490b222632509779910345f27a4eeda3645956138a593298c241495f7b8b6` |
| RE1-Electrical.rvt | `9875e765c9f47893808c47b845a8379b8777b92510e3e0284f763cb457c9630b` |
| RE1-Electrical.ifc | `c7002a10c8e10ab2fca64ff61dcf38db04da652924f65ce53c2064827dfa9e16` |

The supplied technical-school 2025 and UNBC 2027 models produced no native
systems or joins. UNBC's broad reference collection reached the compact
reference cap and reports partial evidence. Connector recovery is deliberately
disabled for that 2027 model. Those architectural models are negative checks,
not positive MEP parity witnesses.

## Native connector model projection

`native-mep-model.ts` validates the pinned reader's `Port` and
`PortConnection` model entities. Each owning entity index must point to a
`BuildingElement` whose numeric `type_guid` equals that port's native
ElementId and is independently declared by the same RVT. Duplicated product
identities, invalid indices and multiple destinations for one physical port
are suppressed. Native-model joins override contradictory byte-list joins;
explicit ambiguity also blocks their reintroduction from the fallback.

The producer reads `native_connectors.rs` (RE-169/171) and can use the older
RE-138/141 fallback. Its model does not expose an individual relation's binary
span or reader path, so projected evidence stores a null binary locator and
the reader commit, mode and model entity index. Geometry from the upstream
model is not imported. The graph projection is admitted for Revit 2024–2026
with the pinned commit only. Revit 2027 native export topology remains
unresolved and is not promoted through this adapter.

| Revit 2025 witness | Reference joins recovered | Reference ports recovered | Additional native evidence |
| --- | ---: | ---: | --- |
| RE1 Mechanical | 73 / 73 | 150 / 150 | None |
| RE1 Plumbing | 126 / 126 | 260 / 260 | Two tank joins and four ports outside the reference export |
| RE1 Electrical | 0 / 0 | 53 / 53 | None |

Electrical's 53 unconnected ports are a positive check of family-symbol port
recovery, including the domain filter that omits the panel's conduit ports.
The source tank is retained as native evidence. It is not silently deleted
because a reference export omitted it; its connections can reach IFC only
when both owning products are exported.

## Dimensional evidence

`native-mep-dimensions.ts` adapts RE-134 curve dimensions and native type IDs,
RE-157 inner/outer pipe diameters, RE-165 fitting nominal diameters and the
RE-131 cylinder proof. These fixed layouts are admitted only for their
measured Revit 2025 release. Curve ownership requires the two native connector
entry points to fit one unique source record box. A pipe's endpoint pair must
rebuild all six source box faces and independently conditioned radii must
agree. This proves a dimensional body; it does not infer a connection to any
neighbor. Grid, anchor and checksum budgets bound work, and conflicting
copies suppress the affected fields. Reducers with disagreeing connector
diameters receive no single nominal diameter. Equal duct width and height
does not establish shape.

The independent paired IFCs use millimetres; source feet were converted by
304.8 for comparison. All 94 segment lengths match the reference properties
(31 Mechanical and 63 Plumbing). All 69 pipe radii match the reference circle
profiles (6 and 63). All 25 Mechanical duct width/height/length triplets match
the rectangle profiles and extrusion depths, allowing for the export's axis
ordering. Plumbing's 42 reference fitting nominal diameters all match; four
additional source nominal sizes remain visible as source-only evidence.
The typed upstream model also agrees on all recovered lengths and nominal
diameters. The 69 recovered pipe inner/outer diameters and axes remain
source-provenanced, rather than being described as independently validated
inner diameters.

The IFC helper writes these facts to `Reviter_NativeMepDimensions`, using
metres for length measures and preserving the native type ID and decoder
provenance. Standard common property sets are handled separately by Reviter's
semantic exporter. The geometry pipeline is unchanged.

## Optional IFC pipe reconstruction

`export-ifc-mep-geometry.ts` creates a hollow circular sweep only for a proven
native PipeCurves category with both the RE-131 axis proof and RE-157 diameter
evidence. It checks the emitted outside radius against all six native source
bounds faces, requires a positive inner diameter below the outside diameter,
and creates a stable right-handed frame along the native endpoint pair.
The source origin is subtracted in feet before conversion to metres.

The parent exporter enables it with `reconstructPipeGeometry: true` for proxy
or absent bodies. Certified native and reference meshes stay intact, and
the ordinary scene buffers are not modified. The IFC recovery set describes
the body as a native-parameter reconstruction with `GeometryExact=false`;
it is not a recovered native BRep. A hollow pipe can differ from a reference
export's simplified filled cylinder while matching its outside dimensions.

Six focused cases verify rejection before writes, oblique frames, profile
units, independent reader parsing, opt-in behavior, source-scene immutability
and preservation of certified meshes. All 69 real pipes (Mechanical 6,
Plumbing 63) passed the independently re-read native bounds gates, produced
finite web-ifc triangles and retained their bodies in the independent
`@ifc-lite/parser` reader. With web-ifc `CIRCLE_SEGMENTS: 64`, the largest
reopened six-face bounds error was 0.00023308 feet (0.071 mm). The default
reader circle tessellation had a maximum chord-related bounds error of about
2.32 mm; that is reader discretization, not a change to the stored circle
parameters.
