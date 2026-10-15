#!/bin/bash
# v10.30 — 수화 오류(#418)를 부하 속에서: 창 6개를 동시에 띄워 소개장터 메인(/money)을 손님 · 로그인한 회원으로 30번씩, 낱말로 거른 주소도 30번씩(모두 540번) 새로 엽니다. 0 이어야 합니다.
#   BASE=1 이면 v10.29 그대로(5184)의 /money/list · /mall/list 를 같은 방식으로(hyd_load.sh 의 실패가 v10.29 부터인지 가리는 용도).
cd /home/claude/qa; rm -f /tmp/hydm_*.log
if [ -n "${BASE:-}" ]; then S=${BASE_SITE:-http://localhost:5184}; A="guest:/money/list guest:/mall/list"; N=12; else S=${SITE:-http://localhost:5174}; A="guest:/money person:/money guest:/money?keyword=%EC%9D%B8%ED%85%8C%EB%A6%AC%EC%96%B4"; N=18; fi
for i in 1 2 3 4 5 6; do SITE=$S timeout 900 python3 hyd_pages.py $A 30 > /tmp/hydm_$i.log 2>&1 & done; wait
t=$(cat /tmp/hydm_*.log | grep -c "오류"); e=$(cat /tmp/hydm_*.log | grep "오류" | sed -E 's/.*오류 ([0-9]+) \/.*/\1/' | paste -sd+ | bc)
cat /tmp/hydm_*.log | grep "오류" > hyd_mny${BASE:+_base}.txt
echo "$([ "$e" = "0" ] && [ "$t" = "$N" ] && echo 통과 || echo 실패) — 오류 $e / $((N*30)) · 결과 줄 $t/$N ($S · $A)"
