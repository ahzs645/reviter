# UNBC continuation handoff — November 17, 2026

For the agent who continues this work. It covers November 16–17: repository
cleanup, the local requalification of the gap-patched master, the cut-off
vestibules, two full rebuilds on Google Colab, and the speed investigation.

Read this file first, then the vestibule record in the sibling repository:
`../openindoormaps/docs/continuation/unbc-20261116/vestibules/README.md`
(evidence, hashes and receipts for everything below). Performance detail is
in [PERFORMANCE.md](PERFORMANCE.md).

Nothing in this handoff has been published as a new map dataset.

**Correction, November 17 (later):** both `main` branches *were* pushed to
GitHub (Reviter `41a1ada`, openindoormaps `312e363`, equal to the
`handoff/unbc-20261117` branches). The OpenIndoorMaps Pages site redeployed
(docs plus two map-fit fixes). Reviter CI failed at lint on the two recorded
Colab scripts in [colab/](colab/), so its site did not redeploy until the lint
fix that follows this note. The owner's answers to the open decisions are in
[OWNER-DECISIONS.md](OWNER-DECISIONS.md).

## Standing rules from the owner

1. **Heavy processing runs on Google Colab, not on the Mac.** That means
   full rebuilds, and by extension the link, guide, acceptance and visitor
   steps. Small read-only checks on the Mac are fine. How to use Colab is in
   "Running on Colab" below.
2. Do not push either `main` without asking: each push redeploys a GitHub
   Pages site.
3. The project rules in `AGENTS.md` apply (preserve native bytes, no invented
   connections, report unresolved evidence as unresolved).
4. The owner was new to Revit when the model was made and expects some
   problems to be fixed in the Revit file itself, in one batch, not per fix.

## Where things stand

### Vestibules (the task the owner cares about)

| Vestibule | State |
| --- | --- |
| 03-1052 | Works. On the main walking network through door 1425507. |
| 07-309 | Door 621887 to 07-305 works. The suite it joins (8 rooms) is still an island. |
| 06-313 | Door 1779388 to 06-314 Projection works. The pair is an island. |
| 10-1300 | Not routable. Compiler side solved in a candidate; the app side is not written. See "10-1300" below. |
| 06-207 | Unchanged island with washrooms 06-208 and 06-209. Wall 1327847 has no door. Waiting on the owner: is it entered through the 5 ft bay toward corridor 06-210? |

### Masters (all on the Mac in `~/unbc-work/vest-master2/`, none published)

| Name | sha256 | What it is |
| --- | --- | --- |
| `A-UNBC.master.reviter.zip` | `e5d6ca92215b8486…` | Ordinary rebuild, November 17: gap patches, door record `vestibules-c`, owner review for doors 621887 and 1779388 |
| `A-master-0388.zip` | `f554adc01c2208a0…` | The same with the 06-388 link. **Best fully checked master.** Standard acceptance 33/33, vestibule cases 11/11, preview and visitor package built |
| `C-UNBC.master.reviter.zip` | `bde63f0a9177baba…` | Candidate: the same inputs plus two code patches (faster arithmetic, own-host fallback rule) |
| `C-master-0388.zip` | `05867b77d7aaa0f1…` | Candidate with the 06-388 link. Standard acceptance 33/33 (rows identical to A); the four 10-1300 route cases fail |

Earlier masters, for reference: source `d5a829e8…`, gap-patched
`65536052…`, gap-patched with the 06-388 link `ae70cc07…` (requalified
locally on November 16, in `~/unbc-work/gap-requal/`).

The candidate dataset differs from the ordinary one by exactly one walk
(`native-cell:3.280840:481:walk:arrival:rm-1487816-5550ce486504|door:1487816:2471813:0`),
the 10-1300 `arrivalNodeId`, one issue, the report counts and the derived
explore mapping.

### Repositories

