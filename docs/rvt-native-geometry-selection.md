# Native body and default 3D selection comparison

## Complete large bodies

A further source investigation found complete same-page `GElement` objects
falling between two readers: the general page scanner stops at 65,535 bytes,
while the geometry reassembler accepted only objects crossing page boundaries.
Some inflated pages hold larger complete objects. UNBC wall 1185924 stores a
110,022-byte body and column 2236110 a 109,125-byte body; neither needed a new
join or cutting heuristic.

The geometry collector now accepts these complete large frames only after
the repeated owner ID, independent length echo and Adler-32 agree. Checksum
validation uses a borrowed page view before copying a candidate, with a
128 MiB work budget per partition and the existing 8 MiB frame limit. Ordinary
small objects keep their current reader; crossing objects keep their current
reassembler. Existing complete FIFO, surface coverage, source envelope and
output-budget gates still decide whether a body enters the scene. No source
face or trim is inferred from reference geometry. The new counters appear in
`stats.largeWholeGElementFrames`, and budget exhaustion produces a warning.

New whole bodies are buffered within a separate 64 MiB limit and compiled
after all ordinary, crossing and original alternate definitions. An existing
definition for the same owner always wins; among queued whole frames the
latest source occurrence wins, and a larger replacement that exceeds the
buffer limit cannot revive older bytes. Supplemental cache exhaustion is
reported separately so it cannot stop the original nested owners from being
composed. Under output pressure, bodies depending on supplemental definitions
spend only the budget left after original direct and placed bodies. An
existing shared fallback remains eligible when a supplemental own body is
withheld. The native definition and output triangle limits are unchanged.

This priority rule fixes a regression found during the first four-model
validation: compiling new bodies immediately changed admission order at Snowdon's output budget,
which removed thirteen natively drawn planting elements and reduced seven railings
to fallback shapes. That intermediate output was rejected. The final campaign
below checks their exact owner IDs and bodies explicitly; total triangle gains
alone did not qualify that intermediate output for acceptance.

Exact same-page offsets also feed the separately bounded original-symbol
collector. Split frames do not borrow the completion page's location for
identity provenance. The identity collector's own checksum/FIFO and source
class/history checks remain required.

The selected source bodies can be independently audited without reading an
IFC or GLB:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/audit-rvt-owner-frames.ts unbc.rvt \
  --owners 1185924,801614,2236110 --json source-frames.json
