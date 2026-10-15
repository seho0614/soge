#!/bin/bash
# v10.31 — 3차 다시 돌림(18:47 API · 사용자 웹을 고친 커밋까지 다시 빌드한 뒤 — 한 번에 하나)
cd /home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
B="다시 빌드한 뒤(API dist · 사용자 웹 next build 19:2x — 커밋 f649c55 · fe6b3b1 · 435237d · 21b3f6c · 7b720ee 반영)"
python3 srv_lead_ui.py > rr_srv_lead_ui.log 2>&1; r srv_lead_ui "$(tail -1 rr_srv_lead_ui.log)" "$B · 시험을 고친 뒤(W5 D070 선불 — 시험 업체에 시험 결제(스텁) 30만 원 충전 · 한 장 신청서)"
python3 srv_ptn_ui.py > rr_srv_ptn_ui.log 2>&1; r srv_ptn_ui "$(tail -1 rr_srv_ptn_ui.log)" "$B · 결함 고친 뒤(UI-4-4 /my/broker/status 500 · 커밋 7b720ee)"
python3 web_mal.py > rr_web_mal.log 2>&1; r web_mal "$(tail -1 rr_web_mal.log)" "$B · 전 회차 TypeError 는 /consult/categories 가 목록 대신 오류 응답을 준 순간(환경 — 다른 시험과 겹친 요청 한도)"
python3 site_mny.py > rr_site_mny.log 2>&1; r site_mny "$(tail -1 rr_site_mny.log)" "$B · 시험을 고친 뒤(목록 30초 기억이 stale-while-revalidate — 기다린 뒤 한 번 열어 새로 받게 하고 다시 봄 · 2쪽도)"
r hyd_load "$(bash hyd_load.sh 2>&1 | tail -1)" "$B"
echo RERUN-C-DONx >> $O
python3 srv_ptn_ui.py > rr_srv_ptn_ui.log 2>&1; r srv_ptn_ui "$(tail -1 rr_srv_ptn_ui.log)" "$B · 결함 고친 뒤(UI-4-4 /my/broker/status 500 · 커밋 7b720ee) · 시험을 고친 뒤(UI-4-5 — 「새로 신청」을 누른 뒤 기다림이 주석 안에 들어가 있던 것)"
python3 web_mal.py > rr_web_mal.log 2>&1; r web_mal "$(tail -1 rr_web_mal.log)" "$B · 시험을 고친 뒤(W3 D060 — BASIC 무료 소개코드 0건이면 「무료 소개코드 없음 · 건당 N원」)"
echo RERUN-C-DONE >> $O
