# UNBC RVT to IFC export validation — 2026-08-02

## Outcome

Reviter now exports the recovered UNBC RVT model as an IFC4 Reference View model rather than a collection of generic bounds proxies. The full 162 MB sample opens in both `web-ifc` and IfcOpenShell. IfcOpenShell reports no schema, reference, or IFC4 EXPRESS-rule violations.

The exporter carries only evidence recovered from the RVT. It does not infer an Autodesk-style parametric representation where the parser has only tessellation or reconstructed geometry. `Reviter_Recovery` properties on every native-tagged occurrence state the geometry source, final provenance, source record, and whether the geometry is exact.

## Full-model comparison

| Measure | Reviter IFC4 export | Existing Autodesk IFC2X3 |
| --- | ---: | ---: |
| IFC elements | 44,009 | 41,312 |
| Products with readable geometry | 39,846 | 39,355 |
| Triangles read by `web-ifc` | 961,316 | 934,123 |
| Source triangles before degenerate-face filtering | 968,548 | — |
| Revit numeric tags | 42,063 | 38,187 |
| Tags with native Revit `UniqueId` | 41,709 | 38,187 |
| Building storeys | 12 | 13 |
| Material definitions | 69 | 30 |
| Exact comparable native material assignments | 34,992 | 34,979 |
| Exact decoded type names | 7,523 | 7,515 |
| Exact decoded family names | 2,245 | 2,235 |

`web-ifc` drops degenerate faces while constructing render geometry. The IFC STEP source contains all 968,548 triangles owned by the recovered scene; the 7,232-face difference is reader filtering rather than exporter loss.

The generated IFC spans 217.898923 × 19.400000 × 375.120452 metres. The recovered GLB has the same spans to sub-micrometre precision. The Autodesk IFC spans 217.898927 × 19.400000 × 374.766331 metres, leaving a localized 0.354121 metre long-axis recovery difference that is already visible in the wider three-source overlay.

## Category comparison

| IFC class | Reviter export | Existing Autodesk IFC | Interpretation |
| --- | ---: | ---: | --- |
| Walls | 9,364 | 7,521 | Autodesk splits `IfcWall`/`IfcWallStandardCase` and omits suppressed/context wrappers differently. |
| Members | 20,060 | 19,707 | Includes native structural framing, mullions, top rails, balusters, and stair stringers. |
| Railings | 215 | 229 entities / 215 Revit tags | Native tagged railing parity is exact. |
| Plates | 6,247 | 6,235 | Curtain panels and plates are nearly identical. |
| Columns | 312 | 311 | One additional recovered occurrence. |
| Doors | 1,936 | 1,912 | Identity coverage is broader; Autodesk door bodies remain more detailed. |
| Stair flights | 108 | 121 entities / 108 Revit tags | Tagged flight count is exact; Autodesk has extra aggregate representation items. |
| Slabs | 94 | 161 entities / 107 Revit tags | **Not a gap — see below.** All 94 match by `Tag`; the 13 unmatched Autodesk tags are 12 Revit Roofs and one ramp landing that this exporter writes under their own class. |
| Coverings | 46 | 46 | Exact count parity. |
| Windows | 22 | 20 | Two additional recovered occurrences. |
| Openings | 1,932 | 3,071 | Reviter emits only persisted host relationships; it does not synthesize unsupported voids. |

The 3,615 `IfcBuildingElementProxy` occurrences are deliberate. They retain recovered, tagged geometry whose native category is unresolved or whose category has no safe IFC product mapping. Of those, 3,045 carry geometry. Reclassifying them without new RVT evidence would make the file look more complete while reducing its reliability.

The Autodesk file also contains 1,835 non-geometric curtain-wall containers and 92 stair containers. Reviter suppresses most duplicate wrappers in the display scene and exports their visible panels, mullions, runs, and railings. Container counts are therefore not direct geometry-loss measures.

## IFC content now exported

- IFC4 project, site, building, and recovered storey hierarchy.
- Stable deterministic IFC GUIDs derived from native model identity and Revit element identity.
- Per-element `IfcTriangulatedFaceSet` bodies; explicit bounds solids only when no recovered mesh exists.
- Native category-to-IFC class mappings, including walls, slabs, roofs, coverings, doors, windows, columns, members, plates, stairs, flights, railings, ramps, foundations, and furniture.
- Revit type objects and occurrence-to-type relationships.
- Native material definitions, direct assignments, constituent sets, and wall/slab compound layer sets and usages.
- Revit element IDs, `UniqueId`s, decoded parameters, type/family identity, category evidence, geometry provenance, and source-record locations.
- Persisted door/window host relationships as `IfcRelVoidsElement` and `IfcRelFillsElement`, without invented opening geometry.
- Honest tagged or anonymous context proxies for geometry that cannot safely be classified.

## Remaining fidelity work

The exporter is standards-valid and faithful to the current recovered scene; it cannot exceed the geometry the RVT parser has recovered. The main remaining source-recovery gaps are stair-flight shape/attachment, detailed door bodies, a minority of wall dimensions, the 0.354 metre localized extent difference, one missing storey interpretation, and additional persisted opening relationships. Curtain-wall and stair wrapper aggregation can be added later without changing visible geometry.

Large IFC creation is currently synchronous in the browser. The 162 MB UNBC output should next move to a worker or streaming writer so saving it cannot pause the interface. That is an export-performance improvement, not a file-correctness blocker.

## Reproduction

```sh
node --experimental-strip-types scripts/extract-geometry.ts \
  "/path/to/model.rvt" --out /tmp/model.ifc

node scripts/audit-ifc-parity.mjs \
  --ifc /tmp/model.ifc \
  --semantic /tmp/model.json \
  --glb /tmp/model.glb \
  --json /tmp/model-ifc-parity.json

python -m ifcopenshell.validate --rules --json /tmp/model.ifc
```



## Addendum: the slab count is a class difference, not a recovery gap

The row above read as "floor/landing recovery remains incomplete" and was
carried downstream as a high-severity gap. It was drawn from an entity count
without doing the `Tag` join. Joined:

- All **94** exported `IfcSlab` Tags exist in the Autodesk file; none is spurious.
- The **13** Autodesk slab Tags not exported as `IfcSlab` are **12 Revit Roofs**
  (written here as `IfcRoof`; Autodesk writes an `IfcRoof` container plus N
  `IfcSlab(.ROOF.)` parts sharing the parent Tag) and **one ramp landing**
  (kept inside this exporter's `IfcRamp`; Autodesk splits it out as
  `IfcSlab(.LANDING.)`).
- Revit **Floors are 68 of 68**. Landings are 26 of 27, the 27th being the ramp's.
- Bounding boxes of the 94 matched agree on every face to under 0.05 m; plan
  footprints of the 12 roofs agree to 0.7%.
- Counting distinct Tags across `IfcSlab` + `IfcCovering` + `IfcRoof` +
  `IfcRamp`, this export has **182 floor-class elements against Autodesk's 172**.
- Independently of `Tag`, rasterising every near-horizontal face at 0.1 m into
  half-metre bands: **99.92%** of Autodesk's standable surface is reproduced
  within half a metre. 87 sq m of 103,935 is genuinely absent (0.084%),
  scattered, and dominated by ramp slopes and raster edges.

`IfcSlab` entity counts are not comparable between producers: one decomposes a
roof into parts and one does not, and one calls a ramp landing a slab and one
does not. Compare Tags across the floor classes.
