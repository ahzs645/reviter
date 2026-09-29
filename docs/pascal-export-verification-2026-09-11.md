# Pascal export and additional native recovery — 2026-09-11

**Browser follow-up:** RAC and Technical School were subsequently loaded and
visually checked in the supplied Pascal application through the in-app Browser.
RAC selection and mesh-edit mode worked; Technical School orbit worked. UNBC
passed the UI import preview but **crashed the Browser page after confirmation**.
The full UNBC export is not verified as usable in this Browser. See the
[actual editor check](../work/pascal-followup/editor-browser-check.md).

The Pascal export now has a geometry-preserving mode. It was checked through the
validator, scene loader, and block renderer in the supplied
`/Users/ahmadjalil/Downloads/editor-main` source. RAC and Technical School pass
our declared 0.01 mm positional tolerance against their originating Reviter
GLBs. UNBC's rendered triangles also meet that tolerance, but Pascal omits 33
nonzero-area slivers wider than the tolerance, so its strict check **fails**.
No model has an identical triangle count after Pascal's triangulation.

This is an export comparison against **Reviter's recovered scene**. It does not
establish that every recovered object matches Autodesk or that every reference
object was recovered. The converter's existing lighting, planting, wall, and
placement defects remain visible in the geometry export.

## Files to load

In Pascal, use **Save & Load → Load Build**. The geometry mode requires support
for topology-backed `block` nodes, which the supplied editor source provides.

| Model | Drawn geometry JSON | Approximate size |
| --- | --- | ---: |
| RAC | [racbasic-drawn.pascal.json](../work/pascal-followup/racbasic-drawn.pascal.json) | 20 MiB |
| Technical School | [techschool-drawn.pascal.json](../work/pascal-followup/techschool-drawn.pascal.json) | 47 MiB |
| UNBC | [unbc-drawn.pascal.json](../work/pascal-followup/unbc-drawn.pascal.json) | 323 MiB |

The UNBC export has 43,275 blocks. Its schema, loading logic, and geometry
builder were tested locally; the subsequent application UI test crashed after confirming import. Its
interactive performance could not be benchmarked. Detailed geometry JSON is substantially
larger than a binary GLB.

For simplified building edits, the corresponding
[racbasic](../work/pascal-followup/racbasic-semantic-curtain-panels.pascal.json),
[techschool](../work/pascal-followup/techschool-semantic-curtain-panels.pascal.json),
and [unbc](../work/pascal-followup/unbc-semantic-curtain-panels.pascal.json)
semantic JSON files also pass the supplied validator with zero schema issues or
warnings. Their surfaces are not equivalent to the recovered mesh: they use
simplified building nodes and omit unsupported categories.

## Export behavior

- The browser's **Pascal** action writes actual indexed triangles, grouped by
  element and material into blocks of at most 256 triangles. The limit bounds
  the supplied renderer's per-face vertex-lookup cost. Unused vertices do not
  enlarge the exported shape. Incomplete triangle ownership is rejected.
- **Pascal editable** retains the simplified typed walls, floors, doors,
  windows, and curtain panels. The existing CLI/library default stays semantic
  for compatibility; use `--pascal-geometry drawn` for mesh geometry.
- Both modes convert decimal feet to metres, use Y-up coordinates, and preserve
  level placement. The drawn mode uses local block coordinates to reduce
  Float32 rounding. Source element IDs and geometry routes remain in metadata.
- Drawn mode carries base colour, opacity, roughness, metalness, and sidedness
  through scene materials. Colours are encoded as 8-bit sRGB hex values. This
  does not promise identical lighting, shading, textures, or smooth normals.
- Drawn mode uses a **building root**. The supplied Pascal site renderer adds a
  flat polygon ground fill; exporting a site would introduce a surface over the
  real recovered terrain. The actual scene loader retains the building root and
  every exported node.

## Actual Pascal renderer comparison

The audit validates the JSON, applies Pascal's `setScene`, checks that no nodes
or roots were discarded, and calls its `buildBlockGeometry`. It uses Pascal's
`getLevelElevations` for placement, compares every rendered triangle with the
originating GLB triangle, and checks winding. There is no fitted translation,
rotation, or scale: only the stated feet-to-metres conversion.

| Model | Source triangles | Pascal rendered / position-matched | Maximum vertex error | Omitted nonzero-area triangles | Omitted above 0.01 mm | Strict result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| RAC | 67,836 | 67,736 / 67,736 | 0.001945 mm | 13 | 0 | Pass |
| Technical School | 154,250 | 154,177 / 154,177 | 0.008130 mm | 2 | 0 | Pass |
| UNBC | 936,185 | 928,192 / 928,192 | 0.004168 mm | 530 | 33 | **Fail** |

