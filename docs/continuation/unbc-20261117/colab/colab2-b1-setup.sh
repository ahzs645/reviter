#!/bin/bash
# Side-by-side rebuild with the faster exact arithmetic in Reviter's copy only (same inputs and reviews).
set -euo pipefail
export TZ=UTC
A=/content/unbc; B=/content/unbc-b1; U=/content/upload; mkdir -p $B
[ -d $B/reviter ] || git -C $A/reviter worktree add -f --detach $B/reviter HEAD
[ -d $B/openindoormaps ] || git -C $A/openindoormaps worktree add -f --detach $B/openindoormaps HEAD
cd $B/reviter && git apply --check /content/perf/b1-exact-arith.patch && git apply /content/perf/b1-exact-arith.patch
git -C $B/reviter status --short | head; git -C $B/openindoormaps status --short | head -3
[ -e $B/reviter/node_modules ] || cp -a $A/reviter/node_modules $B/reviter/node_modules
[ -e $B/openindoormaps/node_modules ] || cp -a $A/openindoormaps/node_modules $B/openindoormaps/node_modules
[ -e $B/inputs ] || ln -s $A/inputs $B/inputs
sha256sum $A/reviter/lib/reviter/vendor/native-rational-overlay-arithmetic.mjs $B/reviter/lib/reviter/vendor/native-rational-overlay-arithmetic.mjs
env NATIVE_WORKERS=1 LANDING_WORKERS=1 PARENT_HEAP_MIB=8192 \
  BOUNDARY_PATCH_REVIEW=$U/OWNER-GAP-PATCHES.native-boundary-patches.json \
  BOUNDARY_PATCH_SUPERSESSIONS=$U/CONTACT-REPAIR-SUPERSESSIONS.json \
  APPLIED_BOUNDARY_PATCH_MASTER=$U/applied-gap-patches-73a765e9.zip \
  REVIEW=$U/DOOR-APERTURE-REVIEW.vestibules-c.json \
  NATIVE_DOOR_OWNER_REVIEW=$U/NATIVE-DOOR-OWNER-REVIEW.vestibules.json \
  setsid nohup bash $B/openindoormaps/docs/continuation/unbc-20261021/recompile/run.sh $B > $B/run.out 2>&1 &
sleep 15; cat $B/run.out | cut -c1-200; echo B1_STARTED
