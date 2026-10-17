# UNBC compiler continuation for the next AI

Read this repository's `AGENTS.md`, [the pipeline](indoor-project-pipeline.md),
and the [consolidated OpenIndoorMaps handoff](https://github.com/ahzs645/openindoormaps/blob/main/docs/continuation/unbc-20261016/HANDOFF.md).
That handoff owns the live viewer, exact receipts, remaining navigation work,
test record and transfer instructions. Keep the repositories adjacent.

## Source state and failed rebuild

All local source work was preserved before consolidation in Reviter commit
`25bd696f2a5d8085be26fa5bc84aa978a13edb40` and OpenIndoorMaps commit
`e10ef50f802965e50bdaaca89e9af839c351c2e6`. These are recoverable source
snapshots for the failed original run, not claims that it exported successfully.
The original source bytes were retained; later main also adds viewer integration,
documentation and source-test fixture maintenance.

`unbc-native-v3-r2-resume1` ended with exit code 1 at
2026-10-17T01:02:51Z (October 16 evening in Vancouver). PID 211379 is no longer
running. `scripts/indoor/regenerate-from-native-cache.ts:619` refused the loss of
previously physically admitted arrivals `rm-694-0bed6b73a3bd` and
`rm-694-504b25e5319a`. Its completion receipt records no complete candidate or
output archive. Preserve this failure; do not weaken the preservation check.

The historical authoring master remains
`/workspace/scratch/unbc-review-20261014/UNBC.master.reviter.zip`, SHA-256
`13571ab92f7527f779b1b09e7f1792f0ae7ec4369be13554e881e5eda315c520`.
The original RVT hash is
`8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`.
The failed-run input is separately named
`UNBC.source-rebuild-without-derived-mapping.reviter.zip`; do not relabel it as a
successful new master. The enriched native cache, exact command, reviewed source
dependencies, replay outputs and nine physical floor checkpoint pairs are in
the separately checksummed transfer data. The canonical model/GIS bytes remain
unchanged; imported DWGs are owner-confirmed drawing references only.

## Work included

- Converter fixes retain complete large geometry frames, suppress duplicate
  real-body/fallback representations and select supported saved alternatives.
  The header lookahead boundary repair is included. See
  [native geometry selection](rvt-native-geometry-selection.md) and
  [header lookahead](rvt-split-frame-header-lookahead.md). Saved original-RVT
  comparisons improve 96-flight IFC correspondence; that population is not the
  28 held navigation links and does not prove clearance or public routes.
- Native source identity, placed geometry, curtain/panel/mullion/trim/floor
  material evidence, reviewed drawing handling, conservative door/barrier
  ownership/support, wall/column joins and current-cell physical qualification.
- Strictly scoped stair body, walking-volume, terminal and stepped-stair tools,
  fixtures and prototypes. Their availability does not mean every proposal is
  production-wired or every evidence gate passes. Retain exact source/instance
  ownership, foreign material, slab apertures and access restrictions.
- The local repair loop and bounded physical-floor checkpoints. Test one changed
  predicate and its physical/policy dependencies before a complete export batch.
  A selected audit can still import the entire campus; do not call that fast.

## Next actions

1. Inspect the two arrival losses from the retained replay/source/physical
   plane context. Check exact source terminal attachment and public ownership
   before altering a planner or broad cell. A genuine gap/obstruction remains
   a veto; source missingness is not proof of a collision or access permission.
2. Reproduce the affected predicate/cell locally with complete source floors,
   openings, foreign obstacles and owners; keep the failed outcome. Fix a
   demonstrated cause and check related up/down/profile cases. Batch stable
   repairs before one full regeneration and preservation acceptance.
3. Continue the held-stair qualification and stricter consumer adoption only
   against a genuine complete candidate. Existing serial R2 plans are gated and
   must not run an older automatic source-copy/publication tail. All 28 held
   stair links remain disabled; existing local steps/lifts are separate.
4. Implement durable reviewed stair contexts. Historical review identifies
   outdoor 1842431/1460777 and seating 1801478/1779473; the five other viewer
   exclusions remain unclassified. Contexts were assigned only to derived
   `stairDisplay.sourceFlights`, then lost when `prepareIndoorStairDisplay`
   reconstructed them at both pipeline call sites. The isolated helper,
   authored proposal, eight passing tests and actual nine-flight parity are in
   OpenIndoorMaps `docs/continuation/unbc-20261016/outdoor/`.
   Add a typed validated authoring field and portable round trips, pass it to
   both calls, and apply the helper within the builder. This is not wired yet.
5. Rebind dataset/compiler/engine/cache identities after any adoption. Contexts
   affect qualification even if edge bytes happen to match. Never forge source
   correspondence, restore an old validation authority or relabel stale caches
   merely to reuse expensive checkpoint work.

## Live map and transfer

The current live viewer is Site version 10/release `5ea7856475a6`, with its existing
private audience, at https://openindoormaps-unbc-map.ahzs6455.chatgpt.site/ .
Its separate Site source is `79459660625a721ce8135ae350fb07e9c8cf23e2`.
This GitHub main synchronization does not replace that deployed app or data.

The [visitor download](https://openindoormaps-unbc-map.ahzs6455.chatgpt.site/download/)
is 45,290,239 bytes, SHA-256
`6cb0ff0f40efd478d3058da29fa2a1bcd3cb16419042f3d5b8567c9c7f7cee22`.
It remains the October 15 geometry export. The live engine is the older checked
179-module `681e71…` binding; newer compiler/main cannot simply reuse its cache
authority. The visitor ZIP is sufficient for UI work, not native source repair.

In the same workspace, reuse the existing files; no extra upload is needed.
For a separate workspace, transfer `UNBC-data-handoff-20261017.tar.gz` and its checksum/
manifest, then clone the exact final main commits. The archive distinguishes the
historical master, failed source input and published visitor, and explicitly
lists omitted rebuildable multi-gigabyte caches. Do not commit those large model
or cache files to GitHub. Optional source evidence and cache reconstruction are
described in the transfer README; original source data remains authoritative.
