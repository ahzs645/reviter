# Revit 2027 CondInt16 drawable-face correction

## Result

The Revit conditional-property token domain is:

| Token | Meaning |
| ---: | --- |
| `0` | null property |
| `-1` | real queued-property sentinel |
| positive | numbered property in the shared token namespace |
| below `-1` | unproven and rejected |

Drawable-face certification previously used `token > 0` for a Face surface,
first loop, and face-region entry. That silently classified a valid `-1`
surface or loop as null. The FIFO replay itself already handled `-1`
correctly, so tessellators could produce a mesh that the final coverage gate
then discarded.

The production gate now accepts exactly `-1` or a positive token and preserves
`0` as null. This applies symmetrically when identifying drawable faces and
when counting loopless reference faces.

## Exact UNBC witness

Element `1960533` is the one IFC-visible direct GRep owner that exposed the
bug. It is an `IfcRoof` in the reference IFC and one exact framed Revit 2027
GElement in partition 325:

| Field | Value |
| --- | ---: |
| Frame marker | `2246` (`GElement`) |
| Object length | 14,651 bytes |
| Root child | token 3, source slot 2,343 (`Geometry`) |
| Geometry faces / edges | 7 / 14 |
| Completed replay spans | 41 |

Faces 4–7 are cone apex sectors and faces 8–9 are sampled cylinders. Their
surface descriptors use token `-1`, and their loop descriptors are positive.
The existing browser tessellators produce:

| Certified subset | Faces | Triangles |
| --- | ---: | ---: |
| cone apex sectors | 4 | 164 |
| sampled cylinders | 2 | 164 |
| total | 6 | 328 |

Face 10 has a positive plane surface descriptor but no first loop or face
region. It remains a non-topological reference face and is correctly excluded.
After the correction, coverage reports six drawable faces, six meshed faces,
and `complete:true`.

The focused witness can be reproduced without IFC:

```bash
node --experimental-strip-types \
  scripts/inspect-revit-2027-grep-owner.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  1960533
```

## Full-model correction

The stricter token contract both recovers real geometry and exposes previously
hidden unsupported geometry. That is intentional: a lower parity count is
preferable to claiming a complete product from partial faces.

| Audit measure | Before | Corrected |
| --- | ---: | ---: |
| certified direct owners | 13,268 | 13,269 |
| certified direct-owner triangles | 294,197 | 302,235 |
| certified placements | 30,093 | 30,088 |
| certified placement triangles | 467,944 | 474,815 |
| complete nested roots | 109 | 105 |
| partial nested roots | 1 | 5 |
| complete placement-target roots | 2,136 | 2,131 |
| partial placement-target roots | 2 | 7 |
| matched IFC numeric geometry Tags | 34,867 | 34,864 |
| IFC geometry Tag coverage | 96.4669% | 96.4586% |

The direct roof is recovered, but four railing roots and five placements are
now correctly withheld because their `-1`-backed drawable faces still require
unsupported surface/trim transitions. The five partial nested roots contain:

- 20 unsupported-surface issue occurrences;
- four non-rectangular cylinder-trim occurrences;
- three UV-link discontinuities.

All 105 complete nested roots now match the IFC world AABB within `1e-6 ft`.
The IFC remains a post-decode oracle only; no IFC data participates in token
classification, replay, tessellation, or admission.

## Native tessellator boundary

This correction is upstream of `TB_Geometry`, `libTD_Ge`,
`libOdBrepModeler`, `libTD_BrepBuilder`/`libTD_Br`, and
`libTD_BrepRenderer`. Those native layers receive a non-null property graph;
they do not redefine the persisted CondInt16 null/sentinel contract.

The newly exposed partial roots must therefore remain fail-closed until their
owned analytic surface, p-curve, loop, and trim semantics can be represented
in the neutral browser BRep and tessellated with a proven bounded policy.
