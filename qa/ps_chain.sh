#!/bin/bash
cd /home/claude/qa; P=/opt/pwsh/pwsh; D=/tmp/dock_kit; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002
$P -NoProfile -File ps_lint.ps1 $K > ps_lint.txt 2>&1; echo "lint rc=$?"
$P -NoProfile -File ps_native_test.ps1 $K /home/claude/qa/ps_native_test.json > /tmp/ps_native.log 2>&1; echo "native rc=$?"
$P -NoProfile -File ps_e2e.ps1 $D realcheck "" /home/claude/qa/ps_e2e_realcheck.json > /tmp/ps_realcheck.log 2>&1; echo "realcheck rc=$?"
for c in check up status; do $P -NoProfile -File ps_e2e.ps1 $D $c "" /home/claude/qa/ps_e2e_$c.json > /tmp/ps_$c.log 2>&1; echo "$c rc=$?"; done
$P -NoProfile -File ps_e2e_more.ps1 $D /home/claude/qa/ps_e2e_more.json > /tmp/ps_more.log 2>&1; echo "more rc=$?"
$P -NoProfile -File ps_e2e.ps1 $D down "" /home/claude/qa/ps_e2e_down.json > /tmp/ps_down.log 2>&1; echo "down rc=$?"
echo PS-CHAIN-DONE
