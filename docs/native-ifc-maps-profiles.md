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
storage for that ID. Centered dimensions alone cannot classify the shape.
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

### Actual Autodesk structural sample

The official [Snowdon Towers Sample Structural RVT](https://revit.downloads.autodesk.com/download/2024RVT_RTM/Docs/InProd/Samples/Snowdon%20Towers%20Sample%20Structural.rvt)
was downloaded for local verification only. Its SHA-256
`6dc833f9fe9fa702607265f2e3d581a6d2a928ea56133db8225c9b5e0f79a44f`
matches the pinned upstream witness registry. With the same optional semantic
reader enrichment used by the app, 141 maps cover 460 source-owned products;
all 460 independently reopened transformed-triangle/material digests equal the
ordinary export. The IFC decreases from 45,607,686 to 25,904,087 bytes. These
actual maps reuse translations; the rotated path has the separate asymmetric
quarter-turn fixture described above. IFC-Lite also reopens this complete model.

The source scanner recovers 287 complete six-parameter section candidates from
this structural model. **None has a recovered owned Section Shape enum**, so
zero material profiles are emitted. This documents the remaining source
contract rather than classifying symmetric dimensions as an I shape. The
2025 Autodesk basic structural sample likewise emits no invented I profiles.
The parameter-backed profile writer is verified by the independent-reader
fixture. This specific structural model has no qualified positive profile
coverage until its owned shape code or certified native section profile is recovered.

### Actual School rotated maps

With app semantic enrichment, the supplied School RVT has 78 representation
maps covering 250 owned products, including **four groups with different native
rotation bases**. All 250 products pass the independent double-attribute
comparison: maximum persisted-coordinate difference is `9.73e-11 m`. The
web-ifc Float32 preview cache introduces at most `1.907 micrometres` of
recentring roundoff; triangle counts and colors agree. IFC-Lite reopens the
full model. The IFC decreases from 47,868,153 to 46,446,458 bytes.

School retains 13 section candidates, three with proved I-shape enum codes.
No candidate has an eligible source occurrence/category/type/material join,
so no orphan or guessed profile is emitted. Known source shape alone does not
create an occurrence relationship. The [compact audit](generated/rvt-native-maps-profiles-validation.json)
records all model counts, reader scopes, hashes and measured errors.
