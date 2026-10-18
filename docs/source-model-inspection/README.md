# Repeatable source-model inspection for future agents

Use this workflow to investigate a native doorway, hallway join, stair or ramp
from first person. Keep the full recovered scene unchanged. A render shows the
model's intended geometry; exact source/physical checks decide whether a route
can use it. The rendered closed door leaf does not itself prohibit navigation.

The reusable [source-model-inspection skill](../../.agents/skills/source-model-inspection/SKILL.md)
and both repositories' `AGENTS.md` point here. These commands are authoring tools;
they do not require a visitor-site build or loading the whole routing calculator.

## Inputs and export

Keep the original RVT, verified complete native-model checkpoint, complete indoor
dataset and reviewed room/source evidence together. Restore their actual bytes
from the continuation archives; filenames or old checksums alone are not inputs.
Both repositories must be adjacent. Blender 4.3.2 was used in this workspace.

1. Copy [the UNBC example recipe](UNBC-floor3-door-2315416.example.json) to a task
   directory. Update its two input paths to the verified local files. Paths are
   relative to that recipe. Keep/recheck source hashes and expected mesh counts.
2. Set cameras in **original Revit model feet**, before subtracting the scene
   origin. For a standing view, start at the actual native floor plus 5.5 ft;
   record the elevation in `referenceElevationFeet`. Add reverse and threshold
   detail views, then look farther into both original areas. Preserve split
   native elevations even within one of the four combined campus floors.
3. Export once from Reviter:

   ```sh
   node --max-old-space-size=4096 --experimental-strip-types \
     --import ./scripts/register-test-typescript.mjs \
     scripts/indoor/export-inspection-scene.ts RECIPE.json NEW-SCENE-DIRECTORY
   ```

The exporter verifies the actual RVT and cache hashes. It restores serialized
render arrays with a lossless per-value check, validates triangle indices,
refuses empty scenes and preserves source materials. It writes `source-scene.glb`,
`render.json` and `scene-export.json`, including complete counts, origin and hashes.
The UNBC example has 1,763,196 vertices and 898,257 triangles. Reuse this single
unchanged scene for subsequent camera checks; do not reconvert the RVT per image.

## Render only the affected views

```sh
blender -b -t 4 --python scripts/indoor/render-source-inspection.py -- \
  SCENE-DIRECTORY NEW-CAPTURE-DIRECTORY link-side threshold-detail
```

Omit final view IDs to render every configured view. The new capture directory
retains partial successes and an error if a later frame fails. A complete receipt
lists the **selected** views; it does not imply all configured views were checked.
The renderer checks scene/config hashes and imported triangle/mesh counts before
rendering, uses the full scene, adds inspection lights/cameras, and records optics,
clip range, renderer version and every image hash. It never edits source meshes
or materials. The default far clip is 5,000 ft; any changed clip range is explicit.

For a quick camera placement check, use a separate recipe with 640×480 and eight
samples, then render one view. For inspection, the example uses 1280×960 and 64
samples. More samples cost more CPU time; low-sample grain is render noise, not a
source-geometry defect. Denoising is enabled only if supported by that Blender
build. Keep settings in the receipt; do not claim cross-version pixel identity.

## Inspect, compare and replay

- Visually inspect every claimed view. Check camera placement, the actual
  doorway/landing and floor surfaces, and whether recovered meshes are proxies.
  If clipped/cropped views are useful, label them and keep an unmodified full
  context view. A view from inside a wall is not a successful inspection.
- Compare the perspective with native ID/host membership, actual lower/upper
  heights, source room identities, exact slab support, holes and foreign material.
  Distinguish a missing portal, a missing lateral approach, a real sill/step and
  a display omission. Registration and room names alone grant no traversal.
- For a proposed flat doorway strip, run `inspect-native-door-strip.ts` with
  the complete unchanged dataset. For saved connectivity, use the sibling
  `audit-saved-pathway-connectivity.ts`. A positive graph witness or attractive
  render is not physical/public/step-free route approval.
- For stair/ramp changes, check both native planes and the full source flight,
  surface, terminal and clearance demand. Keep held links and unknown access
  intact until the existing production qualification passes.

Follow the shared local repair loop: predicate tests → affected source/physical
replay → selected actual route calculations → one stable full acceptance/build
and desktop/mobile viewer check. Offline source renders do not replace browser
proof of the visitor map. Label them **source-model renders**, never screenshots
of a deployed viewer or on-site observations.

## Survey related doorway thresholds

For the UNBC four-floor inventory, use the complete native-model cache, complete
indoor dataset and checked source state together:

```sh
node --max-old-space-size=4096 --experimental-strip-types \
  --import ./scripts/register-test-typescript.mjs \
  scripts/indoor/audit-native-door-thresholds.ts \
  NATIVE-MODEL.bin COMPLETE-DATASET.json CHECKED-SOURCE-STATE.bin NEW-SURVEY.json
```

A complete V8 diagnostic dataset can replace the JSON input; it stays diagnostic,
even if its proposals agree. The tool reads all four defined campus floors and
retains their split native level IDs. It recognizes native own-host curtain-door
sills, then proposes the first original room on each side without jumping over
another identity. Its five lateral ray samples are discovery, not certification.
Full-width endpoint, slab support, third-room and exact material checks follow.

Where supported by an original eight-corner bound, it also records a proposed
stepped profile with exact rational intersections and both vertical rises. The
bound remains an envelope, not an approved tread/body; all proposals explicitly
refuse route activation and wheelchair eligibility. Do not feed this report to
the graph as approved connections. Apply source-bound ownership and prove actual
body/surface/continuous clearance/access before production admission.

Reproduce the strongest unpaired envelope profiles in both directions without
loading the model or calculator again:

```sh
node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
  scripts/indoor/replay-door-threshold-proposals.ts SURVEY.json NEW-REPLAY.json
```

This checks exact profile reproduction/reversal and retained refusal flags. It
does not independently replay the source body or calculate actual routes. Run
the four focused test files and scoped TypeScript configuration listed in the
findings before committing a workflow change.

The [October 18 four-floor findings](../../../openindoormaps/docs/continuation/unbc-20261018/door-threshold-workflow/README.md)
record the actual inventory, five unpaired owner proposals, evidence and the next
production repair. This is a matching-pattern survey, not all possible door,
stair, ramp or missing-entrance failures.

## Save efficiently

Commit the recipe, source/export/render receipts, selected images, exact findings
and reproduction commands. Save the original large model/cache once, referenced
by checksum; do not duplicate its GLB or Blender file in every source increment.
Keep a tested portable source increment and owner-private Drive readback receipt
when continuing the UNBC backup. No geometry, access, import-cache or route
approval is created by rendering.
