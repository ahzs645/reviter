# Registering the Autodesk GLB, and where the stair waist is not — 2026-08-13

Two questions, both settled by measurement on the supplied UNBC sources, pinned
by SHA-256 and identical to the ones the
[three-source audit](unbc-three-source-audit-2026-08-01.md) uses:

- RVT `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`
- IFC `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
- Autodesk GLB `8ee1b2c3ba8069e0553c1e79c52d1a3bc112f64c5bc7e2f4568e0c8a8430facb`

Nothing here changes the converter. The first half is a measuring tool that had
been giving wrong answers; the second is a feature that cannot be built, and the
evidence for why.

## 1. The GLB sits in Revit world feet under one translation

The reference is Y-up metres, and it declares `KHR_mesh_quantization` as a
*required* extension: `POSITION` is `componentType` 5122 with `normalized: true`,
so the stored int16s are a fraction of 32767 rather than coordinates. Reading
them raw puts the building **12,796,792 ft** across. With the normalisation
applied and the node transforms composed, the axis map to Revit's frame is

```text
(x, y, z)_glTF  ->  (x, -z, y) * 3.280839895
```

and the scene is then 714.89 × 1229.55 × 63.65 ft, against 709.4 × 1231.7 × 62.3
for the recovered records. Sizes agree; the frames do not, and the offset is

| axis | offset (ft) |
| --- | ---: |
| x | **-5.38** |
| y | **287.63** |
| z | **23.95** |

### How it was fitted, and why the earlier fits were wrong

Three methods were tried before one produced evidence that could be checked.

| method | result | why it was rejected |
| --- | --- | --- |
| bounding-box centres | -4.2, 285.75, 23.95 | the recovered extent is not the reference's extent; the two mins and maxes disagree by 5.5 ft, so the centre is a guess with no error bar |
| horizontal-plane elevations vs door base elevations | z 23.95 | correct, and **silent on x and y** — a plan shift does not move a horizontal plane, so this method cannot see two of the three unknowns |
| plan-occupancy overlap | 1.5, 289.5, 23.95 | scored 79.9% "hits", which reads as a lock and is not one: a coarse footprint mask scores well anywhere inside a wide basin, and this peak is 6.9 ft off in x |

What works is pairing whole elements by size. A reference part and a recovered
record whose axis-aligned bounds agree to 0.01 ft on all three axes are very
likely the same object, and the difference of their centres is then one vote for
the translation. If a rigid translation exists the votes stack in one bin; if it
does not, nothing stacks.

**1,642 pairs agree in a single 0.01 ft bin.** The next distinct offset holds
122, and it differs only in z — same-sized elements one storey apart.

The axis map is forced by the same vote rather than assumed:

| mapping | best bin | pairs |
| --- | --- | ---: |
| `y = -z` | -5.38, 287.63, 23.95 | **1,642** |
| `y = +z` | -5.38, 20.19, 23.95 | 17 |

### The controls

Applying the offset and asking how many recovered elements contain reference
triangles inside their own box, against deliberate displacements of the same
measurement:

| offset | doors | curtain panels | mullions | all opening records |
| --- | ---: | ---: | ---: | ---: |
| **fitted** | **98.2%** | **16.7%** | **24.9%** | **28.2%** |
| the rejected plan-occupancy fit | 56.8% | 4.5% | 1.9% | 6.4% |
| fitted, x + 25 ft | 35.6% | 5.0% | 2.5% | 5.4% |
| fitted, y + 25 ft | 44.0% | 9.2% | 5.3% | 8.9% |
| fitted, z + 10 ft | 44.1% | 15.3% | 11.2% | 14.5% |
| fitted, x - 3 ft | 77.7% | 10.6% | 5.9% | 12.0% |

The 3 ft control is the useful one: a door is 3.5 ft wide, so a 3 ft shift still
overlaps most doors and still scores 77.7% on them — while collapsing to 12.0%
across all elements. A door-only score is not evidence of registration.

The absolute numbers below 100% are not error. The reference is a derivative
with 16,203 parts for the project's 40,571 elements, so most recovered elements
have no part of their own to match; the 28.2% is what survives that merging, not
a measure of agreement.

### What this corrects

Any earlier claim resting on overlaying the GLB on the recovery was measured
under a wrong offset and should be re-derived. Claims about the *IFC* are
unaffected: the paired export is already in Revit world feet, which
[the stair work](#2-the-stair-waist-is-not-in-the-file) relies on and which the
element bounds confirm to the decimal.

One earlier finding survives because it never used the registration: searching
the reference for parts shaped like a door leaf — 6.3–7.8 ft tall, under 1.6 ft
deep — returns 428 of them with a **median of 12 triangles**, which is a box.
Re-measured now under the verified offset, counting reference triangles inside
each door's own box: 1,887 of 1,921 doors have some, and the median is **9**.
Reviter draws a door as a 12-triangle box of its own. The reference is not
carrying door detail this recovery is missing.

## 2. The stair waist is not in the file

81 of the model's 107 reconstructed stair runs are recovered as a stack of tread
slabs where the export writes a monolithic body with a sloped waist beneath, and
they reach 70.8% of their export's silhouette against 95.1% for the 26 terraced
runs. The obvious next move is to read the waist thickness and extrude it. It
cannot be read, because it is not written.

**The run aggregate does not carry it.** `extendBelowBaseFeet` and
`extendBelowTreadBaseFeet` are decoded for all 108 runs and are **0.0000 for
every one of them**. `leftStringerWidthFeet` and `rightStringerWidthFeet` are
0.1640 ft on every run without exception — a constant, which is what currently
becomes `stairTreadThicknessFeet`.

**The type parameters are absent from the whole container.** Scanning every
inflated chunk of `Partitions/325` for each id written as the sign-extended
int64 the parameter tables use, and separately scanning every other stream both
raw and inflated:

| parameter | id | occurrences |
| --- | ---: | ---: |
| Monolithic Support | -1151401 | 0 |
| Underside Surface | -1151402 | 0 |
| Structure | -1151403 | 0 |
| **Structural Depth** | **-1151404** | **0** |
| Total Depth | -1151405 | 0 |
| Structural Depth (landing type) | -1151805 | 0 |
| Total Depth (landing type) | -1151806 | 0 |
| Structural Depth On Run | -1151809 | 0 |
| Structural Depth On Landing | -1151810 | 0 |
| Extend Below Tread Base | -1151323 | 0 |
| *Stairs Run Type* | *-1151207* | *1* |
| *Monolithic Stairs (legacy)* | *-1007255* | *1* |

The last two rows are the positive control: the scanner does find ids that are
present, and it finds exactly the two that `probe-stair-type-params.ts` already
reports, at the same chunk and offset. `collectElementParameters` decodes 20,524
tables in this file and none of them carry any of the ten.

The container has one partition stream, so this is the whole element payload
rather than a sampled part of it.

**Consequence.** A waist drawn from this file would be a thickness Reviter chose,
not one Revit wrote, on 81 runs at once. That is the kind of invention the
monumental-run rule already refused when extruding terraced blocks to the base
added surface the reference does not have. The gap stays open and stays
described. If it is to be closed, the evidence has to come from somewhere else —
the paired export, through the existing reference-assisted route — and not from
a number fitted to make the silhouette match.
