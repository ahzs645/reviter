# Revit 2027 GArc boundary

Source slot 2,213 is `GArc`. In the supplied UNBC model, two `SurfRev`
surfaces queue GArc profiles using numbered property tokens 56 and 57.

The class layout and both exact bodies were first proven in a separate audit.
The reviewed decoder is now also integrated into the shared Face-child replay,
which remains fail-closed for unknown descendants.

## Exact schema

The exact `Formats/Latest` source-name ladder maps slot 2,213 to `GArc`. Its
inherited schema is:

```text
GCurve, version 3
  m_endParams       fixed_array<float64, 2>

GArc, version 5
  m_xVec            fixed_array<float64, 3>
  m_yVec            fixed_array<float64, 3>
  m_radius          float64
  m_center          fixed_array<float64, 3>
  m_bFilled         bool
```

The exact offsets are:

| Record or field | Offset |
| --- | ---: |
| `GCurve` record | 236,372 |
| `GCurve.m_endParams` | 236,390 |
| `GArc` record | 262,858 |
| `GArc.m_xVec` | 262,874 |
| `GArc.m_yVec` | 262,892 |
| `GArc.m_radius` | 262,910 |
| `GArc.m_center` | 262,926 |
| `GArc.m_bFilled` | 262,946 |

`GArc` has raw inherited class ID 1,974, version 5, and five derived fields.
The inherited `GCurve` record has version 3 and one field.

## Independent native order

`TB_Format2026Readers.tx` provides the independently compiled reference
reader:

```text
GArc source 2173                        0x10c8372
  GCurve source 1932                    call 0x10c879d
    GNode source 1399                   call 0x10c70c9
    fixed endParams[2]
  x Vector3d                            call 0x10c8805
  y Vector3d                            call 0x10c8838
  radius double                         call 0x10c8863
  center Point3d                        call 0x10c888e
  filled bool                           call 0x10c88b9
```

Together with the 20-byte persisted `GInfo` prefix, the browser body is:

```text
GInfo                                  20 bytes
GCurve end parameters                  16 bytes
x/y vectors                            48 bytes
radius                                  8 bytes
center                                 24 bytes
filled flag                             1 byte
                                      --------
                                       117 bytes
```

The TypeScript decoder rejects other releases, truncated owner bounds,
non-finite fields, degenerate basis vectors, negative radii, and boolean
values other than zero or one. It does not inspect later bytes to choose its
width.

## Exact UNBC bodies

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-garc.ts model.rvt
```

Both bodies belong to element 245,109 in partition 325, chunk 3,492. The
unique audit locates the first GArc after 9,866 bytes following its Geometry
body and decodes:

| Body | Offset | End parameters | Radius |
| ---: | ---: | --- | ---: |
| 1 | 45,625..45,742 | π to 2π | 0.01968503937007874 |
| 2 | 45,742..45,859 | 0 to π | 0.01968503937007874 |

Both have x direction `[0, 0, 1]`, y direction `[-1, 0, 0]`, center
`[0.03937007874017287, 5.828670879282072e-16, 0]`, and `m_bFilled = false`.
The second body ends exactly at the independently bounded owner end. There is
no padding, scan, or inferred successor.

## Static-reference namespace

The older single-counter audit exposed apparent jumps including 208→209 and
431→434. The shared replay does not loosen the token rule to accept them. It
tracks positive `StaticInteger` references as reserved namespace indices and
accepts a forward property jump only when every skipped index was reserved
earlier.

On the exact model:

| Namespace evidence | Count |
| --- | ---: |
| static-reference reads | 664,379 |
| non-finite references | 0 |
| accepted reserved jumps | 5 |
| skipped reserved indices | 13 |
| jump widths | 1×2, 2×1, 3×1, 6×1 |
| later materialized reservations | 13 |
| repeated property aliases | 0 |

Reader, route, and boundary failure maps are empty. The shared replay now
decodes both source-2,213 descendants, completes all 5,996 owner scopes, and
retains the strict namespace rather than skipping unexplained tokens.

## Remaining boundary

Persisted analytic GArc recovery completes this specific `SurfRev` profile
chain. It does not yet generate the revolved face. That requires evaluating
the curve and surface, assembling trim topology, and tessellating it with
browser-side behavior equivalent to the contracts exposed by `TB_Geometry`,
`libTD_Ge`, `libOdBrepModeler`, and `libTD_BrepBuilder`/`libTD_Br`.
