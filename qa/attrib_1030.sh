#!/bin/bash
# v10.30 — 전수 검정에서 실패한 화면 시험을 「v10.29 그대로」(5184 에 따로 띄운 v10.29 사용자 웹 · 같은 API · 같은 DB)와 「v10.30」(5174)에 각각 다시 돌려,
#   실패한 단계가 **v10.29 에서 넘어온 것인지 · 이 판에서 생긴 것인지** 가립니다. 구글 글꼴 요청은 두 쪽 모두 빈 응답으로(tools/offline_fonts — 인터넷이 막힌 환경).
#   사용: bash attrib_1030.sh srv_refcode_ui srv_consult_ui …      결과: attrib_1030.txt (시험마다 한 줄) · base_<시험>.log · rr_<시험>.log
cd /home/claude/qa; export PYTHONPATH=/home/claude/qa/tools/offline_fonts
BASE_SITE=${BASE_SITE:-http://localhost:5184}
curl -s -o /dev/null -m 5 $BASE_SITE/ || { echo "v10.29 사용자 웹($BASE_SITE)이 떠 있지 않습니다 — bash /home/claude/w/v30/site_base_up.sh"; exit 1; }
fails() { grep -E "^(FAIL|✗)|^\s*FAIL " "$1" | sed -E 's/\s+/ /g' | cut -c1-90 | sort -u; }
for t in "$@"; do
  SITE=$BASE_SITE timeout 1500 python3 $t.py > base_$t.log 2>&1
  timeout 1500 python3 $t.py > rr_$t.log 2>&1
  fails base_$t.log > /tmp/attr_b.txt; fails rr_$t.log > /tmp/attr_n.txt
  only_new=$(comm -13 /tmp/attr_b.txt /tmp/attr_n.txt | wc -l); both=$(comm -12 /tmp/attr_b.txt /tmp/attr_n.txt | wc -l); only_base=$(comm -23 /tmp/attr_b.txt /tmp/attr_n.txt | wc -l)
  line="$t: v10.30 「$(tail -1 rr_$t.log | cut -c1-70)」 · v10.29 그대로 「$(tail -1 base_$t.log | cut -c1-70)」 · 실패 단계 — 두 쪽 모두 $both · v10.30 에서만 $only_new · v10.29 에서만 $only_base"
  echo "$line" | tee -a attrib_1030.txt
  [ "$only_new" != "0" ] && comm -13 /tmp/attr_b.txt /tmp/attr_n.txt | sed 's/^/    v10.30 에서만: /' | tee -a attrib_1030.txt
done