| Repository | State |
| --- | --- |
| `reviter` local `main` | Pushed: `origin/main` = `handoff/unbc-20261117` (`41a1ada`) on November 17. `.claude/launch.json` is modified locally (preview servers with local paths) and not committed. |
| `openindoormaps` local `main` | Pushed: `origin/main` = `handoff/unbc-20261117` (`312e363`) on November 17; Pages redeployed. |
| Producer code with the door-owner review | Branch `unbc/producer-native-door-owners` on GitHub in both repositories (Reviter `8fecc9a`, tree `7ff09c0a…`; openindoormaps `131a8e2`, tree `1f2048d5…`). Local clones in `~/unbc-work/matcher/`. Also as patches in [patches/](patches/). |
| Receipts for `ae70cc07…` | openindoormaps branch `unbc/gap-requal-ae70cc07` (`9cc7363`) on GitHub; local worktree `~/unbc-work/pair/openindoormaps`. |
| Held back on GitHub | `claude/exact-arith-speed` (both), openindoormaps `claude/regen-efficiency-oim`, reviter `codex/local-work-snapshot-2026-09-29`, `codex/rvt-semantics-candidate4`, openindoormaps `stash/local-changes-2026-06-03` |

A copy of the outputs, scripts, records and agent notes is in the owner's
Google Drive at `My Drive/UNBC-handoff-20261117/` (2.3 GB, with a checksum
manifest).

Both CI workflows pin the sibling by commit: openindoormaps pins Reviter
`2e7875d`; Reviter pins openindoormaps `65c85bb`.

## How the rebuild is assembled

Producer code is the October 21 pair plus patches, not `main`:

- openindoormaps `7c27b67` + `0001`–`0003` in [patches/](patches/)
- Reviter `cb140e46` + `r0001`–`r0004`

Inputs: the October 21 inputs (fetched from Drive by
`docs/continuation/unbc-20261021/recompile/fetch-inputs.py` in the producer
openindoormaps tree), the 132 gap patches and supersessions
(`openindoormaps/docs/continuation/unbc-20261103/gap-patches/`), the applied
gap-patch archive `applied-gap-patches-73a765e9.zip`, and the two review
files in [reviews/](reviews/):

- `DOOR-APERTURE-REVIEW.vestibules-c.json` (`4031143b…`): four curtain-door
  apertures (two Building 4–8 link doors, 2471813 for 10-1300, 1425507 for
  03-1052). Door 1425511 is left out: one reviewed aperture per host wall.
- `NATIVE-DOOR-OWNER-REVIEW.vestibules.json` (`4cd90213…`): doors 621887 and
  1779388, owners taken from native cells for these two doors only.

Driver: `docs/continuation/unbc-20261021/recompile/run.sh WORK` with the
environment in [colab/colab2-launch.py](colab/colab2-launch.py).

After every rebuild ("Job B", reader side: openindoormaps `origin/main`
`a983561` + Reviter `2e7875d`): re-add the 06-388 link, compile guides, run
acceptance, build the preview and the visitor package. One script does all of
it: [colab/colab2-jobb.sh](colab/colab2-jobb.sh).

## 10-1300: what is known and what is left

1. The door (2471813) is a curtain-wall door with a 100 mm wall (2472128)
   drawn across it. The reviewed aperture cuts both. Legacy matching connects
   10-1300 to 10-1302 Atrium.
2. An aperture as deep as the 3.28 ft approximate band leaves an orphan strip
   (first rebuild). An aperture on the frame face (`vestibules-c`) removes the
   strip but the room still gets no arrival.
3. Cause, measured as exact fractions: cell 481 and all native material end
   at y = 762.393470386072; the indoor envelope's wall-zone part starts 247
   units in the last place higher (2.8e-11 ft). The portal's threshold half is
   cut to the envelope, so its exact union with the cell has two parts.
4. Compiler rule that fixes it, tested campus-wide (adds exactly one walk,
   changes no other): [patches/rule2-own-host-fallback.diff](patches/rule2-own-host-fallback.diff)
   in Reviter `lib/reviter/native-circulation-geometry.ts`. Rejected variant:
   always counting the host material changed 169 walk lengths.
