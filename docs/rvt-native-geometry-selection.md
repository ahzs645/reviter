# Native body and default 3D selection comparison

The continuation found and fixed two source-body selection errors. A complete
instance-specific native body and its reusable symbol fallback could both be
drawn under the same Revit element ID. The fallback is now skipped after an
ordinary native own body passes envelope and output-budget admission. A failed,
reconstructed or provisionally admitted own body retains its fallback; other
instances and separately placed parts keep their geometry.

The pinned upstream reader also selects opposite saved `GConditionCut`
representations for ordinary 3D output. Its
[direction predicate](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/native_graphics_traversal.rs#L438)
returns the stored negation boolean for comparisons 6–8. Reviter now applies
only those decoded, descriptor-owned filter predicates. Unknown comparisons,
other view conditions and family formulas remain unresolved. Exclusion follows
the filter's FIFO ancestry. If a drawable pointer is reused outside the false
subtree, exclusion is withheld so a shared true occurrence cannot be hidden.
This selects a stored representation; it does not subtract a joined wall or
trim an already repaired native body a second time.

The source-only witness for symbol 360469 contains two opposite cut filters,
each owning a six-face, twelve-triangle BRep. The ordinary 3D selection keeps
six faces and twelve triangles instead of both alternatives. Independent own
bodies 694201 and 694735 retain ten drawable faces and 25/24 triangles. Their
complete page checksum, declared class, FIFO ownership, surfaces and source
bounds were verified before examining reference geometry. Those saved-graphics
measurements are not asserted equivalent to Revit API geometry summaries for
IFC instance-as-type identity.

## Reproducible owner comparison

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-ifc-owner-geometry.ts recovered.ifc paired-reference.ifc \
  --sample-tags 694201,694735 --json owner-geometry.json
```

Both IFCs are independently reopened through web-ifc with automatic origin
recentering disabled. Explicit product geometry transforms are mapped from
Y-up metres to Z-up feet without fitting a translation, rotation or scale.
Only one exact decimal Tag per side with matching GlobalId enters comparison.
Duplicate Tags, unmatched identity and anonymous geometry are reported outside
that population. The Autodesk GLBs use database IDs that are not proven Revit
element IDs, so they do not supply owner matches.

The report includes world bounds, surface area, triangle counts, exact-weld
topology and closed-part shell volumes. A volume is withheld for open,
degenerate, non-manifold or inconsistently wound parts; the sum of absolute
closed-part volumes is a diagnostic and does not establish a non-overlapping
material union. No welding tolerance or hole filling repairs the measurement.
For explicitly selected owners, every triangle's vertices, edge midpoints and
centroid are measured against the other owner's finite triangles in both
directions. These finite samples are not a continuous Hausdorff bound.

The compact before/after evidence is recorded in
[rvt-owner-geometry-audit.json](generated/rvt-owner-geometry-audit.json).
Across 36,048 identical Tag/GlobalId owner pairs, column surface-area agreement
within 1% improved from 9/311 to 249/311, and railing agreement from 145/202 to
198/202. Column corner agreement within 0.01 ft improved from 221/311 to 261/311.
Area error improved for 357 owners and worsened for none beyond a relative
1e-5. Four curved-column corner residuals increased but stayed below 0.00311 ft.
The two source-owned trimmed-column witnesses have bidirectional sampled
surface distances below 0.000014 ft. The model retains 32 mesh batches;
triangles decrease from 901,903 to 858,388 by selecting one source body instead
of drawing extra alternatives. This is a measured geometry change, so the old
geometry hash is deliberately not reported as preserved.

The audit also retains unresolved witnesses: wall 1185924's reconstruction has
a maximum sampled surface discrepancy of 23.30 ft despite nearly identical
bounds; wall 801614 retains an extra portion with a 0.8003 ft sampled distance.
Column 2236110 still differs by 16.54% in area and 0.4867 ft in sampled surface
distance even though its bounds agree. These diagnostics prevent a bounds or
triangle-count result from being presented as complete surface agreement.
The remaining gaps need independently decoded source bodies, beyond the
upstream's release-specific box-cut heuristics for simpler bodies.
Private full reports, native graph traces, models and IFC outputs stay outside
the repository. Agreement is scoped to the paired export's view, phase and
tessellation; counts and bounds alone are not geometry accuracy scores.

## Fresh four-model campaign

All four Reviter models were freshly converted after the source body fixes.
The unchanged upstream exports were reused only after checking their exact
input bytes, binary hashes, output hashes, mode and walker limits. All eight
IFC outputs reopened independently. The
[four-model geometry report](generated/rvt-native-geometry-four-models.json)
records the full hashes and scoped owner comparisons.

| Model | Prior triangles | Current triangles | Prior/current unique owner pairs | Maximum owner bounds change |
| --- | ---: | ---: | ---: | ---: |
| RAC | 195,555 | 195,167 | 461 | 0 ft |
| School | 393,145 | 378,957 | 5,507 | 0 ft |
| Snowdon | 1,596,168 | 1,594,784 | 8,931 | 0.000000028 ft |
| UNBC | 901,903 | 858,388 | 36,048 against paired IFC | Measured above |

Every model retains its original mesh count, recovered-bound count, origin and
scene extents. Mesh-buffer hashes and triangle counts change deliberately. The
three prior-output comparisons show zero lost owners or identity disagreements;
their supplied Autodesk GLBs expose only database/fragment IDs and therefore
cannot prove Revit-owner surface accuracy. UNBC's paired IFC comparison still
matches 35,117/35,117 unambiguous product IDs and 36,886/37,132 type relationships.
The native renderer fixes do not authorize a different type-identity recipe.

Before/after optional enrichment hashing was added after the first three worker
modules loaded, so that instrumentation is explicitly unavailable there. UNBC
records an unchanged geometry hash across enrichment. The existing final scene,
baseline and owner checks remain independently measured on all four models.
