#!/bin/bash
# File-channel watcher for the candidate's checks on session unbc-vest3.
D=~/unbc-work/vest-master2; C=~/.local/bin/colab; S=unbc-vest3; L=~/unbc-work/colab/harvest3.log; miss=0; O=/content/jobb/C
get() { [ -s "$D/$2" ] && return 0; timeout 900 $C download -s $S "$1" "$D/$2.part" >/dev/null 2>&1 && [ -s "$D/$2.part" ] && mv "$D/$2.part" "$D/$2" && echo "$(date -u +%T) got $2 $(stat -f %z "$D/$2")" >> $L; }
while true; do
  rm -f $D/.att3.txt; timeout 120 $C download -s $S /content/jobb/attempts.txt $D/.att3.txt >/dev/null 2>&1
  if [ ! -s $D/.att3.txt ]; then miss=$((miss+1)); echo "$(date -u +%T) no answer ($miss)" >> $L; [ $miss -ge 6 ] && { echo "SESSION LOST" | tee -a $L; break; }; sleep 60; continue; fi
  miss=0; A=$(cat $D/.att3.txt); echo "$(date -u +%T) $(echo "$A" | tail -n 1)" >> $L
  echo "$A" | grep -q "C end guides" && get $O/guides/prepared-routing.json C-prepared-routing.json
  echo "$A" | grep -q "C end accept rc" && { get $O/accept/report.json C-accept-report.json; get $O/accept/normal-routes.json C-accept-normal-routes.json; get $O/accept.log C-accept.log; }
  echo "$A" | grep -q "C end accept-vestibules" && { get $O/accept-vestibules/report.json C-accept-vestibules-report.json; get $O/accept-vestibules.log C-accept-vestibules.log; }
  echo "$A" | grep -q "C end preview" && get $O/preview.tgz C-preview.tgz
  if echo "$A" | grep -q "C end progressive"; then
    Z=$(timeout 60 $C ls -s $S $O 2>/dev/null | grep "campus-viewer.zip$" | tr -d ' ' | head -1)
    [ -n "$Z" ] && get $O/$Z C-$Z; get $O/progressive/export-report.json C-progressive-export-report.json; get $O/progressive/manifest.json C-progressive-manifest.json; get $O/pair.txt C-pair.txt
  fi
  if timeout 60 $C ls -s $S $O 2>/dev/null | grep -q "^ *done$"; then get $O/done C-done.txt; get /content/jobb/C.log C-jobb.log; echo "C ALL DONE: $(cat $D/C-done.txt)" | tee -a $L; break; fi
  sleep 120
done