5. **Still to do:** the app replays each walk itself and blocks this one
   (`native-circulation-proof`). The same fallback is needed in openindoormaps
   `app/indoor-project/native-circulation.ts` (the `pathUnionSupported` check
   at line 933) with the halves from `app/indoor-project/native-door-approach.ts`.
   Those are runtime modules: the three binding fingerprint files change
   (`scripts/indoor/prepared-display-engine-binding.ts`,
   `published-route-runtime-binding.ts`, `published-visitor-plan-runtime-binding.ts`)
   and published receipts need re-admission. Then requalify
   `C-master-0388.zip` with `reviews/ROUTE-CASES-VESTIBULES-C.json` (expects
   10-1300 to route). No new rebuild is needed for that test.
6. The owner has **not** decided to adopt the rule. Ask before making it part
   of the producer or the app.
7. A cleaner long-term answer is a stated contact tolerance at cell/envelope
   joins (the project documents a 1e-7 ft rule; see
   `openindoormaps/docs/continuation/unbc-20261105/sliver-contacts/`), or
   fixing the wall in Revit.

Diagnostic method that found this (reusable): an instrumented copy of the
producer's `nativeCellDoorApproach` run on the rebuilt `viewer/indoor.json`
([colab/diag-patch.py](colab/diag-patch.py), [colab/diag.mts](colab/diag.mts)),
and a replay of the whole cell-route stage with and without a rule
([colab/attach2.mts](colab/attach2.mts), [colab/rule2-patch.py](colab/rule2-patch.py)).
Test routes with the acceptance harness, not graph connectivity: the router
refuses a room with no `arrivalNodeId`, and a later link cannot supply one.

## Speed

Full detail and tables: [PERFORMANCE.md](PERFORMANCE.md).

| Finding | Evidence |
| --- | --- |
| A rebuild is 250 min ordinary, 143 min with Reviter commit `0101686` (faster exact arithmetic) applied to Reviter's copy only | Two side-by-side runs on one machine; `viewer/indoor.json` and `rooms.json` byte-identical |
| The same file in the openindoormaps copy: import 363 s → 253 s, link step 32.8 → 21.2 min, output identical | Measured; changes runtime fingerprints |
| Seven landing workers abort at 65,376 of 65,530 memory mappings with 17.7 GiB in use | `vm.max_map_count`, read-only on Colab; not memory |
| Worker heap flags do nothing once the process has `--max-old-space-size` | Checked on Node 22.22.0, Mac and Colab |
| Workers scale poorly on landings (7 workers about 1.5×) | Each worker rebuilds the same whole-floor regions |
| Remaining export: 77 % is the explore mapping, one level at a time | CPU profile `~/unbc-work/vest-master2/exp-export.cpuprofile` |

Next levers, in order of value: adopt the faster arithmetic; apply the 06-388
link inside the rebuild; build the explore mapping per level in parallel; two
floor-plane workers (`NATIVE_WORKERS=2`); the faster arithmetic in the
openindoormaps copy; plane-scoped checkpoints so one door redoes one floor.
None is adopted. `b1-exact-arith.patch` is in [patches/](patches/).

## Running on Colab

CLI: `~/.local/bin/colab` (v0.7.5; `new`, `exec`, `upload`, `download`, `ls`,
`sessions`, `usage`, `stop`). Balance on November 17: 434.6 units.

- `colab new -s NAME --gpu G4`: 48 cores, 176 GB, about 10 units an hour. If
  G4 is "Service Unavailable", `--high-mem` gives 8 cores and 50 GB at 0.26
  units an hour, about twice as slow per step; enough for Job B, not for a
  rebuild in one session.
- **A session ends by itself after about 6.6 to 7 hours** (seen twice).
  Nothing is synced to Drive from the CLI (`drivemount` is interactive). Plan
  for six hours and download every output as soon as it exists.
- **The command channel (`colab exec`) can hang for good while the machine
  keeps running.** `ls`, `download` and `upload` keep working. Start jobs with
  `setsid nohup`, keep each `exec` short, and watch by downloading small log
  files ([colab/harvest2.sh](colab/harvest2.sh), [colab/harvest3.sh](colab/harvest3.sh)).