Additional omissions are zero-area triangles: 87, 71, and 7,463 respectively.
For omitted nonzero-area triangles, width is measured as altitude to the longest
edge. RAC's largest omitted altitude is 0.000382 mm; Technical School's is
0.00003185 mm; UNBC's is 0.01858 mm. The supplied block normal helper rejects
normals shorter than `1e-8`, so very small faces can disappear during Pascal's
triangulation. The tolerance was not relaxed to turn UNBC green.

Machine-readable evidence, including input hashes:
[RAC](../work/pascal-followup/racbasic-native-audit.json),
[Technical School](../work/pascal-followup/techschool-native-audit.json),
[UNBC](../work/pascal-followup/unbc-native-audit.json).
The audit exits nonzero for a failed match. The older
`pascal-scene-glb.ts` comparison approximated Pascal's building masses locally;
its historical voxel percentages are not actual-renderer verification.

## Additional converter recovery against Autodesk

An owned sequence-102 record can prove a placed physical element by its class
and matching category even when no bounds record was recovered. Native mesh
admission now accepts that proof. It creates a UI record only after a complete
native mesh is admitted; it does not invent a box for an undecoded owner.
New records explicitly mark their bounds as derived from native triangles and
report `persistedBoundsFeet: null`.

| Model | Previous matched reference IDs | Current matched reference IDs | Current size passes at 0.5 ft |
| --- | ---: | ---: | ---: |
| RAC | 434 / 444 | 436 / 444 | 395 / 436 |
| Technical School | 5,470 / 5,473 | 5,472 / 5,473 | 5,437 / 5,472 |

Recovered additions are RAC wall **497540**, RAC ceiling **697612**, and
Technical School slab edges **217842** and **217846**. All four also have zero
unmatched cells in a selected-element surface check using 0.05 m cells and
0.0866 m neighbour tolerance. Registration is held fixed from the whole scene;
these are approximate sampled checks, not exact surface equality.

Evidence: [RAC element comparison](../work/pascal-followup/racbasic-comparison.json),
[Technical School element comparison](../work/pascal-followup/techschool-comparison.json),
[RAC fine surfaces](../work/pascal-followup/racbasic-added-fine.json),
[Technical School fine surfaces](../work/pascal-followup/techschool-added-fine.json).

Remaining reference IDs: Technical School roof **140056**; RAC walls **234869,
418079, 427092, 428588, 655533** and stair-container IDs **513254, 665557,
725045**. A missing stair-container identity does not prove that its runs or
landings are absent. The previously confirmed oversized Technical School wall
lights, RAC solar placement offset, remaining wall/foundation mismatches, and
planting recovery still need work. See the [earlier improvement report](autodesk-example-improvements-2026-09-11.md).

UNBC's current GLB has the same SHA-256 as the previous improved output:
`ce83a40a247c867d2efdfb51622ad5d0477c3ab4c3cd9ac817bb88ee872849e1`.
Its [paired IFC control](../work/pascal-followup/unbc-pair.json) still passes
21 of 21 checks.

## Reproduction and validation

```sh
npm run extract -- model.rvt --out model.glb
npm run extract -- model.rvt --out model.pascal.json --pascal-geometry drawn
node scripts/audit-pascal-export.mjs /path/to/editor-main \
  model.pascal.json model.glb pascal-audit.json
```

The audit requires Bun and the supplied editor's installed dependencies. Its
source aliases are temporary; no Pascal source files were changed. Dependencies
were installed with the supplied frozen lockfile and lifecycle scripts disabled.
Bun 1.3.14 prints a directory-mismatch diagnostic when using the temporary
configuration; successful audits nevertheless finish and write their reports.

Both browser actions were exercised in headless Chrome using a fresh RAC RVT
import. The downloaded primary JSON also passes the actual Pascal renderer
check, and the editable download passes schema validation. This verifies
Reviter's download UI and the supplied Pascal loading/rendering functions; it
was the initial function-level check. The subsequent actual editor UI test is
reported at the top of this document.

![Reviter's two Pascal export actions](../work/pascal-followup/ui-exports.png)

Build, TypeScript, 1,056 unit tests (one existing skip), and four rendered-HTML checks pass. Source
lint reports zero errors and five pre-existing warnings when generated `work`
artifacts are excluded. No deployment or commit was made.
