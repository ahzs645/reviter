# UNBC owner decisions — November 17, 2026

The owner answered the sixteen open questions on November 17, 2026, using the
decision page (claude.ai artifact "UNBC Map Decisions"). **These answers are
settled. Do not re-investigate or re-ask them; build on them.** A later answer
from the owner replaces one here; record it in this file with a date.

Machine-readable copy: [OWNER-DECISIONS.json](OWNER-DECISIONS.json).

Lines marked _Reading_ are the agent's interpretation of an owner note. They are
not the owner's words; confirm with the owner if one matters to a change.

## Standing rule from these answers

**No Revit re-save.** The owner expects no fix in the Revit file from now on
(D9 note). Model problems are fixed in our own data and code: reviewed records
bound to model `8c294549…`, and compiler rules. The "Revit batch" (D14) is
therefore a batch of our own source reviews, applied once, not a new model.

Heavy processing still runs on Google Colab. The owner runs it from a local chat
using what is committed on the branch (D14 note).

## Places

| #   | Question                                 | Answer                                                             | Owner note                                                          | What it means for the work                                                                                                                                                                                  |
| --- | ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | How is 06-207 Vestibule entered?         | **Open bay to 06-210 Corridor**                                    | "it opens to the outside"                                           | Add a reviewed drawn opening between 06-207 and 06-210 across wall 1327847. _Reading:_ 06-207 is also an entrance vestibule from outside, so its exterior door is a building entrance.                      |
| D2  | Is the 07-305 suite reached from inside? | **Yes, through the gap between doors 1732467 and 1715768**         | —                                                                   | Model that passage as a reviewed connection so 07-303…07-308 join the network.                                                                                                                              |
| D3  | How is the 06-313 booth reached?         | **Staff-only**                                                     | "its locked to get to the projector room"                           | Record 06-313 and 06-314 as staff access. Not a visitor destination. The unnamed 800 sq ft space east of door 1779387 stays unnamed.                                                                        |
| D4  | Routes through rooms into 06-372…06-386? | **Through 06-372 Reception and 06-376 Open Work Area only**        | "06-372 and 06-376 is the open area… just an open area with a desk" | Review 06-372 and 06-376 as walk-through (open area). Other rooms stay private.                                                                                                                             |
| D5  | Is 04-259 Rotunda a hallway?             | **Rotunda is circulation; 04-256 and 04-257 are enclosed offices** | —                                                                   | Mark 04-259 (and its 04-124, 04-329, 04-445 records) as circulation. Fix the 04-256/04-257 boundary leak in our own boundary review, not by making them walk-through.                                       |
| D6  | Where does door 2315416 open?            | **Straight into 08-316**                                           | —                                                                   | Add a reviewed owner pair 08-360 Link ↔ 08-316 for door 2315416 (Floor 3).                                                                                                                                  |
| D7  | The 28 held stairs                       | **Keep held until after the rebuild from main (D12)**              | —                                                                   | No routing change now.                                                                                                                                                                                      |
| D8  | Step-free routes                         | _Not answered as an option_                                        | "assume the doors are fine just the ramps vs stairs?"               | _Reading:_ treat every door as step-free; stairs and steps are not step-free; ramps and lifts are. Unknown access on other edges stays unknown. Confirm with the owner before publishing a step-free claim. |

## Technical

| #   | Question                      | Answer                                                                                          | Owner note                                                                                                | What it means for the work                                                                                                                                                          |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D9  | 10-1300 fix                   | **One tolerance rule at all joins**, tested on 10-1300 and the November 5 sliver cases together | "assume going forward there is not revit fix, but if we can make a fix ourselves that would be good"      | Replace the one-door own-host rule and the November 5 sliver rule with one stated tolerance at cell/outline/wall joins (documented 1e-7 ft). Resolve the 09-S302 arrival gate stop. |
| D10 | Faster exact arithmetic       | **Adopt in both repositories**                                                                  | —                                                                                                         | Adopt `0101686` (Reviter) and the openindoormaps copy. Runtime fingerprints change: re-admit published receipts.                                                                    |
| D11 | Next speed-ups                | **Both**: the 06-388 link inside the rebuild, and the explore mapping per level in parallel     | —                                                                                                         |                                                                                                                                                                                     |
| D12 | Rebuild base                  | **Rebuild from main**                                                                           | —                                                                                                         | Stop patching the October 21 code. Keep tags on the old bases for reproducing old masters.                                                                                          |
| D13 | 8 longer policy-matrix routes | **Update expectations to the new values**                                                       | —                                                                                                         | 06-364 ↔ 06-397/06-398, 0.12–0.20 m longer.                                                                                                                                         |
| D14 | Model fixes in one batch      | **Yes, after D1–D6**                                                                            | "push what you need to this branch committed and then I will open a local chat to run it in Google Colab" | Per the standing rule above: one batch of our own reviews (D1–D6 and D9), committed on the work branch, run on Colab by the owner.                                                  |
| D15 | Failing Reviter build         | **Push the lint fix to main**                                                                   | —                                                                                                         | Done November 17 (this commit).                                                                                                                                                     |
| D16 | Old branches                  | **Tag the three build bases, delete the fully merged branches**                                 | —                                                                                                         | Tags keep every commit reachable.                                                                                                                                                   |

## Already settled before November 17

- 03-1052 Vestibule routes from the main network (door 1425507).
- 06-388 and 8 of its 16 rooms route through the reviewed link; the other 8 are D4.
- Patches r0001–r0003 are identical to `main` commits `3071cf2`, `7f83240`, `7a5a403`.
