# Native IFC representation maps and structural material profiles

These additions follow pinned rvt-rs `src/ifc/step_writer.rs` (IFC-21/30),
`src/partition_type_parameters.rs` (RE-103) and
`src/ifc/mod.rs::material_profile_sets_from_sections` at
`1c3d337dbd2a6810e9dfad68fe99857843d67387`, Apache-2.0.
They preserve Reviter's scene geometry.

## Representation maps

`reuseMappedGeometry` remains off by default. Translation reuse still requires
native triangle ownership, a unique source type, identical ordered topology and
materials, and identical local positions within floating arithmetic roundoff.

Rotation reuse additionally requires the decoded native `InstancePlacement`,
the same persisted geometry object ID, an orthonormal source basis and positive
unit determinant. Each vertex is inverse-rotated into that source frame, and the
complete ordered fragment is compared. Mirrored, scaled, conflicting,
reference-assisted and approximate bodies keep their ordinary tessellation.
Float32 vertices with materially different local rounding also stay separate.
The emitted `IfcCartesianTransformationOperator3D` uses all three native axes.
No bounding-box direction, mesh alignment optimization or shape-name match
establishes a rotation.

Optional comparisons stop after four million vertices / 200,000 owners; crowded
fingerprint buckets stop at 16 candidates. Outside those limits geometry is
exported ordinarily. The hash only selects candidates; it cannot authorize reuse.

## Structural material profiles

