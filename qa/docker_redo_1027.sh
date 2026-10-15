#!/bin/bash
# v10.27(2) — Docker 묶음에서 시험 쪽 자료 고르기 때문에 실패한 3개를 고친 뒤 다시(결과는 docker_1027.txt 에 「(다시)」로 덧붙임)
cd /home/claude/qa; OUT=docker_1027.txt; D=/tmp/dock_kit
export SITE=http://localhost:15174 BO=http://127.0.0.1:15173 DB=postgresql://sgb:sgb@localhost:15432/sgb CHECK_DB=postgresql://sgb:sgb@localhost:15432/sgb_check
export JOB_TOKEN=docker-dev-job-token-0123456789abcdef KIT=$D/sgb API=http://localhost:13000/api/v1
for t in fix_1027b fix_1027b_ui fix_1027c; do
  [ -f $t.json ] && cp $t.json /tmp/keep_$t.json
  python3 $t.py > docker_${t}_redo.log 2>&1; echo "docker_$t (다시 · 시험이 쓸 자료가 없으면 만들도록 고침): $(tail -1 docker_${t}_redo.log)" | tee -a $OUT
  cp $t.json ${t}_docker.json; [ -f /tmp/keep_$t.json ] && mv /tmp/keep_$t.json $t.json
done
# 실제 자료 모드 — 위 시험과 겹쳐 돈 첫 번에 intro 요약 수가 바뀌는 사이에 읽음 → 혼자 다시
( cd $D && HOME_CONTENT=live docker compose up -d site >/dev/null 2>&1 ); for i in $(seq 1 60); do curl -s -o /dev/null --max-time 240 $SITE/ && break; sleep 3; done
cp web_main.json /tmp/keep_web_main.json
python3 web_main.py > docker_web_main_live_redo.log 2>&1; echo "docker_web_main_live(HOME_CONTENT=live) (다시 · 혼자): $(tail -1 docker_web_main_live_redo.log)" | tee -a $OUT
cp web_main.json web_main_docker_live.json; mv /tmp/keep_web_main.json web_main.json
( cd $D && docker compose up -d site >/dev/null 2>&1 ); for i in $(seq 1 60); do curl -s -o /dev/null --max-time 240 $SITE/ && break; sleep 3; done
echo REDO-DONE
