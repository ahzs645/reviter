# Why the UNBC native regeneration takes 4 hours on one core, and what would shorten it

November 16, 2026. Read-only study.

**Code read:** `~/unbc-work/matcher/openindoormaps` (131a8e2) and `~/unbc-work/matcher/reviter` (8fecc9a). All `file:line` references are to these trees. Short names:

| Short name | File |
| --- | --- |
| driver | `openindoormaps/scripts/indoor/regenerate-from-native-cache.ts` |
| pipeline | `reviter/lib/reviter/indoor-pipeline.ts` |
| geometry | `reviter/lib/reviter/native-circulation-geometry.ts` |
| links | `reviter/lib/reviter/native-circulation-links.ts` |
| landing | `reviter/scripts/indoor/native-landing-approaches.ts` |
| pool | `reviter/scripts/indoor/bounded-worker-checkpoints.ts` |
| planes | `reviter/scripts/indoor/parallel-native-circulation.ts` |
| arithmetic | `reviter/lib/reviter/vendor/native-rational-overlay-arithmetic.mjs` |
| package | `openindoormaps/app/indoor-project/package.ts` |
| mapping | `openindoormaps/app/indoor-project/native-explore-mapping.ts` |

**Not checked:** the log header names commits `f33588a` (openindoormaps) and `9bf56ec` (reviter). Neither exists in any local clone, so I could not diff them against the trees I read.

## Summary

- **One core:** every stage runs on the main thread except the 9 planes, which run in one worker thread while the main thread waits. With `LANDING_WORKERS=1` the landings also run on the main thread.
- **Where the time is:** about 176 of 244 minutes are five stages of exact-fraction geometry (landings 65, cell routes about 41, export mapping about 27, final replay about 25, planes 18.5). Reading, writing, hashing and compressing files are seconds each.
- **The two silent gaps** are the per-cell walking-branch stage (`attachNativeCirculationCellRoutes`) and the master export (`exportIndoorProject`, almost all of it `compileNativeExploreMapping`).
- **New fact about the worker failures:** the worker heap settings do nothing. `run.sh` always starts Node with `--max-old-space-size`, and that flag replaces every worker's own limit. I confirmed this on Node 22.22.0. So the "4096" and "8192" landing-worker runs were the same configuration, and the cause is not a per-worker cap that was too small.
- **Cause of the worker failures:** not determined from code. The failure follows the number of workers in one process, not the memory each needs. Section 3 gives two candidate mechanisms and a few-minute probe that separates them.
- **Biggest lever:** the faster exact arithmetic, applied to Reviter's copy only. It applies cleanly to the producer tree and should save about 85–95 minutes without touching the OpenIndoorMaps runtime files.
- **Flags alone** save little: about 6 minutes on a rerun, and about 8 more with two floor workers (untested with the gap patches).

## Timeline of yesterday's run

Taken from `compile.log.gz`; start 17:47:08, end 21:51:10, 244 minutes.

| Stage | Clock | Minutes |
| --- | --- | ---: |
| Read source package (Reviter reader) | 17:47:08–17:49:04 | 1.9 |
| Read authoring project (OpenIndoorMaps reader), save import data | 17:49:04–17:53:06 | 4.0 |
| Patch check, native cache, review replays, stair proofs | 17:53:06–18:00:03 | 7.0 |
| Envelopes, routing interiors | 18:00:03–18:04:41 | 4.6 |
| Walls and doors, 9 levels | 18:04:41–18:13:32 | 8.9 |
| Ramps, landing plan, input snapshots | 18:13:32–18:21:16 | 7.7 |
| Landings: 1148 pairs planned, 977 evaluated, 80 connected | 18:21:16–19:26:10 | 64.9 |
| Room presentation | 19:26:20–19:31:17 | 5.0 |
| 9 planes (0.5, 0.5, **7.5**, 1.1, 0.3, 3.7, 2.1, 0.6, 2.2 min) | 19:31:17–19:49:47 | 18.5 |
| **Silent gap 1** | 19:49:47–20:32:51 | 43.1 |
| Final replay, arrival decisions, diagnostic save | 20:32:51–21:00:11 | 27.3 |
| Stepped-stair finalization | 21:00:11–21:02:47 | 2.6 |
| Guards, `compiled-dataset.json` | 21:02:47–21:03:44 | 1.0 |
| **Silent gap 2** = `Export master: 30:32` | 21:03:44–21:34:16 | 30.5 |
| Read master | 21:34:34–21:41:41 | 7.1 |
| Export viewer | 21:42:10–21:46:15 | 4.1 |
| Visitor import, summary | 21:46:16–21:51:10 | 4.9 |

