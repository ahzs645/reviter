# UNBC indoor map and CAD handoff — 2026-10-07

## Goal and repository roles

Build a usable indoor campus map from preserved Revit and DWG evidence: selectable room interiors, accurate circulation, doors, stairs, ramps and lifts, reversible repairs, and explicit review of uncertain geometry and access. A selection polygon alone does not certify a raised room or a usable route.

Keep the two repositories side by side:

- `openindoormaps`: authoring/review UI, native-area selection, patch preview and decisions, visitor exploration, routing, portable master/visitor packages and audits.
- `reviter`: source decoding and compiler, native geometry interpretation, repaired presentation and routing, DWG intake, CAD floor review and schematic 3D.

Both repositories are on `main`. The handoff ZIP's `repositories.json` records the exact pushed commits; Git bundles provide an additional offline snapshot. Read each repository's `AGENTS.md`, `openindoormaps/.agents/skills/indoor-enclosure-review/SKILL.md`, and the relevant workflow docs before changing geometry.

## Authoritative datasets: two separate versions

**Native campus master:** `UNBC.master.reviter.zip`, SHA-256 `74e21697d55b2bc7b5cef3bbf271a17a3850408552ad0ac90ceebb0c04db3412`.

**Derived campus visitor:** `UNBC.campus-viewer.zip`, SHA-256 `3e901eb2a2118d15765659aeffa8119042320d0310f8be472d81dbd1a5e07c7a`.

Native version metadata: `current-version.json`; dataset revision `cb2a8cfe28153dcd592134727f6f17c23767f0d2b8ffee0d61afd253c94d7088`, updated 2026-10-07 19:05 UTC. Original RVT SHA-256 `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178`; current room-entry SHA-256 `d7dfdd2ddc325a7890d0a830d5c6e7fd83f4fde1d3c52293eae4d54f31bbe715`. The master contains the original RVT, GIS references, room annotations, scene and **785 authoring companions** (reviews, scans, proposals and evidence). Do not replace those companions with an older loose folder.

**Separate CAD intake:** `reviter-cad-stair-approaches-20261007-v5/UNBC.cad-geometry.zip`, SHA-256 `c370f410a5cba015c79fa7af9d22fdaf9235613970286d4ad6261cb143d32675`. `CAD-current.json` is the current CAD pointer. Original geometry SHA-256 `863c08fdddc6047b3ed4202db84f631fe8dd20264c013aaf9f3b0968147b9fce`; floor-plan DWG SHA-256 `5f2b1b7a91dab72d0a39528116cbbc1a1d74706bd7f9e41e9b7bcc7d7a8cbd44`.

Original canonical location on the old machine: `/Users/ahmadjalil/Downloads/UNBC.final`. The native master and CAD intake have **not been merged**. CAD buildings 02, 11, 12, 14 and 19 await geographic placement/review; audit includes every building in the supplied drawing. Do not import CAD schematic coordinates as geographic or native routing coordinates.

## Portable files and starting another machine

Extract `UNBC-handoff-20261007.zip` to a data directory. `handoff-current.json` uses paths relative to that directory. `metadata/` preserves the original absolute-path metadata as provenance; it does not designate paths on the new machine. `SHA256SUMS.json` records every payload file. Git push transfers code only; this local ZIP transfers the models, reviews and caches.

Use Node **22.13 or later** for both repositories, then run `npm ci` in each. Start each with `npm run dev`; use the printed local URL. For the static apps, use `npm run build:pages` and a local static server / the repository's preview command. OpenIndoorMaps imports `native/UNBC.master.reviter.zip` via **Import project ZIP**. Reviter's CAD review imports `cad/reviter-cad-stair-approaches-20261007-v5/UNBC.cad-geometry.zip`. Keep these separate until placement and merge are reviewed.

For CAD Python tooling, create a fresh virtual environment and install `reviter/tools/dwg-analysis/requirements.txt` (ezdxf, shapely, numpy). No machine-local virtual environment is portable. The CAD ZIP preserves original drawing and derived input files. Extract it into a new folder before running CLI analysis:

```sh
cd /path/to/reviter
npm run cad:paths -- --package /path/to/extracted-cad --out /path/to/new-candidate --python /path/to/venv/bin/python --interpret-building 14
```

The interpreter also supports `all`; use a new candidate destination. Review `docs/dwg-floor-analysis.md` for floor controls, evidence bindings and package regeneration. All-floor regeneration takes several minutes.

The handoff includes `native/unbc-connectivity-native.json`: exact-model decoded cache SHA-256 `9faf2cdc01dffa45098b04a3d7242c6ae8874eec5a39d286023ad9fe6ac56490`. Native regeneration uses both sibling repositories:

```sh
cd /path/to/openindoormaps
node --max-old-space-size=4096 --expose-gc --import tsx scripts/indoor/regenerate-from-native-cache.ts /path/to/native/UNBC.master.reviter.zip /path/to/native/unbc-connectivity-native.json /path/to/new-candidate
```

This generates a candidate; it does not promote it to the canonical master. Review loss guards, source preservation, geometry, routes and ordinary/native-height views, then compare the canonical hash again before replacement. Never overwrite another chat's newer master.

## Current native state and limits

