# Revit 2027 `GPolyLine`: certified FIFO body

This note records the bounded browser-side reader for source-class slot 2,276
in the supplied UNBC Revit 2027 model. It is a curve extraction increment, not
a triangle-parity claim and not a substitute for the native solid-modeling
kernel.

## Release and native evidence

The model's `BasicFileInfo` reports Revit 2027 and build
`20260417_1515(x64)`. Its release schema identifies source slot 2,276 as
`GPolyLine`.

The available Revit 2026 native direct reader supplies an independent
field-order witness:

- file: `TB_Format2026Readers.tx`
- size: 42,423,088 bytes
- SHA-256:
  `09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f`
- symbol:
  `CustomDirectReader<version2026 slot 2236, OdBmGPolyLine>::read`
- measured RVA: `0x10e737a`
- call order: inherited `GNode/GInfo`, `Point3d` collection,
  `setCoordinates`, `OdGeExtents3dReader<double>`, `setExtents`, boolean
  reader, `setIsFilled`

The 2026 module is corroboration only. The 2027 schema and exact 2027 payload
measurements authorize the release-gated reader.

## Exact UNBC result

Run:

```sh
node --experimental-strip-types scripts/audit-revit-2027-gpolyline.ts \
  "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

The audit finds:

- 3,666 partition chunks and zero failed chunks;
- 232 outer slot-2,276 descriptors;
- all 232 are the first child of the exact four-child queue
  `2276,1973,1973,2221`;
- all 232 bodies decode at the dynamic FIFO head;
- every body contains five finite points and is exactly 193 bytes;
- every stored extent exactly equals the coordinate bounds;
- every polyline is closed, yielding 928 explicit line segments;
- every `filled` flag is false;
- every style id is 145 and every geometry tag is `-1`;
- the count-derived endpoint leaves exactly 212 bytes for the three following
  queued children in every frame.

The body grammar is therefore:

```text
GInfo                         20 bytes
coordinate count             4-byte signed little-endian integer
coordinates                  count × 3 × float64
stored extents               6 × float64
filled                       strict 0/1 byte
```

`decodeRevit2027GPolyLine` returns its count-derived endpoint. It does not
claim the remainder of the enclosing `GRep` payload, and it rejects the wrong
release, invalid limits, truncation, non-finite points, invalid extents, and
non-boolean fill flags.

## Geometry and IFC consequence

These records expose 232 exact closed curve loops that were previously opaque.
They do not add triangles: `filled` is false, the records have no face
topology, and their geometry tags are `-1`. Promoting them to solid faces
would be an invented semantic.

The remaining triangle gap still requires an owned Revit 2027 body reaching
the actual B-rep or mesh nodes and the complete transform/material chain.
Native `TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`,
`libTD_BrepBuilder`/`libTD_Br`, and `libTD_BrepRenderer` show the architecture:
parametric topology is evaluated and tessellated before a viewer receives
triangles. They are evidence for the browser tessellator contract, not
browser-callable dependencies and not permission to guess a body layout.
