# Revit 2027 conditioned Geometry route

This checkpoint adds a browser-safe FIFO path for `GFilter`-first Revit 2027
GRep roots. It is derived from the RVT's embedded `Formats/Latest` schema and
checked against the native `TB_Geometry` object model; IFC is used only after
decode as a bounds and triangle-count oracle.

## Persisted bodies

The source-name ladder in the exact 513,948-byte inflated schema maps:

| Source slot | Class | Selector-free body |
| ---: | --- | ---: |
| 2,271 | `GPoint` | 56 bytes |
| 2,238 | `GConditionInt` | 12 bytes |

`GPoint` persists:

```text
GInfo                                        20 bytes
m_coord, three float64 values                24 bytes
m_size int32                                  4 bytes
m_borderSize int32                            4 bytes
m_pointFlags int32                            4 bytes
```

The exported `OdBmGPoint`/`OdBmGPointInternalImpl` symbols independently expose
coordinate, size, border-size, and point-flags accessors. The point is a
condition/control carrier in this route; it contributes no solid triangles.

`GConditionInt` persists the inherited int32 comparison mode followed by the
int32 `m_param` and `m_value`. Like the existing direction/cut condition
readers, it affects visibility and contributes no geometry.

## Whole-model FIFO evidence

A bounded custom-registry probe first tested the two exact body sizes without
changing production:

- 1,076 `GPoint` bodies were finite and within the exact replay boundary;
- 970 `GConditionInt` bodies followed them;
- all 485 roots previously blocked at `GPoint` replayed to their exact dynamic
  payload end;
- no scan-forward, guessed alignment, IFC class, or element-id allowlist was
  used.

Production admission requires:

1. the first initial child is `GFilter`;
2. the final child is `Geometry`;
3. every prefix child is one of the schema-complete `GFilter`, `GLine`,
   `GArc`, `GPoint`, `GGroup`, or `GInstance` slots;
4. full FIFO replay and complete drawable-face coverage;
5. complete nested composition, no owner conflict, bounded storage/output, and
   containment in the independently decoded RVT element envelope.

`GCylindricalHelix` slot 2,244 and every unknown class remain excluded.
Starting with `GFilter` also excludes all 203 outer
`GInstance -> GFilter -> Geometry` column variants; those require the distinct
embedded-GElement association path.

## Exact UNBC result

Against the fixed 925-Tag route corpus:

| Measure | Result |
| --- | ---: |
| Complete owners before this route | 141 |
| Complete owners after this route | 553 |
| Owners within 0.5 ft of IFC AABB | 460 |
| Exact IFC triangle-count matches | 430 |
| Remaining incomplete owners | 372 |

Across the full production conversion:

| Measure | Before | After |
| --- | ---: | ---: |
| Complete placement owners | 7,529 / 7,805 | 7,714 / 7,805 |
| Native scene elements | 34,286 | 35,029 |
| Native triangles | 751,026 | 810,748 |
| Final triangles | 799,298 | 849,818 |
| Certified native IFC Tags | 35,006 / 36,144 | 35,762 / 36,144 |
| Half-foot IFC spatial parity | 34,984 / 36,144 | 35,669 / 36,144 |

The graph uses 270,036,692 estimated stored bytes, below the finite 320 MiB
collector cap. The browser implementation consumes the persisted topology and
uses its certified analytic face meshers. The native
`TB_Geometry`/`libTD_Ge`/`libTD_BrepBuilder`/`libTD_Br`/
`libTD_BrepRenderer` stack remains the behavioral reference for the solid
graph-to-triangle boundary; no native ELF code is shipped to or executed in
the browser.
