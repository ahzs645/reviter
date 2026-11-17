#!/bin/bash
# Owner decision D16 (November 17): tag the build bases, then delete branches
# whose every commit is already in main. Run on the owner's Mac from the folder
# that holds both clones (the cloud session may not push tags or delete
# branches). Each step checks before it changes anything; DRY_RUN=1 prints only.
set -euo pipefail
run() { if [ -n "${DRY_RUN:-}" ]; then echo "+ $*"; else "$@"; fi; }

tag() { # repo tag commit message
  git -C "$1" fetch -q origin
  git -C "$1" rev-parse -q --verify "refs/tags/$2" >/dev/null || run git -C "$1" tag -a "$2" "$3" -m "$4"
  run git -C "$1" push origin "refs/tags/$2"
}
tag reviter unbc/producer-base-20261021 cb140e46d06d8fa728b059ab6068d58fb55e9ea9 \
  "Reviter producer base of the Oct 21 - Nov 16 UNBC rebuilds (was claude/laughing-davinci-34tcj1)."
tag openindoormaps unbc/producer-base-20261022 7c27b67568fe04a060af44fde727efb3ced39df4 \
  "OpenIndoorMaps producer base of the Oct 21 - Nov 16 UNBC rebuilds."
tag openindoormaps unbc/producer-gap-patches-20261104 6993c08 \
  "Producer base plus boundary-patch source review (was unbc-producer-20261021-gap-patches)."
tag openindoormaps unbc/recompile-runbook-fix-20261022 662f400 "Tip of recompile-runbook-fix."
tag openindoormaps unbc/attempt006-runbook-20261021 b78a314 "Tip of claude/laughing-davinci-34tcj1."

drop() { # repo branch: delete only if main contains the tip, or a tag holds it
  local tip; tip=$(git -C "$1" rev-parse "origin/$2")
  if git -C "$1" merge-base --is-ancestor "$tip" origin/main ||
     [ -n "$(git -C "$1" tag --points-at "$tip")" ]; then
    run git -C "$1" push origin --delete "$2"
  else
    echo "KEEP $1 $2: $tip is neither in main nor tagged" >&2
  fi
}
for b in claude/dazzling-curie-id7wh1 claude/drive-folder-review-6m9har claude/ifc-lite-repo-review-71yliq \
         claude/laughing-davinci-34tcj1 claude/regen-efficiency claude/unbc-candidate4-rules \
         codex/rvt-semantic-integration codex/unbc-stair-ownership-tests-20261017; do drop reviter "$b"; done
for b in claude/dazzling-curie-id7wh1 claude/drive-folder-review-6m9har claude/happy-archimedes-w8zqw5 \
         claude/laughing-davinci-34tcj1 claude/unbc-candidate4-rules codex/unbc-corridor-analysis-20261017 \
         legacy-remix recompile-runbook-fix unbc-producer-20261021-gap-patches; do drop openindoormaps "$b"; done
echo "Done. Kept on purpose: handoff/unbc-20261117, unbc/producer-native-door-owners,"
echo "unbc/gap-requal-ae70cc07, claude/exact-arith-speed, the work branch, and the"
echo "branches with unmerged work (determined-albattani, learn-external-document,"
echo "unbc-revit-voxel-transform, rvt-semantics-candidate4, local-work-snapshot, stash)."
