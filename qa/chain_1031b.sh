#!/bin/bash
# v10.31 — 이어서(19시 이후): 3차 다시 돌림이 끝나면 → 4차(빌드 뒤 다시 볼 화면 시험) → 연동(어댑터) → D(시안) → E(확장 점검) → 모든 페이지(사용자 웹 5역할 · 운영 화면). 한 번에 하나.
cd /home/claude/qa; K=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb
while ! grep -q RERUN-C-DONE final_all_reruns_1031.txt; do sleep 20; done
export API=http://localhost:3000/api/v1 SITE=http://localhost:5174 BO=http://127.0.0.1:5173 PYTHONPATH=/home/claude/qa/tools/offline_fonts
export JWT_SECRET=docker-test-secret-0123456789abcdef JOB_TOKEN=docker-test-job-token-0123456789abcdef ENC_KEY=docker-dev-enc-key-0123456789abcdef
O=final_all_reruns_1031.txt
r() { echo "$1: $2 — $3" >> $O; echo "$1: $2"; }
B="다시 빌드한 뒤(19:2x)"
python3 site_mall.py > rr_site_mall.log 2>&1; r site_mall "$(tail -1 rr_site_mall.log)" "$B · 결함 고친 뒤(V-16 INV-H4 · 커밋 fe6b3b1) · 시험을 고친 뒤(w3 내 주문 · 순위 상자)"
python3 fix_1028_ui.py > rr_fix_1028_ui.log 2>&1; r fix_1028_ui "$(tail -1 rr_fix_1028_ui.log)" "$B · 결함 고친 뒤(C-U1 순위 기간 · 커밋 21b3f6c) · 시험을 고친 뒤"
python3 srv_detail.py > rr2_srv_detail.log 2>&1; r srv_detail "$(tail -1 rr2_srv_detail.log)" "$B(S-2 @StrictBoolean 이 실제 API 에서 — 커밋 f649c55)"
# 연동 — 어댑터 인스턴스(3121 토스 · 3122 S3 · 3123 1원 인증 · 중개사 · 국세청 · 3124 staging) + 가짜 서버
bash adapters_up.sh > rr_adapters3.log 2>&1; r adapters_up "$(grep -c ' 200$' rr_adapters3.log)/4 떠 있음" "최신 소스(dev-server)"
API_TOSS=http://localhost:3121/api/v1 python3 srv_pay.py > rr2_srv_pay.log 2>&1; r srv_pay "$(tail -1 rr2_srv_pay.log)" "$B · 연동(가짜 결제사)"
API_S3=http://localhost:3122/api/v1 KIT=$K python3 srv_file.py > rr2_srv_file.log 2>&1; r srv_file "$(tail -1 rr2_srv_file.log)" "$B · 연동(가짜 S3 SigV4)"
API=http://localhost:3000 ADP=http://localhost:3123 KIT=$K CHECK_DB=postgresql://sgb:sgb@localhost:5432/sgb_check python3 srv_lead.py > rr2_srv_lead.log 2>&1; r srv_lead "$(tail -1 rr2_srv_lead.log)" "$B · 연동(1원 인증 · 중개사 · 국세청 가짜 서버)"
python3 srv_consult.py > rr2_srv_consult.log 2>&1; r srv_consult "$(tail -1 rr2_srv_consult.log)" "$B · 연동(staging 3124)"
bash adapters_down.sh >> rr_adapters3.log 2>&1
echo RERUN-D-DONE >> $O
# D(시안 v10.31) — final_all.txt 에
PROTO=$K/spec/proto.html RERUN=1 bash final_parts.sh D > partD.log 2>&1
# E(확장 점검) + 모든 페이지 상호 확인(최신 빌드)
bash final_parts.sh E > partE.log 2>&1
python3 crawl_site.py > final_site.log 2>&1; cp site_crawl.json site_final.json; echo "crawl_site: $(python3 crawl_sum.py 2>/dev/null | tail -1)" >> final_all.txt
python3 crawl_admin_final.py > final_admin.log 2>&1; echo "crawl_admin: $(python3 crawl_admin_sum.py)" >> final_all.txt
echo CHAIN-B-DONE >> final_all.txt
