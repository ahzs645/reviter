# UNBC stored faceted-topology probe

This note records a clean-room, executable probe of the exact local UNBC RVT:

```text
UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt
70,336,512 bytes
SHA-256 8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178
```

No ODA code is executed. The probe uses Reviter's browser-safe CFB,
checksum-page, DEFLATE, and schema readers.

## What is now implemented

`lib/reviter/faceted-topology.ts` decodes already-located topology fields into
a neutral indexed mesh. It supports:

- little-endian float32 and float64 points;
- a separately supplied point offset, matching the native
  `OffsetFloatFacetedTopology` contract;
- little-endian unsigned-16 and signed-32 triangle indices, range-checked and
  widened to `Uint32Array`;
- common, per-vertex, and per-corner normals;
- opaque edge-visibility bytes;
- strict allocation, byte-range, coordinate, index, and unit-normal checks;
- explicit reporting of repeated-index triangles.

It intentionally does not search arbitrary bytes for a mesh. The outer RVT
object and nested-array framing must be supplied by a future, corroborated
record locator.

`scripts/probe-faceted-topology.ts` inventories the exact file schema and scans
every inflated partition byte pair for schema-defined topology tags, comparing
each with its neighbouring numeric controls. It labels these as raw token
occurrences, not records.

`scripts/probe-counted-topology.ts` makes the complementary selector-free
measurement. It tests every plausible signed 32-bit count as the start of
adjacent point and triangle arrays in the four storage layouts evidenced by
the schema. Candidates must have finite, bounded coordinates that span model
space, in-range indices, and at least one geometrically nondegenerate triangle.
It also reports, but does not require, a following counted edge-visibility
array.

## Native and file-schema agreement

The native symbol evidence divides the stored mesh contract as follows:

| Contract | Symbol/schema evidence |
| --- | --- |
| Point storage | `FloatFacetedTopology`, `DoubleFacetedTopology`, `m_pointsArr` |
| Origin-relative points | `OffsetFloatFacetedTopology`, `m_offset` |
| Index width | even `FacetedTopology` variants take unsigned-short facets; odd variants take integer facets |
| Normals | `m_normalsFlag`, `m_commonNormal`, `m_normalsArr` |
| Edge visibility | variants 8–13 and later expose `m_edgeVisFlagsArr` |
| Texture coordinates | newer variants expose `m_UVStorage` |
| Mesh attachment | `GPolyMesh` carries `m_pFacetedTopology` |
| Material/style | `m_materialID`, `m_interiorGStyleID`, `m_polyMeshFlags` |

The UNBC `Formats/Latest` stream is 513,948 inflated bytes. It contains 17
tagged faceted-topology classes and 23 related class references. The exact
corroborated field strings are:

```text
m_commonNormal
m_edgeVisFlagsArr
m_facetsArr
m_interiorGStyleID
m_materialID
m_normalsArr
m_normalsFlag
m_offset
m_pFacetedTopology
m_pointsArr
m_polyMeshFlags
m_UVStorage
```

The file defines the older storage families and aliases newer release variants
to them. Native `TB_Main.tx` symbols additionally expose variants 16–45 and
their UV-storage accessors. This is sufficient to define the neutral field
types, but not sufficient to locate their length-prefixed nested arrays in a
partition object.

An important negative result is that the schema entry for `GPolyMesh` is a
reference with value 1426. The same value is used by `GBRep`, `GFakeBRep`, and
is actually defined by `GEdgeBase`. These are scoped aliases rather than
globally unique record markers. Treating 1426 as a GPolyMesh record marker
would therefore be false.

Static analysis of the native readers closes the primitive framing question:

- `OdBmObjectPtrInitReader::read` reads a signed little-endian `int16` when it
  must select a class;
- `OdBmCollectionReader<OdArray<T>>::read` reads one signed little-endian
  `int32` only for a dynamic (`-1`) collection count;
- `ItemModeProcessorReader<int>::read` dispatches primitive modes 0/6 directly,
  uses the schema `getSize` value for fixed tuples, and uses the dynamic
  collection reader for mode 5.

There is therefore no evidence for an extra per-item token between a PArray
count and its fixed-width tuple values.

## Full UNBC partition measurement

The probe scanned the only partition stream, `Partitions/325`:

| Measure | Count |
| --- | ---: |
| Stored partition bytes | 68,999,154 |
| Bytes after checksum-page removal | 68,626,033 |
| Gzip chunks | 3,666 |
| Chunks inflated in this run | 3,666 |
| Inflated partition bytes | 421,867,755 |
| Adjacent byte pairs scanned | 421,864,089 |
| Rolling body window | 3 inflated chunks |
| Validated topology record boundaries | 0 |
| Meshes emitted from stored topology | 0 |

Raw little-endian u16 tag counts are:

