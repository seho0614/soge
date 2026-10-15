#!/bin/bash
# v10.28 — Docker 묶음에서 시험 환경 · 시험 자료 때문에 실패한 것과 D043(G-219 후속)을 올린 뒤 다시(결과는 docker_1028.txt 에 「(다시 · 이유)」로 덧붙임)
# (10/9 처음 다섯을 함께 돌린 뒤, srv_mall 만 K-5 를 고쳐 한 번 더 — 나머지 넷은 주석으로 막아 둠. 처음부터 다시 하려면 # 를 지우십시오)
cd /home/claude/qa; OUT=docker_1028.txt; D=/tmp/dock_kit
export SITE=http://localhost:15174 BO=http://127.0.0.1:15173 DB=postgresql://sgb:sgb@localhost:15432/sgb CHECK_DB=postgresql://sgb:sgb@localhost:15432/sgb_check
export JOB_TOKEN=docker-dev-job-token-0123456789abcdef KIT=$D/sgb
WK=/home/claude/pkg/SGB_DevDocker_Integrated_20261002
redo() { # 이름 · 이유 · API
  local t="$1" why="$2"; [ -f $t.json ] && cp $t.json /tmp/keep_$t.json
  env API="$3" ADP=http://127.0.0.1:9 MOCK=http://127.0.0.1:9 python3 $t.py > docker_${t}_redo.log 2>&1; echo "docker_$t (다시 · $why): $(tail -1 docker_${t}_redo.log)" | tee -a $OUT
  [ -f $t.json ] && cp $t.json ${t}_docker.json; [ -f /tmp/keep_$t.json ] && mv /tmp/keep_$t.json $t.json
}
#redo srv_lead "어댑터 인스턴스는 로컬 API 에 붙어 있어 Docker 쪽은 건너뜀(v10.27 과 같게)" http://localhost:13000
#KIT=$WK redo srv_cmu_ui "개발 방식 사이트가 /my 를 처음 만드는 동안 빈 응답" http://localhost:13000
redo srv_mall "D043 로 쓰던 볼륨의 판매 약관 시행일(「2026년 M월 4일」)을 바로잡고, K-5 는 시행일 날짜만 맞춰 견줌(DB 마다 발행일이 다름)" http://localhost:13000
#KIT=$WK redo site_mall "취소 신청 중인 결제 대기 주문을 고르지 않게(시험 자료 고르기)" http://localhost:13000
#redo fix_1028_ui "순위를 만든 직후 사이트가 기억한 빈 순위(5분)가 지난 뒤" http://localhost:13000/api/v1
echo REDO-DONE
