# Native-cell door owner matcher audit — November 1, 2026

`lib/reviter/directory-navigation.ts` gains an opt-in `native-cell` door owner
matcher. Each door side's owner is the nearest room by outline inside the
native wall-bounded cell found just past that face of the door footprint. It
decides only for two different cells with two different, walkable, untied
owners. The legacy matcher remains the default and is not changed.

**Status: not wired into the indoor pipeline.** `lib/reviter/indoor-pipeline.ts`
calls `directoryDoorReviews` with the default legacy matcher. Nothing below
changes any saved or compiled door. Every fill counted here is a proposal for
per-door review, not an accepted ownership decision.

## Precedence (revised November 2, 2026)

Explicit reviews take precedence over automatic native matching:

- An **accepted** reviewed link is applied as written (its room order, marked
  `reviewed`). The native rule does not decide the door.
- A **rejected** review (present in `explicitReviews` but absent from the
  accepted links, e.g. a semantic link refused upstream) keeps the legacy
  outcome. The native rule never fills or re-owns it, `overrideLegacy`
  included. `nativeOwners.decided` is false, and
  `nativeOwners.explicitReview` carries `status: "rejected"`, a reason and the
  unchanged rejected link (rooms and any `semanticEvidence` source identity).
  The native proposal stays visible in `nativeOwners.rooms` as evidence only.
- Automatic native filling applies only where no explicit review exists. By
  default it fills doors the legacy matcher left without a portal. A
  disagreement with a legacy portal is reported as a conflict and the legacy
  owners stand unless `overrideLegacy` is requested.

Before this revision the native mode filled a door whose review had been
rejected and returned it as connected, with `hasExplicitReview: true` and
`decided: true`. An external review reproduced this. The legacy mode's output
is unchanged. Hashing the legacy output on the UNBC preview data, with
synthetic accepted and rejected reviews on 1,087 doors, gives the same digest
before and after the revision.

Accepted links are still checked against the native-mode candidate list (legacy
candidates plus native owners). In native mode, an accepted link can therefore
reach a room whose outline stops short of the door. Legacy mode would refuse
that link. On the same synthetic replay this happens for 6 accepted doors.

## The gap bound is not the legacy reach

The native default `maxOwnerGapFeet` is 2 ft (`NATIVE_DOOR_OWNER_MAX_GAP_FEET`),
the same number as the legacy reach, but it bounds a different region:

| | Measured from | Limit |
|---|---|---|
| legacy | the door centre | nearest outline point within 2 ft, and within half-width + 0.6 ft in X and half-height + 0.6 ft in Y |
| native | a side probe at footprint depth + the first step (0.25, 0.5, 1 or 1.5 ft) that lands in a native cell, along the normal | nearest outline in that cell within 2 ft of the probe; no XY envelope |

Along the normal, the native mode therefore reaches up to depth + step + 2 ft
from the door centre. For a door with 0.1 ft half-depth that is 2.35 ft at
the 0.25 ft step, and up to 3.6 ft when the first cell is found at the
1.5 ft step. Example (tested): at a thin-wall door, an office outline 2.1 ft
from the door centre is rejected by legacy, which only allows 0.7 ft in X
there. It is 1.75 ft from the 0.25 ft probe, so the native mode accepts it.

**Enabling the mode can widen ownership beyond the legacy reach.** That is how
it fills doors whose outlines stop short. The 2 ft default limits how far it
widens; it does not keep it within legacy reach. Lower the bound, or raise it
only with per-door review.

## Audit

`scripts/audit-native-cell-door-owners.ts` replays the rule on the compiled
UNBC data (per-level preview cells and rooms, compact graph doors, and the
Python door-side probe). It passes no reviewed links, so the precedence
revision cannot change its results.
[AUDIT-SUMMARY.json](AUDIT-SUMMARY.json):

```
node --experimental-strip-types --import ./scripts/register-local-typescript.mjs \
  scripts/audit-native-cell-door-owners.ts \
  PREVIEW_DATA_DIR graph-compact.json native-door-sides.json|- OUT.json
```

Rerun on November 2, 2026 against the same input bytes (SHA-256 values in
`inputs`; about 5 s, 219 MB peak RSS). The output is identical to the
November 1 run.

- 1,899 doors. The TypeScript and Python side/cell classifications agree on all
  1,896 compared rows.
- Of 1,619 saved connected doors:
  - 1,300 agree with the native rule.
  - 2 would change: 1513453 in merged cell 616 and 1630256 at two generated
    landings. Both changes were judged wrong.
  - 317 keep their legacy owners because the rule makes no native decision.

  Under the default fill-only policy no connected door loses or changes an
  owner. The two disagreements are reported as conflicts.
- 18 unmatched or ambiguous doors would be filled (46 without the 2 ft bound).
  These 18 are **proposals**, not accepted fills. Each needs a source
  ownership review before the mode is wired into a rebuild. Two of them
  (1352575, 1968823) name a stair owner.

Merged native cells 561, 563, 616, 647 and 826 join rooms across partitions.
They cause the wrong changes and several doubtful fills. The fix is source
boundary repair in the native build, not a matcher setting.

## Doors needing source review

- **2315416** (08-360 Link / Building 08 side, Campus Floor 3, level 400176).
  The nearest owner on the Building 08 side (cell 826) is 2.962 ft from the
  probe. That exceeds the 2 ft default, so the native matcher does **not**
  fill this door. It stays unmatched. The unlabelled strip on that side may
  belong to 08-316, 08-305 or a vestibule. It needs a source ownership review;
  raising the bound would only guess.
- **2471813** (10-1300 Vestibule / 10-1302 Atrium, level 1487816). It fits the
  bound (gaps 0 and 1.482 ft) and is one of the 18 proposals. It still has
  unresolved host-wall, frame and aperture evidence: the retained leaf is
  0.21 ft inside a 3.2808 ft host band, and element 2472128 crosses the
  passage. Owner names alone do not qualify this passage, so the proposal
  must not be accepted until that evidence is reviewed.
