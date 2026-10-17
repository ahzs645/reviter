> Latest UNBC continuation: [October 16 handoff](UNBC-HANDOFF-2026-10-16.md). Use it for current artifacts, failed rebuild and next steps. The report below is historical.

# UNBC native indoor map: compiler handoff (2026-10-14)

This covers the compiler (reviter) side of the UNBC native map work. The full project handoff covers the owner rules, the candidate pipeline, the promotion convention and the canonical files; it lives in the OpenIndoorMaps repo at `docs/continuation/unbc-20261014/HANDOFF.md`. Read that first.

## State

- **Branch.** All work is on `claude/unbc-candidate4-rules` (pushed); local `main` is fast-forwarded to it. Ask the owner before pushing `main` or opening a PR.
- **Promoted master.** The final UNBC master (`~/Downloads/UNBC.final/UNBC.master.reviter.zip`, sha `13571ab9…`) was compiled by this code at `4c13fd0`, with routing on. 1,535 of 1,842 named rooms are reachable.
- **Tests.** Run with `node --experimental-strip-types --import ./scripts/register-test-typescript.mjs --test tests/<file>.test.ts`. The circulation set should pass, for example:
  - `native-circulation-geometry`;
  - `native-supported-pull`;
  - `reviewed-circulation-links`;
  - `reviewed-landing-door-links`;
  - `native-foreign-portal-terminal`;
  - `native-slab-join-closures`;
  - `native-access-zones`.

## What changed this round

| Commit | Change |
|---|---|
| `50b5ffa` | `adoptDatasetNodes`: the ramp connector nodes pushed by `prepareReviewedIndoorRamps` survive when the landing-door links rebuild `dataset.nodes`. Without it, ramp approaches named absent nodes. |
| `4c13fd0` | `attachNativeCirculationCellRoutes` (`lib/reviter/native-circulation-geometry.ts`), described below. |
| `a8e39fd` | The region blocker indexes its ring edges. |
| `e8776b8`, `5b25173`, `0a904a3`, `ef3e956`, `a48424e`, `ee2ebd3` | Drawing-backed rule mechanisms used by candidates 4–14. They mirror the OpenIndoorMaps commits of the same names, so keep the two in parity. |

The `4c13fd0` change to `attachNativeCirculationCellRoutes` has three parts:
- **One acceptance path.** The per-branch checks became one `accept(branch)` closure: physical door pairs, shared slab, exact support with the own-terminal rebuild, blocking and duplicate IDs. Stitching reuses it, so a stitch can never bypass a check.
- **Exact string pulling** (`nativeSupportedPull`, exported and unit-tested). When grid snapping moves a terminal onto a point outside its own exact face (for example into a door frame), the planned path is pulled tight. From each kept point it keeps the farthest later point joined by one exactly supported segment, and it refuses only when no supported step exists.
- **Cell stitching.** After the grid branches, the cell's selected nodes are united by its own edges plus door and opening edges. While more than one piece remains, the 24 closest untried cross-piece pairs are planned inside the cell. A pair the grid can't plan is offered as one straight segment, and each plan goes through `accept`. Stitching stops when no pair joins.

## Measured effect (probe on the 137 split cells of the candidate-13 routing dataset; 971 reachable before)

| Version | Reachable named rooms |
|---|---|
| Stitching only (same level and surface pairs) | 995 |
| Stitching with any pair, plus string pulling | 1,000 |
| The same, with the 08-S101 reviewed link simulated | 1,520 |
| Final candidate-16 compile, including the link and the new lift | 1,535 |

The link joins Building 08, and through it Building 10's upper floors become reachable. Most refusals had been reason 6, "rebuilt path not exactly supported", caused by grid-snapped terminals inside door frames.

## Remaining routing gap (next step)

Four corridor-side door nodes still get no walking branch: #1501543 (10-1302), #1501551 (10-1312), #1501582 (10-1060) and #1780077 (06-364).

- Their doors are `connected`, with a host wall and both nodes on opposite sides, and each node's `roomKey` is in its cell's `roomKeys`.
- Find out whether the node is excluded from `selected` (the `routeRings` exact approach) or whether every plan is refused.
- **Fast loop**, without a 2.3 h compile:
  1. Copy the OpenIndoorMaps handoff tools `probe.mts`, `frag.py` and `gaps.py`. The probe rebuilds the listed cells with the current builder on an existing routing dataset and merges their edges.
  2. Add temporary refusal-reason logging (number each `return false` in `accept`) behind an env var, run the probe on the two or three affected cells, and remove the logging before committing.
- Door 1501582 is a wide door (about 6 ft). Its corridor-side node sits inside the door footprint, about 0.1 ft from the cell edge, so the grid cannot snap it.

## Performance notes

| Step | Time |
|---|---|
| Routing compile | 2.3–2.7 h, of which native circulation is about 1.9 h (1,282 cells) |
| Selection compile, routing off | About 35 min |
| OpenIndoorMaps export (`package-final`) | About 2.5 h, BigInt-bound: `gcd`/`compare` in the rational overlay, building the published floor mapping |

Cheap, result-identical wins:
- replace `data.edges.some((e) => e.id === id)` in `accept` with a keyed set;
- index `selected` by ID instead of `selected.find`;
- cache per-cell results under an input fingerprint (cell geometry, nearby doors and nodes, model hash, code version);
- split cells across 4–5 worker processes.

Larger wins: float filters before exact predicates, and a spatial index over cell edges.

## Rules for compiler changes

- Generic mechanisms only. Never bake UNBC coordinates or IDs into `lib/`.
- Every geometry decision stays exact. A shortcut must pass the same exact support and blocking checks as a normal branch.
- Keep parity with the OpenIndoorMaps runtime mirrors (e.g. drawing-backed rows and door closures). Changes to the native display module graph on the OpenIndoorMaps side require refreshing its prepared-display engine binding.
- The candidate compile scripts refuse dirty `lib/` or `scripts/` trees, so commit before compiling.