| Tag | Schema class | Raw hits | `tag | 0x8000` hits | Chunks | Neighbour median | Ratio |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1381 | `DoubleFacetedTopology` | 1,564 | 379 | 438 | 1,469 | 1.065 |
| 1382 | `FloatNormalsFacetedTopology` | 1,283 | 940 | 517 | 1,469 | 0.873 |
| 1383 | `FacetedTopologyImpl` | 1,511 | 471 | 461 | 1,282 | 1.179 |
| 1387 | `DoubleTinyFacetedTopology` | 1,169 | 761 | 454 | 1,167 | 1.002 |
| 1869 | `FacetedTopology0` | 540 | 1,131 | 331 | 806.5 | 0.670 |
| 1871 | `FacetedTopology0t` | 940 | 639 | 425 | 810 | 1.160 |
| 1874 | `FacetedTopology10` | 883 | 535 | 442 | 819 | 1.078 |
| 1875 | `FacetedTopology2` | 978 | 677 | 418 | 833 | 1.174 |
| 1877 | `FacetedTopology10t` | 1,000 | 262 | 392 | 838.5 | 1.193 |
| 1878 | `FacetedTopology2t` | 820 | 535 | 431 | 838.5 | 0.978 |
| 1880 | `FacetedTopology11` | 1,247 | 546 | 411 | 875 | 1.425 |
| 1882 | `FacetedTopology12` | 1,339 | 462 | 451 | 844 | 1.586 |
| 1884 | `FacetedTopology12t` | 1,754 | 320 | 449 | 875 | 2.005 |
| 1886 | `FacetedTopology13` | 1,243 | 293 | 409 | 908.5 | 1.368 |
| 1899 | `FacetedTopology24` | 854 | 394 | 451 | 938 | 0.910 |
| 1901 | `FacetedTopology24t` | 812 | 376 | 421 | 873.5 | 0.930 |
| 1903 | `FacetedTopology25` | 632 | 424 | 382 | 938 | 0.674 |

These values are broadly dispersed across hundreds of chunks. Seven tagged
values occur no more often than their neighbouring controls; the strongest is
only 2.005 times its local median. Some first hits also occur in a close run of
different topology values in the same chunk. The counts therefore do not
establish a record marker or field boundary. Promoting them directly into
meshes would produce false positives.

`scripts/probe-schema-fields.ts` additionally tested both signed reference and
high-bit definition forms for the simplest float/u16 topology, plus the
offset-topology selectors. It performs a bounded 0–16 byte prefix robustness
scan and validates candidate counts, finite coordinates, and index ranges. Its
rolling three-chunk window also rules out the earlier diagnostic weakness where
a valid body might merely cross one inflated-chunk boundary. It found zero
structurally valid bodies at raw selector-like byte hits. This does not mean
the model has no stored meshes; it shows that raw two-byte values are not a
safe substitute for the outer reader's scoped class context.

### Selector-free counted-array result

The selector-free probe tested 64,956,699 plausible count offsets. It found
exactly three strict adjacent float32/u16 point-and-triangle bodies and no
float32/int32, float64/u16, or float64/int32 bodies:

| Chunk / offset | Vertices | Triangles | Used vertices | Degenerate | Point bounds | Following edge bytes |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| 2953 / 38,703 | 144 | 144 | 144 | 0 | `(437.943, 307.156, 0)`–`(525.709, 720.612, 0)` | count 144, matches triangles |
| 3002 / 3,258 | 20 | 26 | 20 | 0 | `(294.075, 145.946, 0.167)`–`(294.736, 146.134, 0.398)` | count 26, matches triangles |
| 3169 / 10,944 | 104 | 104 | 104 | 0 | `(277.741, 87.273, 0)`–`(352.227, 136.434, 0)` | count 104, matches triangles |

These bodies are substantially stronger evidence than raw tag hits:

- every vertex is referenced;
- every triangle is in range and geometrically nondegenerate;
- the first facets use ordinary indexed-mesh patterns such as
  `(0,1,2)`, `(1,3,2)`, `(2,3,4)`;
- all three are immediately followed by a signed 32-bit count equal to the
  triangle count and exactly that many plausible edge-visibility bytes.

They are therefore described as **corroborated counted mesh bodies**, but not
as topology records. A three-chunk neighbourhood check found none inside the
length-echoed element envelope. The bytes after two bodies begin separate
geometry-shaped tables, while the first continues into additional fields.
That is consistent with geometry being stored below an outer `GRep`/`GNode`
reader rather than inline in the element envelope.

The reference IFC does not provide a shortcut around that boundary. A
diagnostic comparison of sorted per-triangle edge-length triples found no
matches at the native scale, Revit's feet-to-metres scale, or the common
decimal scales tested. These may be view/display meshes, may require an outer
transform, or may be tessellated differently from the IFC. Without the outer
reader there is no defensible owner, transform, material/style ID, or proof
that any body belongs in the exported 3D model, so Reviter still emits none.

## Precisely bounded missing work

The remaining blocker is narrower than “implement tessellation,” but still
real:

1. Locate the outer geometry object and reproduce its scoped class-resolution
   context, including how aliases such as 1426 resolve to `GPolyMesh`, `GBRep`,
   or another geometry class at that field.
2. Use the now-corroborated dynamic-count and fixed-tuple framing to slice
   `m_pointsArr`, `m_facetsArr`, normals, UV storage, and edge flags.
3. Determine whether a facet row is always a triangle in this release or can
   contain a polygon that must be triangulated.
4. Associate the containing `GPolyMesh` with its element/geometry marker,
   transform, material ID, and style ID.
5. Feed only those validated field slices to
   `decodeFacetedTopologyFields`.

The primitive body problem is now partly solved: three counted mesh bodies are
located and validated. Until steps 1–4 have independent structural checks, the
measured correct conversion result remains zero native stored meshes—not an
ownerless vertex cloud.

## Reproduce

```sh
node --experimental-strip-types scripts/probe-faceted-topology.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"

node --experimental-strip-types scripts/probe-schema-fields.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"

node --experimental-strip-types scripts/probe-counted-topology.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"

node --experimental-strip-types --test tests/faceted-topology.test.ts
npx tsc --noEmit --pretty false
```

The decoder tests cover float64/int32 topology, offset-float/u16 topology,
normals, edge bytes, degenerate indices, truncation, invalid indices,
non-finite coordinates, and allocation caps.
