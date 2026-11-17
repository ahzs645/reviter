#!/bin/bash
# Candidate rebuild C: faster exact arithmetic + own-host fallback rule in the door approach (Reviter copy only).
set -euo pipefail
export TZ=UTC
A=/content/unbc; B=/content/unbc-c; U=/content/upload; mkdir -p $B
[ -d $B/reviter ] || git -C $A/reviter worktree add -f --detach $B/reviter HEAD
[ -d $B/openindoormaps ] || git -C $A/openindoormaps worktree add -f --detach $B/openindoormaps HEAD
cd $B/reviter && git apply /content/perf/b1-exact-arith.patch && python3 /content/diag3/rule2-patch.py $B/reviter/lib/reviter/native-circulation-geometry.ts
git -C $B/reviter diff --stat | tail -n 4; git -C $B/reviter diff lib/reviter/native-circulation-geometry.ts > /content/out/rule2-own-host-fallback.diff; wc -l /content/out/rule2-own-host-fallback.diff
[ -e $B/reviter/node_modules ] || cp -a $A/reviter/node_modules $B/reviter/node_modules
[ -e $B/openindoormaps/node_modules ] || cp -a $A/openindoormaps/node_modules $B/openindoormaps/node_modules
[ -e $B/inputs ] || ln -s $A/inputs $B/inputs
env NATIVE_WORKERS=1 LANDING_WORKERS=1 PARENT_HEAP_MIB=8192 \
  BOUNDARY_PATCH_REVIEW=$U/OWNER-GAP-PATCHES.native-boundary-patches.json \
  BOUNDARY_PATCH_SUPERSESSIONS=$U/CONTACT-REPAIR-SUPERSESSIONS.json \
  APPLIED_BOUNDARY_PATCH_MASTER=$U/applied-gap-patches-73a765e9.zip \
  REVIEW=$U/DOOR-APERTURE-REVIEW.vestibules-c.json \
  NATIVE_DOOR_OWNER_REVIEW=$U/NATIVE-DOOR-OWNER-REVIEW.vestibules.json \
  setsid nohup bash $B/openindoormaps/docs/continuation/unbc-20261021/recompile/run.sh $B > $B/run.out 2>&1 &
sleep 12; cat $B/run.out | cut -c1-160; echo C_STARTED; date -u +%T
