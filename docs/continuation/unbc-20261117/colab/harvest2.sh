#!/bin/bash
# File-channel only: watches the candidate rebuild C and its follow-on steps and downloads each output once.
D=~/unbc-work/vest-master2; C=~/.local/bin/colab; S=unbc-vest2; L=~/unbc-work/colab/harvest2.log; miss=0
get() { # remote local
  [ -s "$D/$2" ] && return 0
  timeout 900 $C download -s $S "$1" "$D/$2.part" >/dev/null 2>&1 && [ -s "$D/$2.part" ] && mv "$D/$2.part" "$D/$2" && echo "$(date -u +%T) got $2 $(stat -f %z "$D/$2")" >> $L
}
while true; do
  rm -f $D/.c-run.out $D/.attempts.txt
  timeout 120 $C download -s $S /content/unbc-c/run.out $D/.c-run.out >/dev/null 2>&1
  timeout 120 $C download -s $S /content/jobb/attempts.txt $D/.attempts.txt >/dev/null 2>&1
  if [ ! -s $D/.c-run.out ]; then miss=$((miss+1)); echo "$(date -u +%T) no answer ($miss)" >> $L; [ $miss -ge 5 ] && { echo "SESSION LOST" | tee -a $L; break; }; sleep 60; continue; fi
  miss=0; A=$(cat $D/.attempts.txt 2>/dev/null)
  echo "$(date -u +%T) C: $(tail -n 1 $D/.c-run.out | cut -c1-90) | $(echo "$A" | tail -n 1)" >> $L
  if grep -q "Compile exit status" $D/.c-run.out; then
    for f in regeneration.json source-door-aperture-replay.json source-native-door-owner-replay.json; do get /content/unbc-c/run/output/$f C-$f; done
    get /content/unbc-c/run/compile-20261117T051337Z.log C-compile.log
    grep -q "Compile exit status: 0" $D/.c-run.out && get /content/unbc-c/run/output/UNBC.master.reviter.zip C-UNBC.master.reviter.zip
    grep -q "Compile exit status: 0" $D/.c-run.out || { echo "C FAILED" | tee -a $L; break; }
  fi
  O=/content/jobb/C
  echo "$A" | grep -q "C end link" && { get $O/master-0388.zip C-master-0388.zip; get $O/link.log C-link.log; get $O/master-0388.sha256 C-master-0388.sha256; }
  echo "$A" | grep -q "C end guides" && get $O/guides/prepared-routing.json C-prepared-routing.json
  echo "$A" | grep -q "C end accept rc" && { get $O/accept/report.json C-accept-report.json; get $O/accept/normal-routes.json C-accept-normal-routes.json; get $O/accept.log C-accept.log; }
  echo "$A" | grep -q "C end accept-vestibules" && { get $O/accept-vestibules/report.json C-accept-vestibules-report.json; get $O/accept-vestibules.log C-accept-vestibules.log; }
  echo "$A" | grep -q "C end preview" && { sleep 20; get $O/preview.tgz C-preview.tgz; }
  if echo "$A" | grep -q "C end progressive"; then
    Z=$(timeout 60 $C ls -s $S $O 2>/dev/null | grep "campus-viewer.zip$" | tr -d ' ' | head -1)
    [ -n "$Z" ] && get $O/$Z C-$Z; get $O/progressive/export-report.json C-progressive-export-report.json; get $O/progressive/manifest.json C-progressive-manifest.json
    if timeout 60 $C ls -s $S $O 2>/dev/null | grep -q "^ *done$"; then echo "C ALL DONE" | tee -a $L; break; fi
  fi
  timeout 60 $C download -s $S /content/exp/link-prof.log $D/.prof.log >/dev/null 2>&1
  if grep -q "PROF_EXIT" $D/.prof.log 2>/dev/null; then P=$(timeout 60 $C ls -s $S /content/exp/prof 2>/dev/null | grep cpuprofile | tr -d ' ' | head -1); [ -n "$P" ] && get /content/exp/prof/$P exp-export.cpuprofile; fi
  sleep 120
done