The page collector reads six numeric type parameters from complete native
value blocks: width `-1005502`, depth `-1005503`, web `-1005525`, flange
`-1005524`, horizontal centroid `-1005508` and vertical centroid `-1005509`.
Owner IDs must be declared; zero and undeclared block owners terminate the
preceding owner. All observed values must agree across pages. The six metrics are retained as unresolved section candidates. Emission additionally
requires the exact owned integer `STRUCTURAL_SECTION_SHAPE` (`-1005501`) to
be 6 (IParallelFlange) or 8 (IWideFlange), with centered centroids. Autodesk's
[Revit 2025 API enumeration](https://github.com/ADN-DevTech/revit-api-chms/blob/main/html/2025/html/daaa1d33-7ee8-738a-5ab7-b93f056deaf8.htm)
defines these codes, and Reviter's parameter descriptor declares Integer
storage for that ID. Centered dimensions alone cannot classify the shape. A family-owned shape code may classify its
symbols through the exact native `FamilySymbol.m_familyId` edge. Autodesk's
[Family.StructuralSectionShape property](https://github.com/ADN-DevTech/revit-api-chms/blob/main/html/2025/html/dd92fb5d-7aca-13c1-7402-2f67efba64ec.htm)
is explicitly the family's structural section shape; this is a family-wide
classification, not substitution of an arbitrary family parameter default.
The six dimensions remain owned by the actual symbol and are never inherited.
Section links resolve independently of the render geometry-cache domain, so a
valid type without its own cached render object can retain its classification.
Every link still requires a framed source FamilySymbol, an exact fixed-field or
native static-tail family reference, and an independently framed Family target.
Conflicting source frames and ambiguous family targets withhold inheritance.
An explicit symbol NotDefined/invalid/malformed value, contradictory symbol
values, or disagreement with a known family classification also withhold the
profile. Each resolved section retains the shape owner, resolution, source
family relation and integer-parameter witnesses.
Incomplete or contradictory values are withheld; unsupported/missing shape
codes remain unresolved. The collector's release contract is 2024–2027, bounded at 512 MiB
processed pages and 100,000 owners. Up to 96 trailing bytes and the current
owner are carried between consecutive complete pages of the same partition;
missing/partial pages reset this state, and each value retains its originating
chunk/offset even when its serialized bytes straddle a page boundary.
Pages with unresolved compression never
supply these parameters. Candidates remain scoped to declared source owners; an actual source type
relationship is required when applying them to products.

A profile association requires an explicitly decoded structural column/framing
category, an eligible IFC class, this exact type descriptor, and consistent material ownership. A single persisted
assignment needs a named native material definition. If no assignment was
recovered, the valid optional `IfcMaterialProfile.Material` is `$`, explicitly
described as unresolved; body surface styles remain unchanged. Multiple,
conflicting or invalid assignments and compound-layer bodies keep the existing
material representation. This follows the [IFC4 MaterialProfile specification](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcmaterialresource/lexical/ifcmaterialprofile.htm),
which makes Material optional. Width/depth/web/flange describe the supported
source section; fillets/radii and their exact edge shape remain unresolved.
The exporter emits metric `IfcIShapeProfileDef`, `IfcMaterialProfile`,
`IfcMaterialProfileSet` and occurrence `IfcMaterialProfileSetUsage`, plus the
associated type relation. Cardinal point, reference extent, fillet radius and
edge slope remain unset because their source fields have not been recovered.
Certified body triangles remain the exported body. Names and bounds do not
supply profile dimensions; there is no unit-size fallback profile.

## Verification

The asymmetric synthetic fixture exercises 16 quarter-turn instances, checking
world-space triangles, owners and material colors after reopening ordinary and
mapped exports with web-ifc. IFC-Lite also parses the result. Separate refusal
cases cover different geometry identities, reflected/nonrigid bases, topology,
materials, source ownership and near-matching coordinates. Profile tests reopen
metric dimensions, occurrence ownership, material relations and unset cardinal
point/reference extent in both readers.

Reproduce actual-model checks (models and raw exports stay outside Git):

```sh
node --max-old-space-size=6144 --experimental-strip-types \
  --import ./scripts/register-test-typescript.mjs \
  scripts/audit-ifc-native-maps-profiles.ts model.rvt report.json
```

The audit reopens exports, compares each mapped product's IFC double-attribute world triangles at one
nanometre and its Float32 preview triangles/colors at ten micrometres. Both
actual maximum coordinate differences are reported; using two checks separates
IFC placement correctness from the reader's geometry-cache recentering. The audit records maps with different native rotations,
and compares all emitted profile dimensions/material names against source
plans. These checks establish export preservation; they do not claim complete
RVT geometry equivalence or Revit-export parity.

Both model audits below were repeated after the deferred whole-frame allocation
and output-priority correction. Each profile-disabled control is a fresh export
from the same conversion result with `nativeStructuralSections` empty. All
reported counts, source witnesses, export byte counts and geometry differences
were unchanged by that correction.

### Actual Autodesk structural sample

The official [Snowdon Towers Sample Structural RVT](https://revit.downloads.autodesk.com/download/2024RVT_RTM/Docs/InProd/Samples/Snowdon%20Towers%20Sample%20Structural.rvt)
was downloaded for local verification only. Its SHA-256
`6dc833f9fe9fa702607265f2e3d581a6d2a928ea56133db8225c9b5e0f79a44f`
matches the pinned upstream witness registry.

Of 287 complete six-parameter candidates, 261 now have source-proven I-shape
classification. **427 actual products receive 11 material-profile definitions
and 427 usages.** All 427 independently reopened owner/dimension/material
checks pass. Every product's geometry and colors match the profile-disabled
export exactly (maximum coordinate difference zero). Material remains explicitly
unresolved (`$`) for these products; no material identity is invented.

The optional mapped export covers 463 products with 142 maps. All pass the
double-attribute and Float32-preview geometry checks; maximum differences are
`9.50e-11 m` and `2.98e-8 m`, respectively. IFC-Lite reopens the complete file.
The ordinary/mapped exports contain 45,985,836 / 26,127,303 bytes in this
working-tree audit; these are compression comparisons, not source-fidelity scores.

web-ifc 0.0.77 logs nullable-material color/reference warnings on some products
when following the valid `Material=$` usage. Repeated mesh reads produced 507
of each REF0/GetLineType0/GetColor message. The reader still returns identical
geometry and colors for all 427 products, and IFC-Lite parses the complete IFC.
This is a measured reader limitation; the exporter retains the valid unknown
material instead of substituting a fictitious material.

### Actual School profiles and rotated maps

School's eight structural occurrences reference native types 207176 and
208294. Those symbols own the six cross-section metrics, while their exact
native family references lead to Family 331701 and 332703, each owning integer
Section Shape code 6. Complete independent native source graphs confirm the
symbol-family edge and the Family's owned `ParamValueSetInt` pointer/value.
The earlier three directly classified candidate records were Family definitions,
not unused symbol types: requiring the code on each symbol hid the proper
family-wide classification.

**Eight products now receive two profile definitions and eight usages.** All
owned dimensions, source joins and explicitly unresolved materials pass the
independent reader checks. All eight bodies and colors are identical to the
profile-disabled export (maximum coordinate difference zero).

The optional mapped IFC contains 79 maps covering 252 products, including four
groups with different native rotation bases. All 252 pass double-attribute
comparison (maximum difference `9.73e-11 m`) and preview/color comparison
(maximum Float32 recentering difference `1.907 micrometres`). IFC-Lite also
reopens the complete file. The ordinary/mapped exports contain 52,371,957 /
50,866,350 bytes in this working-tree audit.

The [compact family-classification validation](generated/rvt-structural-profile-family-validation.json)
records source hashes, independent native-graph witnesses, exact relationships,
deduplicated profile dimensions, product IDs, preservation checks and reader
limits. Only source-proven symmetric I sections are authored. Other section
shapes, radii/fillets, cardinal points and profile-derived extrusion bodies remain unsupported.
