# Optional IFC representation maps

`makeIfc(result, { reuseMappedGeometry: true })` can emit one
`IfcRepresentationMap` and translated `IfcMappedItem` occurrences for repeated
native tessellations. The default export stays unchanged. This adapts the
IFC-21 writer structure in `helenkwok/rvt-rs` at
`1c3d337dbd2a6810e9dfad68fe99857843d67387`,
`src/ifc/step_writer.rs` (map emission around 1649 and mapped instances around
1919). Its `src/ifc/share.rs` is viewer URL sharing; that is a separate feature.
The upstream `from_decoded.rs` default model still initializes an empty map
collection, so this port implements writer support using Reviter's own scene
proof rather than relying on an upstream geometry-sharing heuristic.

Sharing requires a declared native `typeId` without conflicting source records,
a positive triangle owner, `native-brep` geometry, identical ordered indices,
identical ordered vertex positions relative to the first vertex, and identical
material indices for every fragment. A hash only selects comparison candidates;
the full arrays must still agree within the floating multiplication/subtraction
noise introduced by feet-to-metres conversion. Nearly identical vertices,
mirrors, different topology and proxy/reference bodies do not qualify. It does
not use family/type names, bounds, or paired exports to decide that bodies match.

The map's origin is identity. Each occurrence's mapping target carries its
translation in metres, while its existing product placement continues to carry
the model origin. Geometry is emitted once in the map's local coordinates;
styles remain attached to the original tessellated face sets. The scene arrays,
identity/type relations, owner tags and recovery claims are unchanged. This
version reuses translations only; rotation, scaling and source profile/solid
reconstruction remain outside its scope.

Comparison work is capped at four million candidate vertices and 200,000 owners.
A bucket with sixteen distinct colliding geometry candidates stops admitting
new candidates. Geometry outside these limits uses the ordinary exporter.

Validation uses a positive asymmetric 16-instance fixture. `web-ifc` recovers the
same world-space triangles, per-owner counts and materials; an independent
`@ifc-lite/parser` opens the mapped IFC4 entity graph. Refusal tests cover changed
vertices/topology/materials/types, conflicting type records, proxies and unowned
bodies. Real-model runs compare both IFC exports from one conversion, reopen all
geometry with `web-ifc`, and compare every tagged owner's counts, world bounds
and materials plus total triangles. These checks measure exporter preservation,
not equivalence to Autodesk's chosen export view.

Reproduce with:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  --test tests/export-ifc-mapped-geometry.test.ts
node --max-old-space-size=6144 --experimental-strip-types \
  --import ./scripts/register-test-typescript.mjs \
  scripts/audit-ifc-mapped-geometry.ts /path/model.rvt \
  --json /path/model-mapped-audit.json --out-dir /path/exports
```

The measured model results are recorded in
[`generated/rvt-mapped-geometry-validation.json`](generated/rvt-mapped-geometry-validation.json).
Exact matching may find no reusable bodies in a model whose translated vertices
have already been independently rounded into Float32 arrays; no compression is
claimed for such a model.
