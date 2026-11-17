# UNBC indoor map: where it stands — for the owner

November 17, 2026. A plain summary of the last two days, what to hand the
next agent, and what to copy to Google Drive. The technical version is
[HANDOFF.md](HANDOFF.md).

## What was done

1. **Cleanup.** The worktrees and branches of both repositories were sorted
   out. Everything safe is merged into the two local `main` branches. They are
   not pushed.
2. **The earlier master was re-checked on the Mac** (November 16): acceptance
   33/33, map and pathway preview rebuilt, eight browser journeys pass on
   desktop and phone.
3. **The five cut-off vestibules were investigated**, door records were
   written for them, and the whole campus was rebuilt twice on Google Colab.
4. **The rebuild was made faster**: from 250 minutes to 143, with an identical
   result. The cause of the "out of memory" crashes with extra workers was
   found.
5. **Two other Revit readers were tried** (BIMCraft and rvt-rs). Both open the
   model in seconds; neither can edit a Revit file.
6. **About 10 GB of temporary files were removed** from the Mac.

## The vestibules

| Vestibule | Now |
| --- | --- |
| 03-1052 | Works. You can route to it from anywhere on the main network. |
| 07-309 | Its door to 07-305 works, but that office suite is not reachable from the public network. |
| 06-313 | Its door to 06-314 Projection works, but that pair is not reachable either. |
| 10-1300 | Does not work yet. The compiler part is solved in a test build; the app also needs the same change. |
| 06-207 | Unchanged. The wall has no door in the model. It needs your answer on how the room is entered. |

## The files that matter

All on the Mac in `~/unbc-work/vest-master2/`:

- **`A-master-0388.zip`**: the best fully checked master. Acceptance 33/33,
  vestibule checks 11/11. Its preview is `A-preview.tgz` and its visitor
  package is `A-progressive.independent-18fa1868….campus-viewer.zip`.
- **`C-master-0388.zip`**: the test build with the 10-1300 change and the
  faster code. Same results as A; 10-1300 still refused by the app.

No new map dataset is published. **Correction:** both `main` branches were pushed on November 17; see [OWNER-DECISIONS.md](OWNER-DECISIONS.md) for what followed.

## Decisions waiting on you

1. Use the faster code for future rebuilds? (Measured: same result, 107
   minutes saved.)
2. Make the 10-1300 change in both the compiler and the app? It works in the
   compiler test; the app side still has to be written, and published
   receipts would have to be re-issued.
3. Build the next two speed-ups (the 06-388 link inside the rebuild, and one
   export step in parallel)?
4. How is 06-207 entered: through the 5 ft bay toward corridor 06-210?
5. Push the two `main` branches? Each push redeploys a GitHub Pages site.
6. Fix the Revit model once, in a batch (list in HANDOFF.md, decision 7).

## What to give the next agent

Start the session in `~/github/reviter` on this Mac, so the
agent has both repositories, the work folder and its saved notes. Then paste:

```text
Continue the UNBC indoor map work. Read
docs/continuation/unbc-20261117/HANDOFF.md first, then the vestibule record at
../openindoormaps/docs/continuation/unbc-20261116/vestibules/README.md.

Rules:
- Do heavy processing (rebuilds, link, guides, acceptance, visitor package) on
  Google Colab with the colab CLI, not on this Mac. Small read-only checks on
  the Mac are fine. Colab sessions end after about 6.5 hours, so download each
  result as soon as it exists and stop the session when done.
- Do not push either main branch, publish anything or delete files without
  asking me.
- Tell me plainly what is verified and what is not.

What I want next: <write your choice here, for example one of these>
- Finish 10-1300: add the same fallback rule to the app's walk check, re-test
  C-master-0388.zip with the vestibule route cases, and tell me what
  re-admission would involve before doing it.
- Adopt the faster arithmetic into the producer and show me the result is
  identical again.
- Build the next speed-ups listed in the handoff.
- 06-207 is entered through <your answer>; work out how to model that.
```

If the next agent runs somewhere else (not this Mac), it also needs the
folders listed below, and the two unpushed branches pushed to GitHub first.

## What to save in Google Drive

These exist only on this Mac. A suggested folder: `My Drive/UNBC-handoff-20261117/`.

| Copy | Size | Why |
| --- | ---: | --- |
| `~/unbc-work/vest-master2/` | 1.1 GB | The two rebuilt masters, their checks, previews and visitor packages. Each rebuild costs about 4 hours of Colab. |
| `~/unbc-work/gap-requal/` | 1.2 GB | The complete local check of the earlier master, including the browser proof and the rebuilt map. |
| `~/unbc-work/vestibules/` | 11 MB | Measurements and pictures for the five vestibules. |
| `~/unbc-work/colab/` and `~/unbc-work/perf/` | 1 MB | Every Colab script, log and the performance report. |
| `reviter/docs/continuation/unbc-20261117/` | 0.4 MB | This handoff, with patches, scripts and review files. Not committed. |
| `openindoormaps/docs/continuation/unbc-20261116/` | 1.8 MB | The vestibule record with receipts. Not committed. |
| The agent's notes: `~/.claude/projects/-Users-ahmadjalil-github-reviter/memory/` | small | What the agent remembers between sessions on this Mac. |

Done on November 17:

- The folders above were copied to `My Drive/UNBC-handoff-20261117/` and every
  file was checked against its original.
- All code and documentation was pushed to GitHub on branches:
  `handoff/unbc-20261117` in both repositories (everything on the local `main`
  branches, including these documents), `unbc/producer-native-door-owners` in
  both, and `unbc/gap-requal-ae70cc07` in openindoormaps.

**Correction:** the `main` branches on GitHub were updated on November 17
(OpenIndoorMaps redeployed; Reviter after its lint fix).

Already in Drive: the rebuild inputs, the gap-patch files
(`UNBC-sliver-contacts/upload`) and the first Colab package
(`UNBC-vestibules/`). The applied gap-patch archive is also in your Downloads
folder as three parts.

Not needed in Drive: `~/unbc-work/matcher` and `pair` (code, better pushed to
GitHub), `rvt/model.rvt` (a copy of the model already in your Drive),
`rvtrs-target`, `bimcraft-out`, `rvtrs-out`.
