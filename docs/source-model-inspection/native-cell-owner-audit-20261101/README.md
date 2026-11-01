# Native-cell door owner matcher audit — November 1, 2026

`lib/reviter/directory-navigation.ts` gains an opt-in `native-cell` door owner
matcher. Each door side's owner is the nearest room by outline inside the
native wall-bounded cell found just past that face of the door footprint. It
decides only for two different cells with two different, walkable, untied
owners, never overrides a reviewed door link, and by default only fills doors
the legacy matcher left unmatched or ambiguous. The default owner gap is the
legacy 2 ft reach (`NATIVE_DOOR_OWNER_MAX_GAP_FEET`), so enabling the mode
never widens ownership. The legacy matcher remains the default and is not
changed. The mode is not wired into the indoor pipeline.

`scripts/audit-native-cell-door-owners.ts` replays the rule on the compiled
UNBC data (per-level preview cells and rooms, compact graph doors, and the
Python door-side probe), [AUDIT-SUMMARY.json](AUDIT-SUMMARY.json):

- 1,899 doors; the TypeScript and Python side/cell classification agree on all
  1,896 compared rows.
- Of 1,619 saved connected doors, 1,300 agree with the native rule, 2 would
  change (1513453 in merged cell 616 and 1630256 at two generated landings,
  both judged wrong) and 317 keep their legacy owners for lack of a native
  decision. Under the default fill-only policy no connected door loses or
  changes an owner; the two disagreements are reported as conflicts.
- 18 unmatched or ambiguous doors would be filled (46 without the 2 ft bound).
  Each fill needs review before the mode is enabled for a rebuild.

Merged native cells 561, 563, 616, 647 and 826 join rooms across partitions
and cause the wrong changes and several doubtful fills; they need source
boundary repair in the native build, not a matcher setting.
