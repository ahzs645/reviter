#!/bin/bash
# Job B for one master: 06-388 link, guides, acceptance (standard + vestibule cases), pathway preview, visitor package.
# usage: colab2-jobb.sh TAG REGEN-MASTER.zip VESTIBULE-CASES.json
set -uo pipefail
export TZ=UTC HUSKY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
TAG=$1; REGEN=$2; VC=$3; J=/content/jobb; O=$J/$TAG; mkdir -p $O
log() { echo "$(date -u +%FT%TZ) $TAG $*" >> $J/attempts.txt; }
if [ ! -d $J/openindoormaps/node_modules ]; then
  git -C /content/unbc/openindoormaps fetch -q origin main
  [ -d $J/openindoormaps ] || git -C /content/unbc/openindoormaps worktree add -f --detach $J/openindoormaps FETCH_HEAD
  RP=$(grep -rh -A6 "repository: .*reviter" $J/openindoormaps/.github/workflows/*.yml | grep -oE "[0-9a-f]{40}" | head -1)
  git -C /content/unbc/reviter fetch -q origin "$RP" || git -C /content/unbc/reviter fetch -q origin
  [ -d $J/reviter ] || git -C /content/unbc/reviter worktree add -f --detach $J/reviter "$RP"
  (cd $J/reviter && npm ci --no-audit --no-fund >/dev/null 2>&1); (cd $J/openindoormaps && npm ci --no-audit --no-fund >/dev/null 2>&1)
fi
git -C $J/openindoormaps log --oneline -1 > $O/pair.txt; git -C $J/reviter log --oneline -1 >> $O/pair.txt
cd $J/openindoormaps
M=$O/master-0388.zip
if [ ! -f $M ]; then
  log "start link"; node --max-old-space-size=24576 --import tsx scripts/indoor/add-reviewed-circulation-link.ts $REGEN $M --from "door:1487353:1780077:0" --to "door:1487353:1779222:0" --source "docs/continuation/unbc-20261031/campus/README.md" --decision-id "06-388-island-missing-approach" --summary "Connected door 1780077 (06-366 Lounge to 06-364 Corridor) has no walking approach on its 06-364 portal, isolating 06-388 Vestibule and 15 other rooms. Join that portal to the neighbouring 06-364 portal of door 1779222 (6.46 ft) inside native cell 994." > $O/link.log 2>&1; log "end link rc=$?"
fi
[ -f $M ] || { echo LINK_FAILED > $O/done; exit 1; }
sha256sum $M > $O/master-0388.sha256
if [ ! -f $O/guides/prepared-routing.json ]; then
  log "start guides"; node --max-old-space-size=16384 --import tsx scripts/indoor/compile-corridor-candidates.ts $M $O/guides > $O/guides.log 2>&1; log "end guides rc=$?"
fi
[ -f $O/guides/prepared-routing.json ] || { echo GUIDES_FAILED > $O/done; exit 1; }
( log "start preview"; node --max-old-space-size=16384 --import tsx scripts/indoor/export-pathway-preview.ts $M $O/preview --guides $O/guides/prepared-routing.json > $O/preview.log 2>&1; log "end preview rc=$?"; cd $O && tar czf preview.tgz preview ) &
( log "start accept-vestibules"; node --max-old-space-size=8192 --expose-gc --import tsx scripts/indoor/verify-shared-corridor-candidate.ts $M $O/guides/prepared-routing.json $VC $O/accept-vestibules > $O/accept-vestibules.log 2>&1; log "end accept-vestibules rc=$?" ) &
log "start accept"; node --max-old-space-size=8192 --expose-gc --import tsx scripts/indoor/verify-shared-corridor-candidate.ts $M $O/guides/prepared-routing.json docs/continuation/unbc-20261031/ROUTE-CASES-CAMPUS-0388.json $O/accept > $O/accept.log 2>&1; log "end accept rc=$?"
C=$O/accept/UNBC.shared-pathways.candidate.reviter.zip
if [ -f $C ]; then
  log "start progressive"; node --max-old-space-size=16384 --import tsx scripts/indoor/export-progressive-viewer.ts $C $O/progressive --visitor --prepare --checkpoints --priority-scope=1450417,311,1487816 > $O/progressive.log 2>&1; log "end progressive rc=$?"
fi
wait
echo JOBB_DONE > $O/done