- Uploads over about 24 MB fail: `split -b 24m` and `cat` on the VM. Downloads
  of 250 MB work.
- A rebuild uses one core, so several can run side by side in separate work
  folders on one G4 at no extra cost.
- Setup and launch: [colab/colab2-setup.sh](colab/colab2-setup.sh),
  [colab/colab2-launch.py](colab/colab2-launch.py). Fresh-session Job B for an
  uploaded master: [colab/colab3-jobb.sh](colab/colab3-jobb.sh).
- Stop the session when done: `colab stop -s NAME`.

Typical times on G4: rebuild 250 min (143 with the faster arithmetic), link
33, guides 17, both acceptances 15, visitor package 35.

## Open decisions for the owner

1. Adopt the faster arithmetic into the producer (Reviter copy only)?
2. Add the own-host fallback rule to the compiler and to the app, accepting
   new fingerprints and re-admission?
3. Build the next speed-ups (link inside the rebuild, per-level parallel
   mapping)?
4. How is 06-207 entered?
5. Push the two `main` branches (redeploys both Pages sites)?
6. Accept or rebase the 8 policy-matrix distances (06-364 ↔ 06-397/06-398,
   0.12–0.20 m longer than `POLICY-EXPECTATIONS.json`) from the November 16
   local requalification?
7. Fix the model in Revit, once, in a batch: wall 2472128 across door
   2471813, an opening in wall 1327847 for 06-207, placed Rooms, the unnamed
   800 sq ft space east of door 1779387, the bottom mullions at curtain doors,
   unjoined walls. A re-saved file is a new source: every review file bound to
   model `8c294549…` must be re-bound.

## Not done

- No publication steps for any new master: directions cache, floor and plan
  receipts, site build, policy matrix, browser proof, campus map.
- The campus map for `ae70cc07…` was rebuilt locally but not committed
  (`regression-door-clipping.py` pins a renumbered Floor 3 cell, 826 → 890).
- The sliver-contact compiler fix stays blocked at the arrival gate for room
  09-S302.
- Door 1425511, the Floor 3 Building 4–8 link door 2315416 and the exterior
  doors of the vestibules stay unmatched.
- A lead from rvt-rs is unchecked: it counts 32 doors on this model that cut a
  wall other than their host (from each wall's own record). Whether Reviter
  cuts those walls is not known.

## Other tools that were tried

BIMCraft (`~/Downloads/BIMCraft-main`) and rvt-rs (`~/Downloads/rvt-rs-main`)
both read the UNBC Revit file in seconds and both are read-only. Neither can
fix the model or speed the rebuild. rvt-rs marks walls 2472128 and 1327847 as
uncut, which agrees with Reviter. Small outputs: `~/unbc-work/bimcraft-out/`,
`~/unbc-work/rvtrs-out/`.

## Local folders (`~/unbc-work/`)

| Folder | Content |
| --- | --- |
| `vest-master2/` | `A-*` and `C-*` masters, links, guides, acceptance reports, previews, visitor packages; `b1-*` and `exp-*` timing evidence |
| `gap-requal/` | November 16 local requalification of `ae70cc07…`; the preview servers in `.claude/launch.json` serve from here |
| `matcher/`, `pair/` | The unpushed branches above |
| `vestibules/` | Measured evidence for the five vestibules (`evidence/EVIDENCE.md`), mechanism notes (`MECHANISMS.md`) |
| `colab/` | Every script and log used on Colab |
| `perf/` | The performance report and patches |
| `rvt/model.rvt` | Local copy of the Revit model (`8c294549…`) |
| `vest-master/` | Receipts and logs of the first Colab run only |

Mac notes for small checks: Node 24.19.0 is `~/unbc-work/bin/node24` (a link
into the npx cache; recreate it with `npx node@24.19.0` if it is gone); set
`TZ=UTC`; Python with shapely is `~/anaconda3/bin/python3`.
