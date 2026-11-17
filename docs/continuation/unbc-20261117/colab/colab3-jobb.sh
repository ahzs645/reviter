#!/bin/bash
# Fresh session: guides, acceptance (standard + vestibule cases), preview and visitor package for one linked master.
set -uo pipefail
export TZ=UTC HUSKY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
J=/content/jobb; O=$J/C; U=/content/upload; mkdir -p $O
log() { echo "$(date -u +%FT%TZ) C $*" >> $J/attempts.txt; }
log "start setup"
node --version 2>/dev/null | grep -qx v22.22.0 || (curl -fsSL https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1)
[ -d $J/openindoormaps ] || git clone -q https://github.com/ahzs645/openindoormaps.git $J/openindoormaps
git -C $J/openindoormaps checkout -q --detach a983561
RP=$(grep -rh -A6 "repository: .*reviter" $J/openindoormaps/.github/workflows/*.yml | grep -oE "[0-9a-f]{40}" | head -1)
[ -d $J/reviter ] || git clone -q https://github.com/ahzs645/reviter.git $J/reviter
git -C $J/reviter checkout -q --detach "$RP"
(cd $J/reviter && [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1) &
(cd $J/openindoormaps && [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null 2>&1) &
wait
git -C $J/openindoormaps log --oneline -1 > $O/pair.txt; git -C $J/reviter log --oneline -1 >> $O/pair.txt; node --version >> $O/pair.txt
M=$O/master-0388.zip
[ -f $M ] || cat $U/part-* > $M
sha256sum $M > $O/master-0388.sha256
grep -q "^$EXPECT_SHA" $O/master-0388.sha256 || { log "master sha mismatch"; echo SHA_MISMATCH > $O/done; exit 1; }
log "end setup"
cd $J/openindoormaps
if [ ! -f $O/guides/prepared-routing.json ]; then
  log "start guides"; node --max-old-space-size=16384 --import tsx scripts/indoor/compile-corridor-candidates.ts $M $O/guides > $O/guides.log 2>&1; log "end guides rc=$?"
fi
[ -f $O/guides/prepared-routing.json ] || { echo GUIDES_FAILED > $O/done; exit 1; }
( log "start preview"; node --max-old-space-size=16384 --import tsx scripts/indoor/export-pathway-preview.ts $M $O/preview --guides $O/guides/prepared-routing.json > $O/preview.log 2>&1; rc=$?; (cd $O && tar czf preview.tgz.tmp preview && mv preview.tgz.tmp preview.tgz); log "end preview rc=$rc" ) &
( log "start accept-vestibules"; node --max-old-space-size=8192 --expose-gc --import tsx scripts/indoor/verify-shared-corridor-candidate.ts $M $O/guides/prepared-routing.json $U/ROUTE-CASES-VESTIBULES-C.json $O/accept-vestibules > $O/accept-vestibules.log 2>&1; log "end accept-vestibules rc=$?" ) &
log "start accept"; node --max-old-space-size=8192 --expose-gc --import tsx scripts/indoor/verify-shared-corridor-candidate.ts $M $O/guides/prepared-routing.json docs/continuation/unbc-20261031/ROUTE-CASES-CAMPUS-0388.json $O/accept > $O/accept.log 2>&1; log "end accept rc=$?"
C=$O/accept/UNBC.shared-pathways.candidate.reviter.zip
if [ -f $C ]; then
  log "start progressive"; node --max-old-space-size=16384 --import tsx scripts/indoor/export-progressive-viewer.ts $C $O/progressive --visitor --prepare --checkpoints --priority-scope=1450417,311,1487816 > $O/progressive.log 2>&1; log "end progressive rc=$?"
fi
wait
echo JOBB_DONE > $O/done
