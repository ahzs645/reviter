# Native tessellation policy recovered for the browser

Reviter now has a browser-safe TypeScript replay of the smallest independently
verified tessellation-policy subset in the supplied native Revit/ODA geometry
stack. It does **not** load those Linux binaries, copy their tessellator, or
claim to decode the proprietary modeler-body format. It reconstructs the
numeric policy that a future analytic or neutral-BRep tessellator can consume.

The implementation is
[`native-tessellation-policy.ts`](../lib/reviter/native-tessellation-policy.ts);
its boundary tests are
[`native-tessellation-policy.test.ts`](../tests/native-tessellation-policy.test.ts).

## Proven native sources

The exact-build evidence is:

| Binary and symbol | RVA | Recovered behavior |
| --- | ---: | --- |
| `TB_Database.tx`, `OdBmModelerGeometryImpl::setLevelOfDetail(double)` | `0x221a9fc` | LOD clamp/domain, scale-dependent maximum edge, piecewise surface deviation, uint16 formula |
| `libTD_BrepRenderer.so`, `wrTriangulationParams::wrTriangulationParams(bool)` | `0x117434` | 51-byte parameter defaults and offsets consumed below |
| `libTD_BrepRenderer.so`, `wrPlane::calculateMaxStepUV` | `0x126b40` | plane U/V maximum step |
| `libTD_BrepRenderer.so`, `wrCylinder::calculateMaxStepUV` | `0x1645c6` | normalized axial and angular cylinder maximum steps |
| `libTD_BrepRenderer.so`, `SrfTess::findBreakDirection` | `0x1a3c9e` | adaptive use of edge, angle, and surface-deviation limits |

The relevant parameter offsets in this build are:

- `+8`: maximum edge length;
- `+16`: maximum angle in degrees;
- `+24`: surface deviation;
- `+40`: a `uint16` derived from LOD.

The downstream meaning of `+40` is not proved. The TypeScript value is therefore
named `nativeWord40`, retained for comparison, and not used to manufacture
behavior.

## Exact formulas implemented

For a normalized level of detail `l` and the tessellated body's bounding-box
diagonal `d`, the native method writes:

```text
maximumEdgeLength = 10 d / (50 l + 1)

surfaceDeviation =
  -0.1998 l + 0.09998        when 0 <= l < 0.5
  -0.000198 l + 0.0001988    when 0.5 <= l <= 1

nativeWord40 = trunc(44 l² + 4 l + 2)
```

The exact branch at `0.5` matters. It produces `0.0000998`, while the limit from
the lower branch is approximately `0.00008`; the implementation and tests
preserve this discontinuity.

For a plane, both maximum parameter steps are:

```text
maximumEdgeLength / sqrt(2)
```

For a cylinder of radius `r`, native U is axial distance normalized by `r` and
native V is angle in radians:

```text
maximumUStep = abs(maximumEdgeLength / r) / sqrt(2)

edgeVStep = 2 asin(maximumEdgeLength / (2 r)) / sqrt(2)
            when abs(maximumEdgeLength / (2 r)) <= 1

angleVStep = clamp(2 pi maximumAngleDegrees / 360, 0, 2 pi)

maximumVStep = minimum active edge/angle step
```

Zero is the native inactive/no-limit sentinel. Browser arc subdivision fails
closed when every limit is inactive rather than treating zero as permission to
create an unbounded or arbitrary mesh.

`SrfTess` adaptively compares surface deviation as well. For a circle, Reviter
uses the conservative closed-form chord bound:

```text
deviationVStep = 2 acos(1 - surfaceDeviation / r)
```

This is the same geometric midpoint-deviation condition, not a claim that
Reviter reproduces the renderer's triangle order or all recursive split choices.

## UNBC/IFC measurement before scene integration

The exact local RVT conversion recovers 32 analytic arc walls. The corresponding
32 numeric Revit Tags all exist as drawable `IfcWallStandardCase` products in
the supplied IFC.

| Policy | Arc segments | Reviter arc-wall triangles | Share of the same IFC products |
| --- | ---: | ---: | ---: |
| Existing 5.625° browser profile | 607 | 4,984 | 102.0% |
| Paired IFC | — | 4,888 | 100.0% |
| Native formula, LOD 0 | 183 | 1,592 | 32.6% |
| Native formula, LOD 0.25 | 251 | 2,136 | 43.7% |
| Native formula, LOD 0.5 | 5,222 | 41,904 | 857.3% |
| Native formula, LOD 0.75 | 7,353 | 58,952 | 1,206.1% |
| Native formula, LOD 1 | 58,200 | 465,728 | 9,527.2% |

The LOD runs use each recovered record's own bounding-box diagonal. Their large
range shows why choosing an undocumented Revit view/export LOD would be a new
guess, not recovered fidelity. Global triangle equality is not the geometry
acceptance criterion, but changing a close, bounded arc representation to a
policy that is 0.33× or 95× its paired IFC population is not justified either.

`scene.ts` therefore remains unchanged. Routing its existing 5.625° display
profile through the native calculation would only re-express the same browser
choice, while selecting a fixed native LOD would pretend the unknown
view/export policy had been recovered. The isolated policy is ready for the
general analytic/BRep path once that selection is independently established.

## What this unlocks, and what remains missing

This increment provides:

- deterministic LOD, plane, cylinder, and circular-deviation calculations;
- finite-domain checks and bounded segment counts suitable for untrusted files;
- a policy module independent of RVT record decoding and rendering;
- an evidenced analytic-cylinder path already exercised by the UNBC model.

It does not yet provide:

- decoding of arbitrary persisted modeler bodies into the neutral BRep graph;
- trimmed cylinders, cones, tori, or NURBS faces in the general BRep
  tessellator;
- native recursive surface split parity or triangle ordering;
- full family regeneration;
- per-face material recovery for bodies whose face markers remain undecoded.

Those are data-decoding and topology tasks. The policy now exists for them, but
it does not make unsupported geometry silently appear.