Native floor mapping is published for visitor exploration. The latest native finalization audited 13 scopes, applied five source landing corrections, retained 1,614 original portals and all 126 previously available scoped comparisons; 272 vertical route checks were performed. There are 5,430 graph nodes. Existing desktop/mobile and ordinary/native-height proof is in `verification/native-map-finalization-20261007`.

The Building 07 to 08 route comparison is available (07-180 → 08-102, about 50.4 m, one stair transition). Four public areas and seven accessibility edges remain unconfirmed: it is **not certified public or wheelchair accessible**.

Remaining specific native evidence: 04-124 lift lower-stop ownership disagrees with its supported 3.28084 ft slab; 03-S101 lacks a separately persisted same-floor landing; 03-S204 is 20 mm beyond slab #402395; 06-S205 is 134.9 mm beyond slab #1779842; 06-S306 is 2.38 mm beyond that slab beside wall #1779737. Unsupported apron/unlabelled faces remain hidden.

Source repairs and logical partitions are different. Extend measured walls along their actual axis/thickness only where evidence supports it. A doorless bathroom, shuttered bookstore/cafeteria, pickup front or divider may need a **logical selection partition** instead of an invented wall. These authoring boundaries preserve physical geometry and current access/navigation; elevator shafts need a full non-traversable footprint and separately checked entrance/served-floor evidence.

The user confirmed several pass-through doors, vestibules and separate room identities across the campus. Their detailed decisions, assumptions, pins and proposals belong to the master companions. Do not reconstruct them from this summary or assume every requested room is already isolated. Pin 99's far-side indoor/outdoor status remains flagged at the user's request. Pin 50's window/railing edge must not become a traversable connection. Outside detection needs enclosing walls/glazing and supported floor evidence; an exterior slab alone does not establish indoor access. Outdoor routing is future work.

## Current CAD state and next geometry work

The separate intake covers **43 floors / 53 sheets**; two composite panels still need attribution. CAD shapes are interpreted into selectable candidate spaces, door thresholds, stair evidence and illustrative 3D, with source drawings preserved. Labels in a mesh are not automatically distinct certified rooms.

Building 14 (Northern Sport Centre) is the most developed comparison: 115 labels, 82 in meshed areas; 54 additional supported door interpretations and 13 unapplied doorless entrance proposals. Its upper track is a perimeter with an **open middle looking down**, and **no middle bridge**: the central separator is between the soccer field and basketball court below. All four track corners and three upper stair doors connect in the scoped comparison.

The user authorized provisional stair-stop assumptions with a switch, while keeping XY alignment between floors. Physical elevations, exact served stops and access remain unverified. v5 recognizes 14 paired lower-stair riser strokes as drawing symbols. The S101/S201 lower approach now supports an opt-in 16.6345 m drawing comparison; S103/S303 remains available (upper-track to lower S103 comparison about 248.115 m). **S104 and S105 lower approaches remain unresolved**, alongside **23 ground-floor labels lacking boundaries** and upper identity **14-E305**. Full all-floor visitor routing remains unfinished.

Continue through `continuation-review.json`, `stair-approach-checks.json`, `circulation-review.json` and the saved desktop/mobile/3D comparisons inside v5. Compare original strokes and finite wall contacts, not just path containment: recovered outer cells can contain dangling partitions. Do not silently apply the 13 doorless proposals, invent lift stops or treat schematic vertical comparisons as native campus routes. The brochure is supporting layout evidence, not surveyed geometry.

## Archive cleanup and recovery

`UNBC-CAD-archive-20261007` is historical, not the current package. Cleanup removed 2,994 files / 5,057,515,950 bytes of byte-identical duplicates, ZIP containers whose every entry had a retained byte-identical payload, and `.DS_Store`. About 1.09 GB of unique history remains. The receipt names each removed file, retained source and SHA-256. Historical ZIPs that differed from unpacked contents were retained. No original source or current master was deleted.

The handoff carries that unique archive and its receipt. Restore one historical snapshot into a NEW folder with:

```sh
python3 archive/restore-archive.py --receipt archive/cleanup-receipt-20261007.json --archive archive --current cad/reviter-cad-stair-approaches-20261007-v5 --snapshot cad-building-intake-20261007 --out /path/to/restored-snapshot
```

ZIP entry bytes are preserved; reconstructed ZIP container metadata can differ. Current CAD unpacked files are included so receipt references can resolve after moving machines. A restored historical intake was checked during cleanup. The archive index's old sizes describe the original snapshots, not current disk usage.

## Verification and working practices

Keep actual public/accessibility status distinct from geometric connectivity. Native-area previews and accepted notes are not applied geometry. Preserve real walls, columns, stairwell holes, source bytes, room identities and measured doors; display threshold closure is separate from navigation portals. Worker computations stay off the UI thread. Room review and CLI share volume coverage logic.

Run focused geometry/routing tests, scoped typecheck and build; UI changes require actual desktop/mobile browser proof. The handoff `validation/` records the final check results and known limits. Existing native/CAD browser proofs are included; this cleanup/handoff does not claim a new complete manual audit of every enclosure.

Workflow details: `openindoormaps/docs/indoor-enclosure-review.md`, `openindoormaps/docs/native-area-review.md`, `reviter/docs/indoor-project-pipeline.md`, `reviter/docs/dwg-floor-analysis.md`. Keep changes reviewable, persist evidence with the dataset, use candidate ZIPs and hashes before canonical promotion, and report unresolved evidence explicitly.