```

This audit uses a separate slow Adler implementation and records complete
source framing, FIFO counts and the native mesh definitions. Definition
counts precede final scene admission and do not establish reference accuracy.

## Final large-frame campaign

The [current large-frame validation](generated/rvt-native-large-frame-validation.json)
compares freshly converted outputs with commit `2d42a9c`, after the earlier
body-selection work below. Four unchanged upstream outputs were reused only
after checking source, binary and IFC hashes, export mode and walker limits;
all eight IFC outputs reopened independently. This is a geometry change: all
four models preserve recovered-bound count, scene origin and scene extents
(12 checks), while mesh hashes, triangle counts and batch counts deliberately
change (12 checks). The strict unchanged-baseline CLI therefore exits 1.
Optional semantic enrichment preserves each freshly measured geometry hash.

| Model | Prior → current triangles | Prior → current batches | Complete large frames | Prior → current represented products |
| --- | ---: | ---: | ---: | ---: |
| RAC | 195,167 → 209,174 | 97 → 94 | 30 | 475 → 475 |
| School | 378,957 → 438,508 | 47 → 49 | 23 | 5,592 → 5,598 |
| Snowdon | 1,594,784 → 1,759,255 | 143 → 148 | 316 | 8,978 → 9,003 |
| UNBC | 858,388 → 898,491 | 32 → 31 | 109 | 36,415 → 36,434 |

Every prior product GlobalId and decimal Tag remains present in all four
exports. Rendered exact-owner comparisons retain 461 RAC, 5,507 School,
8,931 Snowdon and 36,415 UNBC pairs, with no lost owner or identity disagreement
against prior output. School and Snowdon each gain six products; other newly
represented owners were already present without a representation. This does
not claim unchanged type relationships: the separate source identity conflict
rules and actual IFC relations are measured in the reader/type reports.

All thirteen displaced Snowdon planting owners recover their prior triangle
counts and exact world bounds. All seven degraded railings recover their prior
triangle counts, with maximum corner difference below 0.000000080 ft. Final
Snowdon still reaches the existing native output budget; its visible triangle
count is measured after exclusions and cleanup, so being below two million
does not establish an uncapped conversion. The checksum, queue and deferred
definition budgets have zero skips on these four inputs. One of UNBC's 109
queued frames retains an existing primary definition; the other 108 replay.
The final reporting-only truncation-flag correction changes neither admission
order nor geometry, allowing reuse of workers loaded just before that change.

For UNBC, 36,048 unambiguous Tag/GlobalId pairs match the paired Revit IFC.
Relative area error improves for 82 owners and worsens for eight slabs by
more than 1e-5; the largest current relative slab area error is 0.067994%.
No owner corner-error increase exceeds 0.0001 ft. Slab area and corner metrics
do not bound local surface or cut discrepancies, and no local-surface sampling
was performed for those eight slabs. Column area agreement within 1% improves
from 249/311 to 262/311; stair-flight agreement improves from 67/96 to 95/96.
Selected bidirectional finite surface samples for wall 1185924 fall from
23.30 ft to below 0.0000040 ft, and column 2236110 from 0.4867 ft to below
0.0000120 ft. Wall 801614 retains a 0.8002204 ft one-sided discrepancy.
These samples are not a continuous Hausdorff guarantee.

Product material assignments are unchanged for the eight slabs and three
selected witnesses. This preserves existing gaps: the slabs and column
2236110 lack product material associations present in the reference.
Wall 1185924 retains Gypsum Wallboard. This check does not cover surface styles,
colours, inherited type materials or layer thickness geometry.

Snowdon's changes require separate interpretation. Six flight intervals are
supported by independent source `StairsRun` elevations and aggregate IDs;
622038 and 622042 share stair 622037 but have different base-riser indices.
Their earlier approximations spanned the combined stair. Three additional
flight owners (688520, 701095, 1644693) resolve ordinary identity instances to
complete, single-BRep saved symbols: all 116/126/152 planar faces compile,
without unresolved nested references or filters. The current bounds match
those symbol bodies rather than the wider owner's graphics envelope.
Appliances 1135921 and 1135923 similarly compile all 88/74 stored BRep faces
from their exact referenced symbols. Their source graphics envelopes extend
beyond the compiled face bounds. These five source-complete representations
remain physically unverified: some have open/nonmanifold or inconsistent
winding diagnostics. The supplied Autodesk GLB has database IDs and a
recentering transform without proven exact RVT-world registration, so it does
not establish their owner-level physical accuracy. No reference-selected
repair or envelope-filling geometry was added.

Private full owner reports, source graph traces and generated geometry remain
outside Git; the compact validation records their SHA-256 hashes and scopes.
The [reader comparison](generated/rvt-reader-comparison-final.json) records
actual current export populations and independently reopened IFC statistics.

## Previous body selection work

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

That earlier audit retained unresolved witnesses: wall 1185924's reconstruction had
a maximum sampled surface discrepancy of 23.30 ft despite nearly identical
bounds; wall 801614 retains an extra portion with a 0.8003 ft sampled distance.
Column 2236110 differed by 16.54% in area and 0.4867 ft in sampled surface
distance even though its bounds agree. These diagnostics prevent a bounds or
triangle-count result from being presented as complete surface agreement.
Those are historical measurements before the complete large-frame fix above.
Private full reports, native graph traces, models and IFC outputs stay outside
the repository. Agreement is scoped to the paired export's view, phase and
tessellation; counts and bounds alone are not geometry accuracy scores.

## Previous four-model campaign

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

## Group visibility rule withheld

The upstream normal-mode `graphics_visibility` function would additionally
hide `GGroup`/`GFilter` branches with mode 1, including flags `0xa088624`.
UNBC 801614's extra material shell uses those flags, but they do not establish
a safe distinction from geometry elsewhere. A source-only experiment over
complete direct bodies found eight RAC and nine School owners losing
1.64042 ft of source-envelope coverage under the proposed group rule. For
example, RAC 423099 changes from 22 to 12 triangles and loses its exact
persisted world extents. Group and face semantics cannot be collapsed into a
new global `0x20` exclusion.

The [rejected-rule measurements](generated/rvt-group-visibility-rejection.json)
retain the four-model scope and exclusions. They measure persisted envelope
coverage, not physical-surface accuracy; drawing aids may contribute to stored
extents. The evidence does not justify applying the rule globally or using it
only on a selected reference owner. Current group selection is preserved, and
801614 remains an explicit unresolved witness. The upstream wall/column box
subtractions and 2023-only beam cutback solver likewise do not establish join
order for these already saved native bodies, so none is applied to them.

The pinned source explicitly limits
[wall joins](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/element_record_wall_joins.rs)
to axis-parallel record prisms, leaves true-L-corner survivor choice unresolved,
and says butt/mitre choice is not decoded.
[Column cuts](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/element_record_column_cuts.rs)
require a rectangular surviving difference and do not decode join priority.
[Beam cuts](https://github.com/helenkwok/rvt-rs/blob/1c3d337dbd2a6810e9dfad68fe99857843d67387/src/element_record_beam_cuts.rs)
are restricted to measured 2023 records; the source itself records unresolved
2024 steel cutback differences. The supplied four models do not validate that
2023 rule. Recovering persisted native trims addresses the measured missing
bodies without treating those proxy rules as general Revit join semantics.