## 1. What runs in the two silent gaps

### Gap 1: 43 minutes after plane 9/9

In order:

1. `runBoundedCheckpointTasks` returns. `prepareParallelNativeCirculation` reads the 9 drafts with `readCheckpointResult` (planes:37) and calls `mergeNativeCirculationPlaneDrafts` (planes:38; geometry:687–745), then writes its receipt (planes:39–42).
2. `nativeDoorBoundaryClosureFootprints` per level (pipeline:1505–1514).
3. **`attachNativeCirculationCellRoutes(dataset)`** (pipeline:1515; geometry:1206–1559).
4. `attachOriginalDoorDerivedStanding` and `attachOriginalStairBaseDerivedStanding` (pipeline:1516–1519).
5. `applyReviewedCirculationLinks` (pipeline:1522).

The next log line is printed at pipeline:1526.

The producer code logs nothing between these steps, so the split is an estimate. The drafts are small (45 MB of JSON in total in the local run's checkpoint folder). On November 5 the merge was about 4 % of this gap. That puts about 2 minutes in the merge and about 40 in step 3.

You can read the exact merge end time on the VM: the receipt file name contains `Date.now()` (planes:42), at `run/checkpoints/<binding>/plane-compiler-receipt.json.<ms>.<uuid>`.

### Gap 2: after `source-stepped-stair-finalization-replayed`

About 1 minute of hash checks, arrival guards and writing `compiled-dataset.json` (driver:994–1130). Then `exportIndoorProject(rebuilt)` (driver:1132–1134; package:739–845), which is the logged `Export master: 30:32`:

1. Validations (package:746–787).
2. `structuredClone(project.dataset)` (package:791).
3. **`publishNativeExploreMapping`** (package:809). The Reviter compiler never sets `nativeExploreMapping` (no occurrence in `reviter/lib/reviter`), and Node 22 has no global `Worker` (checked). So it takes the cold in-process path, `compileNativeExploreMapping` (mapping:343–346, 202–264). That loops over `data.nativeLevels` and awaits `deriveNativeAreas(data, level.id, {mode: "connected", maxGapFeet: 0})` one level at a time (mapping:209–219).
4. `JSON.stringify` and the level-6 zip (package:817, 841).

The split inside export is not logged. The efficiency README attributes 85–90 % to step 3, which would be about 27 minutes here.

## 2. Each stage over 5 minutes

| Stage (min) | Unit of work | Where it runs | Independent? |
| --- | --- | --- | --- |
| Import and review replays (13) | whole package | main thread | sequential |
| Walls and doors (8.9) | level, 9 of them (pipeline:591); level #311 takes 3.5 min | main thread | per level in principle, but each level adds to shared nodes, edges and issues |
| Ramps and landing plan (7.7) | whole dataset | main thread | sequential |
| Landings (64.9) | candidate pair (links:1419–1559) | main thread with 1 worker (landing:343, 355); N worker threads for N > 1 | each pair is pure; order matters only through the join-and-skip replay (links:1565–1648) |
| Presentation (5.0) | whole dataset | main thread | not examined |
| Planes (18.5) | plane, 9 of them (geometry:677–682) | always worker threads, even with 1 (planes:36); the main thread waits | fully independent; merged in elevation order (geometry:684–686) |
| Cell routes (about 41) | circulation cell, about 2,500 (geometry:1225) | main thread | nearly: see below |
| Final replay (27.3) | enabled native walking branch (geometry:1612) | main thread | each edge is checked and changed on its own |
| Export mapping (about 27) | native level, 9 of them (mapping:209) | main thread | fully independent per level |
| Read master, export viewer, visitor import (16) | whole package | main thread | the validations inside are independent of each other |

### What a worker receives

Neither kind of worker re-reads the 420 MB native cache or the master.

- **At start:** `workerData` holds only the module URL and the binding, a list of file paths and hashes (landing:224; pool:147).
- **Inputs:** each worker hashes every bound file (`bounded-checkpoint-worker.ts`:6). It then reads, hashes again and `v8.deserialize`s two snapshots from `checkpoints/inputs` (`native-landing-approach-worker.ts`:14–15; `native-circulation-plane-worker.ts`:8–9). These are `native-model-<sha>.bin`, 264–265 MB, and a dataset snapshot, 87–92 MB (sizes from the local run's folder).
- **Heap after that:** 668–890 MiB per landing worker, from the October 16 log line `2 workers initialized · heap 890 MiB, 668 MiB`. This is well below the "3–4 GiB" the efficiency README assumes.
- **Landing workers also** recompute the pair plan and build their own evaluator (`native-landing-approach-worker.ts`:17–18).
- **Tasks:** a small JSON string. Landing results are small; plane results are 0.13–11.4 MB each.
- **Cost to the main thread:** it serializes the model and dataset, hashes them and writes them with `fsync`, once for the landings (landing:168–195) and once for the planes (planes:12–20, 29). The model changes by 0.8 MB between the two stages, so two model files are written.

### How the landing pool schedules

- A wave holds the next pair plus up to `2 × workers − 1` speculative open pairs (landing:307, 352–354).
- Pairs with the same region go to one worker, but only within a wave (landing:273–288). The next wave may send the same region to a different worker, which then rebuilds it.
- Each evaluator keeps its last 32 regions (links:878).

### Cell routes: what stops them being trivially parallel

- Branch ids contain the cell id, and duplicates are checked with `data.edges.some` (geometry:1414).
- The stitching step reads only this cell's edges plus existing door and opening edges (geometry:1455–1456).
- The cross-cell parts are the order edges are pushed in, and the minority-owner pass over all arrivals at the end (geometry:1484–1526).

### Hard caps in the code

| Cap | Where | Reason given in code |
| --- | --- | --- |
| `--native-workers` 1 or 2 | driver:109–110; planes:11, 26 ("Begin with one or two native workers") | none beyond a cautious start |
| Plane memory budget | planes:35–36; pool:143 | Default 16 GiB in flight, each worker counted as 8 × the snapshot bytes (about 2.9 GB) plus 512 MB per task. That allows at most 5 plane workers even if the 1-or-2 check were removed. The driver has no flag for it. |
| `--landing-workers` 1–8 | driver:114–120; landing:306 | none |
| Worker heap 256–8192 MiB | driver:126; passed as `resourceLimits` (landing:338; planes:36; pool:147) | **has no effect, see section 3** |
| Landing heap flag needs 2 or more workers | driver:135–138 | one worker uses the main thread |
| `run.sh` sizing | landing workers = spare ÷ 5 GiB, at most cores − 1 and 8 | — |
| Pool maximum 64 workers | pool:129 | — |

## 3. The landing-worker out-of-memory failure

### Established

1. **The worker heap flags are inert.** Node applies `--max-old-space-size` to every isolate in the process, workers included, and it replaces `resourceLimits.maxOldGenerationSizeMb`.
   - Test on Node 22.22.0 (V8 12.4, macOS arm64), saved as `worker-heap-limit-check.mjs`.
   - Without the flag, a worker asked for 64 MiB dies with `ERR_WORKER_OUT_OF_MEMORY` after about 40 MiB.
   - With `--max-old-space-size=1024`, the same worker keeps 384 MiB and reports a limit of 1072 MiB.
   - `run.sh` always passes `--max-old-space-size=$heap`. So in every recorded run each worker's real limit was `PARENT_HEAP_MIB`, whatever `*_WORKER_HEAP_MIB` said. Worth a 10-second repeat on the Linux VM.
2. **The November 6 "4096" and "8192" runs were the same configuration.** The different time to failure (3 minutes, then under 1 minute) is not a heap-size effect. One possible reason, not checked: the second run reused pairs the first had already written to the JSONL.
3. **A worker needs under 1 GiB to start**, and the per-pair function is the same pure function the main thread uses (`createNativeApproachEvaluator`, links:1419). With one worker it runs inside a main process that also holds the import data and the model, under the same 8192 MiB limit, and passes.
4. **Every recorded failure follows the number of workers in one process:**
   - 2 landing workers passed (October 16).
   - 2 floor plus 7 landing workers passed before the gap patches.
   - 11 landing workers failed, and 9 floor workers failed on the small 34.12 ft plane (2 minutes of work) rather than on plane 0 (7.5 minutes).
   - 7 landing workers fail with the gap patches.
   - Machine memory (50 to 176 GB) made no difference.

So a single worker needing more than its limit does not explain the failures.

### Not established: the mechanism

I have not seen a failing log. The efficiency README names the error as `ERR_WORKER_OUT_OF_MEMORY`. Two mechanisms fit the pattern above. Both come from my knowledge of V8 and Linux, not from this code.

| | A. Process-wide memory-mapping limit | B. Garbage collection starved by sharing |
| --- | --- | --- |
| Mechanism | V8 maps each 256 KiB heap page separately. Linux allows 65,530 mappings per process by default (`vm.max_map_count`). That is about 16 GiB of V8 heap for the main thread and all workers together. | All isolates in a process share Node's 4 V8 helper threads (`--v8-pool-size`, default 4). With 7 workers allocating BigInts at a high rate, one worker's heap could reach its 8192 MiB limit although its live data is small. |
| Fits | Main process about 6–7 GiB plus 7 × 0.9 GiB at start leaves about 3 GiB for seven workers, which they would use within minutes. 11 workers are at the limit immediately. A small plane can be the one that fails. One or two workers stay under it. | The reported error code. |
| Does not fit | It should abort the whole process with `FATAL ERROR … JavaScript heap out of memory`, exit 134, not raise `ERR_WORKER_OUT_OF_MEMORY` in one worker. | I cannot make the numbers work convincingly. It also does not explain why a small plane failed. |

The arithmetic favours A; the error code as written in the README favours B. The first line of a failing log decides between them.

### Probe: a few minutes per trial

The previous run left the landing-stage snapshots in `/content/unbc/run/checkpoints/inputs`. `landing-worker-probe.mts` loads them and calls `attachNativeCirculationResumable` directly. It skips the 34-minute front matter and writes to its own folder. Its header has the full command.

It prints resident memory and the mapping count against the limit every 2 seconds. `--trace-gc` adds one line per full collection per isolate.

1. `cat /proc/sys/vm/max_map_count`, then run `worker-heap-limit-check.mjs` with and without the flag.
2. Run the probe with 7 workers and `--max-old-space-size=8192`. Keep the exact error text and exit code.
   - Mapping count near the limit and a process abort: mechanism A.
   - One isolate's `Mark-Compact` lines climbing to about 8000 MB with low `mu`, then `ERR_WORKER_OUT_OF_MEMORY`: that worker really filled its heap. Continue with step 3.
3. Repeat with one change at a time:
   - `--v8-pool-size=32` (passes: mechanism B);
   - `sysctl -w vm.max_map_count=1048576`, if Colab allows it (passes: mechanism A);
   - `--max-old-space-size=24576` (passes: real demand above 8 GiB; the "after" size in the last `Mark-Compact` line gives the live size).
4. Run with 2, 3 and 4 workers to find the threshold and the real speed-up per worker.

The probe's main process holds only the model and dataset, about 1 GiB. The real main process holds several GiB more. Under mechanism A the real run therefore fails with fewer workers than the probe does.

## 4. Where the time goes inside the unit of work

### Exact fractions (established)

All exact work goes through the arithmetic module.

- Every `new Rational` runs a Euclid `gcd` on BigInts (arithmetic:4, 19).
- `add`, `sub`, `mul` and `div` always construct, so they always reduce (arithmetic:26–29).
- `compare` always cross-multiplies (arithmetic:30).
- `native-exact-planar-topology.ts`:42–46 has its own copies of the same operations.

Measured on November 6 on 132 real cells (efficiency README): 84 % of overlay and path time was in this module and 57 % in `gcd`.

### Landings: about 4 s per evaluated pair

- **Each region is the whole plane.** A walking region is every wall, column, door leaf and tread of the plane subtracted from the plane's floors, then ownership-classified face by face (links:337–809; the subtraction is at links:698).
- **Each portal gets its own region.** The memo key includes the portal door (links:846–859), so each stair or landing portal rebuilds the whole plane with one aperture changed.
- **Obstacles are converted twice per region.** `exactParts(obstacles)` runs one exact union per obstacle polygon (links:368) and is called again for `barriers` (links:754).
- **Most searches fail.** 897 of the 977 evaluated pairs end with no connection (the local JSONL has 80 results with a path). A failed landing pair can search a 0.6 ft grid of up to 50,000 cells (links:993), with 5 exact point tests per cell against the plane's walkable faces (links:1019).

### Cell routes and final replay

- `nativeCellDoorApproach` runs once per cell (geometry:1226), again for every branch (geometry:1361), and again for every edge in the final replay (geometry:1623).
- Each call walks all doors (geometry:968) and repeats three exact overlays per door side (geometry:1069–1071). There is no memo for the result per cell, door and node.
- `accept()` recomputes exact unions of slab parts for cross-surface branches (geometry:1335–1344).
- The grid is rebuilt for every stitching candidate (geometry:1474).

### Memoisation that already exists

| Memo | Limit | Where |
| --- | --- | --- |
| Regions | last 32 | links:878 |
| Floor intersection | 12 entries, 16 MB; a larger result is never stored | links:250, 278 |
| Ownership | 512 entries, 16 MB | links:122 |
| Door-half unions | 64 entries, 16 MB | `native-door-approach-exact-union-memo.ts`:149 |
| Foreign-portal decisions | per pass | geometry:811–824 |
| Large-cell tiles | per pass | geometry:797–807 |
| Physical authority, per level and scope | per replay | `native-exact-routing-authority.ts`:21–24 |
| Ring bands and bounds, local parts | by object identity | `native-exact-planar-topology.ts`:147, 163, 204 |
| Original-coordinate rationals | 65,536 entries | arithmetic:24 |

Whether plane 0's floor intersection exceeds the 16 MB limit, and so is recomputed for every region, I could not determine.

### GEOS (not determined)

The WebAssembly overlay is used for the strict floor booleans in the plane compile (`native-circulation-clearance.ts`:120, 225–232, 255, 274) and for door and selection overlays. Its share of time was not measured. The November 6 profile leaves at most 16 % for everything outside the arithmetic module.

### Files, JSON and hashing (established: seconds)

- Guards plus writing `compiled-dataset.json` take 57 s in total (21:02:47–21:03:44).
- The landing receipt to the presentation line is 10 s.
- The efficiency README measured the zip at about 15 s.

### Repeated imports and validations (established: about 22 minutes, 9 %)

| Step | Minutes |
| --- | ---: |
| Source package, Reviter reader | 1.9 |
| Same package, OpenIndoorMaps reader | 3.9 |
| Rebuilt master | 7.1 |
| Export viewer (validates the mapping again) | 4.1 |
| Visitor package | 4.4 |

Inside each import, `materials` is about 2 minutes, `mapping` about 2.3 and `reviews` about 1.8 (package:576–609).

The mapping validation is memoised only per object (`content-checked-validation.ts`:120). A re-imported dataset is a new object, so it is validated again each time.

## 5. Checkpoints

| Checkpoint | What is stored | What the key binds |
| --- | --- | --- |
| Import data (`run/imports`, 1.2 GB) | both readers' results | archive bytes, reader code, loader and esbuild, Node binary hash and version, **`execArgv` and `NODE_OPTIONS`** (`private-import-checkpoint.ts`:83) |
| Landing candidates (`landing-approaches/<binding>.jsonl`) | one line per evaluated pair | binding (below), then a pair key: both nodes, landing flag, distance and region key (landing:96–98) |
| Plane drafts (`<binding>/<sha(task)>.checkpoint`) | one draft per plane | binding, task id, task input hash, result hash (pool:77) |

The landing and plane binding (pool:62–70) covers:

- an algorithm version string that includes the Node version (landing:210; planes:34);
- the absolute path and byte hash of the whole-model snapshot and the whole-dataset snapshot;
- the absolute path and hash of every file the worker imports, plus the resolver, the GEOS binary, `package.json` and `package-lock.json` (landing:195–205).

Nothing else is checkpointed. The front matter, presentation, cell routes, final replay and export mapping always rerun: about 130 minutes at yesterday's speeds. The saved `prepared-before-stair-finalization.bin` is a diagnostic; no code reads it back.

### Does one door aperture have to invalidate the other levels?

**By the key: yes, all of them.** The snapshot is the whole dataset, so any change gives a new binding.

- Any change to any wall, door, record or review state invalidates everything.
- So does `doorAperturePatchState`, any worker source file, the Node version, or a different work folder path.
- So can a difference that is only how V8 stored a number (the efficiency README's "0 of 1148 reused").

**By the data: no, but only code can prove it.**

- A landing pair reads its own plane only: floors, envelopes and material sections at that elevation, patch walls on that plane's levels, treads within 6 ft above, records at that elevation, and the pair's portal door (links:353–649).
- The pair plan cannot couple planes: it joins only walk, door and opening edges and pairs only nodes at the same elevation (links:1351–1371).
- The plane drafts are different. Each draft embeds the whole-dataset `sourceGeometryKey` (geometry:654–657), and that key covers all walls, all doors and the aperture state (geometry:197–202). The merge refuses a draft whose key differs (geometry:708), and the exact topology inside it is bound to that key (geometry:710).

**Could a rerun reuse them safely today?**

- With flags: no.
- By re-labelling old checkpoint lines by hand: it would bypass the binding without proof, and for planes it fails at the merge.
- Soundly: with plane-scoped keys and a guarded view that records every out-of-scope read. That is the prototype in Reviter 03ba0c4 (landings only, in-process only, campus equivalence not yet run). Planes also need their topology re-encoded under the new key, as `bindVisitorMapping` already does for the mapping (mapping:291–302).
- Cell numbering is not an obstacle to reuse. Drafts use plane-local indexes and the merge renumbers them (geometry:719, 731).

For a rerun with unchanged inputs, Reviter 17523c4 (value-based identity) makes landing and plane reuse reliable. It changes only `reviter/scripts/indoor` files.

## 6. Options, ranked

Savings are against yesterday's 244 minutes. "Receipts" means the Reviter module hashes recorded in `regeneration.json`. "Fingerprints" means the three OpenIndoorMaps runtime bindings.

The master zip is never byte-identical between runs, because `manifest.createdAt` is the current time (package:793). Compare `viewer/indoor.json` or `compiled-dataset.json`.

### (a) Today, flags and environment only

| # | Option | Saving | Risk to output and bindings | Basis |
| --- | --- | ---: | --- | --- |
| a1 | Rerun on the same VM: keep `run/imports`, the same folder path and exactly the same Node flags | 6 min | none | established (driver:244–257; the local log shows reuse 11 s after start) |
| a2 | `NATIVE_WORKERS=2` | about 8 min (planes 18.5 → about 10.5) | Output: none by design, drafts merge in elevation order. Run: two floor workers have not been tried with the gap patches, and a failure here loses the landing work. | estimated from the plane times |
| a3 | `LANDING_WORKERS=2–4` | perhaps 20–35 min | Output: none by design. Run: this is the failing mode. | guess; the only measurement is 1.8× with 7 workers before the patches |
| a4 | Leave `PARENT_HEAP_MIB` and the worker heap settings alone | 0 | Changing the main heap flag changes `execArgv`, which rebuilds the import data (6 min). The worker settings do nothing. | established |

Run the section 3 probe before a2 or a3.

### (b) Small code changes in the producer trees

All four Reviter commits (6721958, 17523c4, 03ba0c4, 0101686) pass `git apply --check` against `matcher/reviter` as one cumulative patch.

| # | Option | Saving | Risk to output and bindings | Effort |
| --- | --- | ---: | --- | --- |
| b1 | Faster exact arithmetic (0101686) in **Reviter's copy only**. Replace the one `Math.log2` call with an exponent read from the float's bits, which removes the test failure. | 85–95 min | Values: 11.8 million compared on November 6 with 0 differences up to the gate. Identity of an exported master is unmeasured. Fingerprints: unchanged if the OpenIndoorMaps copy is untouched; confirm by regenerating the three binding files. Receipts, checkpoint keys and probably the import key change. The two vendored copies stop being byte-identical; I found no test that requires them to match. | small |
| b2 | The same change in the OpenIndoorMaps copy | perhaps 12–18 min more (export mapping and mapping validations) | Changes all three fingerprints: commit 2adae9b edits exactly those three binding files. Needs re-admission. | small, plus re-admission |
| b3 | Value-based checkpoint identity (17523c4) | 0 on a clean run; up to 83 min on a rerun with unchanged inputs | Scripts only, no `lib` module. Checkpoint keys change once. | small |
| b4 | Progress lines for gap 1 (6721958) | 0 | Changes two `lib` files, so receipts change. Its test asserts an identical dataset. The export progress commit (57bb801) edits `package.ts` and would change fingerprints; leave it out. | small |
| b5 | Compute the explore mapping per level in parallel **from the driver** (child processes calling the exported `deriveNativeAreas`), then set `dataset.nativeExploreMapping` before export | about 15–18 min (27 → largest level plus a 2.3 min validation) | No runtime file edited, so fingerprints are unchanged. The export then validates the mapping and its hash (mapping:312–340, 820). Check `mappingSha256` once against a sequential run. | small to medium |
| b6 | Remove the floor-worker cap and raise the in-flight budget | 2–3 min beyond a2 (plane 0 alone is 7.5 min) | Scripts and driver only. Blocked by section 3. | small |
| b7 | Run landing workers as child processes instead of threads, if the probe points to in-process sharing | enables a3; perhaps 30–45 min with 7 workers | Scripts only. Same ordered replay. | medium |
| b8 | Memoise the door-half result per cell, door and node; convert obstacles once per region | unknown | `lib` changes. Pure functions, so values should not change. Needs a profile first. | small each |

The b1 estimate comes from the November 6 before-and-after stage times on the same G4, which showed 84 minutes saved.

### (c) Larger work

| # | Option | Saving | Risk | Effort |
| --- | --- | ---: | --- | --- |
| c1 | Cell routes and final replay in workers, per plane or per chunk of cells, merged in cell order; minority-owner pass afterwards | 45–60 min of the 70 (about 27 once b1 is in) | medium: edge order and ids must be reproduced; one campus equivalence run | 1–2 weeks |
| c2 | Build each plane's free region once and apply a portal's aperture as a local change; keep a region on the worker that built it | unknown, possibly most of the landing stage | medium to high: must prove identical exact faces | weeks |
| c3 | Plane-scoped keys for landings, planes and cells (finish 03ba0c4, carry it into the workers, re-key plane topology) | on a one-level change, most of landings and planes | medium; safe by construction if the guard is complete | 1–2 weeks |
| c4 | Checkpoints for the front matter per level and for the mapping per level | up to about 50 min on a rerun | low to medium | days |
| c5 | Run the import validations (materials, mapping, reviews) concurrently | 6–8 min | edits `package.ts`, so fingerprints change | days |

### Combined projection (estimates)

| Configuration | Minutes |
| --- | ---: |
| Yesterday | 244 |
| b1 | about 150 |
| b1 + b5 + a2 | about 125 |
| the above + working landing workers | about 110 |
| the above + c1 | about 85–90 |

About 50–55 minutes stay sequential in any case: import and review replays, walls and doors, ramps, presentation, and the import and validation gates at the end.

## Could not determine

- The cause of the multi-worker failures (section 3).
- The exact split inside the two silent gaps. Both are unlogged in the producer code.
- GEOS's share of time, and whether plane 0's floor intersection is ever cached.
- Per-level times of the export mapping on G4.
- Speed-up from 2–4 landing workers.
- Whether the b1 arithmetic produces a master whose `viewer/indoor.json` is byte-identical.
- What differs in the commits the run log names.

---

# Addendum: measurements on the Colab G4 machine, November 17, 2026 (UTC)

Run beside the second vestibule rebuild, on the same checkout and the landing-stage snapshots of that rebuild.

## The worker failure is the Linux memory-mapping limit (mechanism A)

- `vm.max_map_count` is 65,530 and cannot be changed on Colab (`sysctl`: read-only file system).
- The worker heap flag is ignored once the process has `--max-old-space-size` (repeated on the VM: a worker asked for 64 MiB dies at 40 MiB without the flag and keeps 300 MiB with it).
- Seven landing workers, `--max-old-space-size=8192`: the process reached 65,376 mappings at 132 s with 17.7 GiB resident (167 GiB free on the machine) and aborted with `FATAL ERROR: Committing semi space failed. Allocation failed - JavaScript heap out of memory`, exit 134. Each worker held about 1 GiB of live data in a 2–3 GiB heap.
- The real main process alone held 21,076 mappings at 8.2 GiB during the wall-and-door stage, so a real run has about 44,000 mappings (about 11 GiB of heap) left for all workers together.

## Landing workers scale poorly even when they run

Pairs replayed in order, same snapshots, same machine:

| Configuration | Pairs after about 650–670 s | Rate | Peak mappings |
| --- | ---: | ---: | ---: |
| Real run, 1 worker in the main thread | about 195 | 17 per minute | — |
| Probe, 4 workers | 225 (672 s) | 20 per minute | 47,566 |
| Probe, 7 workers, `--max-old-space-size=2048` | 275 (650 s) | 25 per minute | 46,586 |

The probe times include about a minute of start-up. Four workers would not fit beside the real main process (47,566 + about 17,000). The 2 GiB cap cannot be used in a real run because the same flag caps the main thread, which needs about 8 GiB.

## Side-by-side rebuild with the faster exact arithmetic (option b1): measured

Same machine, same trees, inputs and reviews (`vestibules-c`), one floor worker and one landing worker. The only difference is Reviter commit 0101686 applied to Reviter's copy of the arithmetic module.

| | Ordinary | Faster arithmetic |
| --- | ---: | ---: |
| Wall time | 250 min (01:23–05:33 UTC) | 143 min (02:12–04:35 UTC) |
| `viewer/indoor.json` sha256 | `a987e656…` | `a987e656…` (byte-identical) |
| `floors/rooms.json` sha256 | `ccba8f53…` | `ccba8f53…` (byte-identical) |

Stage times, yesterday's ordinary run against the faster run (minutes):

| Stage | Ordinary | Faster |
| --- | ---: | ---: |
| Import and setup | 17.6 | 15.2 |
| Walls and doors | 8.8 | 4.7 |
| Ramps | 7.7 | 3.3 |
| Landing approaches | 65.1 | 24.0 |
| Room presentation | 5.4 | 5.4 |
| Floor planes | 18.0 | 6.8 |
| Cell routes | 43.1 | 23.0 |
| Final replay | 27.3 | 10.0 |
| Diagnostic and stairs | 2.6 | 2.6 |
| Export master | 31.8 | 31.8 |
| Re-import and checks | 16.6 | 16.6 |
| Total | 244.0 | 143.4 |

The export and the re-imports (48 minutes) did not change because they use OpenIndoorMaps' own copy of the arithmetic module, which was left untouched. They are now a third of the run and the next target (options b2 and b5).

Files: `~/unbc-work/vest-master2/A-*` (ordinary) and `b1-*` (faster); the patch is `b1-exact-arith.patch` here.

## Faster arithmetic in the OpenIndoorMaps copy as well (option b2): measured

The reviewed-link tool (imports the 247 MB master, then exports it) on OpenIndoorMaps `a983561` and Reviter `2e7875d`, same master (`e5d6ca92…`), with the same fast arithmetic file copied over both vendored copies:

| | Ordinary | Fast in both copies |
| --- | ---: | ---: |
| Import | 363 s | 253 s |
| Whole step (import + export) | 1,965 s (32.8 min) | 1,270 s (21.2 min) |
| Output `viewer/indoor.json` / `floors/rooms.json` | `ed1841e2…` / `7b8f2a51…` | identical |

This changes OpenIndoorMaps runtime files, so the three runtime binding fingerprints change and published receipts must be re-admitted.

## CPU profile of the remaining export (fast arithmetic in both copies)

`exp-export.cpuprofile` in `~/unbc-work/vest-master2/` (2 ms sampling, 1,240 s). Export phase, 987 s:

| Share | Seconds | Where |
| ---: | ---: | --- |
| 77 % (inclusive) | 758 | `deriveNativeAreas`: the room-exploration mapping, one level after another on one core |
| 19 % | 191 | `native-provisional-corner-seals.ts` (including building its index) |
| 15 % | 148 | exact arithmetic (was the majority before) |
| 9 % | 90 | `native-derived-frame-returns.ts` |
| 8 % | 81 | SHA-256 computed in JavaScript (`@noble/hashes`, from `content-checked-validation.ts`) |
| 8 % | 80 | garbage collection |

Import phase, 253 s: JavaScript SHA-256 and the content-keyed validation around it 18 %, corner seals 11 %, arithmetic 10 %, garbage collection 9 %.

Not measured: how often the corner-seal index is rebuilt, and the gain from running the mapping per level in parallel.
