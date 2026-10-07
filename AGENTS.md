# Indoor geometry pipeline

For indoor room enclosure, circulation, door/stair/ramp/lift review or prepared OpenIndoorMaps ZIP work, read `docs/indoor-project-pipeline.md` and the shared [OpenIndoorMaps enclosure workflow](../openindoormaps/docs/indoor-enclosure-review.md). The reusable skill is [indoor-enclosure-review](../openindoormaps/.agents/skills/indoor-enclosure-review/SKILL.md).

Preserve native model/GIS bytes and source annotation provenance. Derive boundaries from native inside wall faces, measured doors and real slab support; a drawing outline is not by itself a certified room. Keep closed-door display enclosures separate from traversable routing portals. Preserve actual slab holes, stair landings/flights and neighbouring room identities.

Apply supported source review and regenerate presentation, circulation and routes together. Do not silently convert staff areas or stair voids into public circulation, invent served elevator stops, or mark unknown access/step-free edges as verified. Rendering-only changes must preserve the original navigation interior.

Use the current canonical master, task-specific candidates, preservation checks and a compare-before-replace hash when consolidating. Do not overwrite another chat's newer source or unrelated local edits. Verify relevant same-floor/multifloor routes, actual display blocks in ordinary/native height modes, scoped tests/typecheck/build and desktop/mobile browser behaviour. Report unsupported evidence as unresolved rather than raising raw polygons to improve coverage counts.

These instructions are scoped to the indoor export/review workflow; unrelated Reviter work follows its normal conventions.

For separate CAD circulation interpretation, read `docs/dwg-floor-analysis.md`.
Use `cad:paths --interpret-building CODE` (or `all`) with a new candidate folder.
Preserve original geometry and drawing bytes; keep derived leaf/contact evidence
in `circulation-review.json`. Inspect shared identities and finite wall-cap
entrance proposals individually. A recovered outer cell may contain dangling
partitions: path containment alone is insufficient without original-stroke
checks. Logical entrance proposals do not create physical walls, doors, access
or served stair/lift stops. Verify source-bound importer checks and actual
2D/3D desktop/mobile comparisons before promoting the separate CAD pointer.
