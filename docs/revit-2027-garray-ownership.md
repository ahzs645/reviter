# Revit 2027 `GArray` ownership and placement audit

This audit tests whether the 30,572 exact Revit 2027 `GArray` bodies can safely
improve the current browser scene. The answer for the supplied UNBC model is
no: the transform is real, but its nested target and full transform stack are
not yet decoded.

## Method

The RVT supplies all identity and ownership used to select records:

- a length/echo-framed Revit 2027 `GElement`;
- a `GRep` owner id equal to the independently framed element id;
- exactly one root child at source slot 2,215;
- the exact 144-byte release-gated `GArray` body, including the
  schema-declared trailing `m_numInstances` int32.

The current semantic JSON and reference IFC are audit oracles only. They are
used after RVT decoding to compare bounding boxes and are never used to locate
or reinterpret a `GArray`.

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-garray-ownership.ts \
  --rvt "/path/to/model.rvt" \
  --ifc "/path/to/reference.ifc" \
  --json outputs/unbc-parity.json
```

## Exact UNBC result

- 30,572 candidates and 30,572 exact bodies;
- zero failed bodies and zero failed chunks across 3,666 chunks;
- 30,572 unique framed owners with no duplicate owner;
- zero positive `tagElementId` values;
- 7,784 distinct positive `m_numInstances` values spanning 290,626 to
  2,497,107, so the exact field is retained raw and is not interpreted as a
  literal instance count;
- all 30,572 owners already have a current persisted placement;
- 12,647 `GArray` transforms exactly equal that placement;
- 2,941 equal its rigid inverse;
- 17,848 differ while a shared local bounds record is available.

For the 27,546 owners comparable with the IFC, using the current placement
produces 25,382 exact bounds and 25,633 within 0.5 feet. Replacing it with the
`GArray` transform drops those results to 9,176 exact and 17,296 within
0.5 feet.

Among differing transforms, the current placement has the better IFC centre
in 16,629 cases; `GArray` is better in only 185. Both attempted compositions
are decisively wrong:

| Candidate transform | Exact | Within 0.5 ft | Median centre error |
| --- | ---: | ---: | ---: |
| current × `GArray` | 0 / 17,840 | 0 / 17,840 | 357.30 ft |
| `GArray` × current | 0 / 17,840 | 0 / 17,840 | 385.58 ft |

The root world extents independently agree with IFC far more strongly:
25,385 of 27,552 are exact and 25,626 are within 0.5 feet.

## Consequence for tessellation and family regeneration

The `GArray` step transform is nested semantic state, not a replacement
world-placement matrix. Its queued source-slot 2,513 target/body and the rest
of the node transform chain remain unresolved. The record adds:

- zero native UniqueIds;
- zero model-tree edges;
- zero family-definition bodies;
- zero owned B-rep faces or triangles;
- zero material assignments.

The native tessellator layer (`TB_Geometry`, `libTD_Ge`,
`libOdBrepModeler`, `libTD_BrepBuilder`/`libTD_Br`, and
`libTD_BrepRenderer`) needs the target geometry and complete node chain before
it can evaluate or tessellate an instance. Until source slot 2,513 and that
chain are release-certified, integrating this transform would reduce IFC
parity, so the scene deliberately remains unchanged.
