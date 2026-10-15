#!/bin/bash
# Docker 로 띄운 킷(/tmp/dock_kit · 포트 13000 · 15173 · 15174 · 15432)을 상대로 도는 시험 묶음.  결과: docker_<판>.txt
#   각 시험의 결과 파일(이름.json)은 개발 서버 상대 결과를 덮지 않게 이름_docker.json 으로 따로 둡니다.
#   사용: bash docker_set.sh docker_1016.txt
cd /home/claude/qa
OUT="${1:-docker_set.txt}"; : > "$OUT"
D=/tmp/dock_kit
export SITE=http://localhost:15174 BO=http://127.0.0.1:15173 DB=postgresql://sgb:sgb@localhost:15432/sgb CHECK_DB=postgresql://sgb:sgb@localhost:15432/sgb_check
export JOB_TOKEN=docker-dev-job-token-0123456789abcdef KIT=$D/sgb
A1=http://localhost:13000/api/v1; A0=http://localhost:13000
r() { echo "$1: $2" | tee -a "$OUT"; }
run() { # 이름 · 결과 파일 이름(확장자 없이) · 명령…
  local name="$1" js="$2"; shift 2
  [ -f "$js.json" ] && cp "$js.json" "/tmp/keep_$js.json"
  "$@" > "docker_$name.log" 2>&1
  r "docker_$name" "$(tail -1 "docker_$name.log")"
  [ -f "$js.json" ] && cp "$js.json" "${js}_docker.json"
  [ -f "/tmp/keep_$js.json" ] && mv "/tmp/keep_$js.json" "$js.json"
}
# v10.19 — fixtures.py 는 안심소개 매물이 모자라면 srv_ptn.py 를 여러 번 돌립니다(새로 만든 Docker DB 에서 5번). 그 결과가 srv_ptn.json 을 덮어
#   로컬 실행 결과가 Docker 쪽 준비 실행의 것으로 바뀌던 것을 막습니다(G-118 을 찾은 계기 — docs/63 4-3).
[ -f srv_ptn.json ] && cp srv_ptn.json /tmp/keep_srv_ptn.json
run fixtures        fixtures        env API=$A1 python3 fixtures.py
[ -f srv_ptn.json ] && cp srv_ptn.json srv_ptn_docker_fixture.json; [ -f /tmp/keep_srv_ptn.json ] && mv /tmp/keep_srv_ptn.json srv_ptn.json
run srv_poll_ui     srv_poll_ui     env API=$A0 python3 srv_poll_ui.py
run web_main        web_main        env API=$A1 python3 web_main.py
run measure_home    measure_home    python3 measure_home.py
run web_mal         web_mal         env API=$A1 python3 web_mal.py
run csrf_check      csrf_check      env API=$A1 python3 csrf_check.py
run srv_consult     srv_consult     env API=$A1 python3 srv_consult.py
run srv_consult_ui  srv_consult_ui  env API=$A0 python3 srv_consult_ui.py
run srv_lead        srv_lead        env API=$A0 ADP=http://127.0.0.1:9 MOCK=http://127.0.0.1:9 python3 srv_lead.py      # v10.28 — 어댑터 인스턴스(3121 ~ 3124)는 로컬 API 에 붙어 있어 Docker 쪽에서는 건너뜀(v10.27 과 같게)
run srv_poll        srv_poll        env API=$A0 python3 srv_poll.py
# v10.20 (G-118) — 파트너 운영 목록: 남의 이용료 반려 신청의 응답이 신청 유무와 관계없이 같은지를 Docker 의 API · DB 에서도
run srv_ptn         srv_ptn         env API=$A0 python3 srv_ptn.py
# v10.18 — 결제 · 환불 정합(D022)을 Docker 의 PostgreSQL 에서: 시험용 API 2대(작업본의 dist)와 가짜 결제사를 띄워 Docker DB(15432)에 붙입니다 · 5절(스텁)은 Docker 의 API(13000)로
run srv_billing     srv_billing     env KIT=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb DATABASE_URL=$DB API=$A1 python3 srv_billing.py
run srv_billing_ui  srv_billing_ui  env API=$A0 python3 srv_billing_ui.py
PROTO=$(ls $D/SGB_Prototype_v*.html | head -1 | xargs basename)
r "docker proto" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 240 $SITE/proto/$PROTO) $PROTO"
# v10.19 — Docker 의 사용자 웹이 내주는 시안이 킷의 시안과 같은 파일인지 보고, 받은 그 파일로 「급구 · 급매」 시험(proto_urg.py)을 돌립니다
curl -s --max-time 240 -o /tmp/docker_proto.html $SITE/proto/$PROTO
r "docker proto 내용" "$([ "$(md5sum < /tmp/docker_proto.html)" = "$(md5sum < $D/sgb/spec/proto.html)" ] && echo '킷의 spec/proto.html 과 같음' || echo '다름')"
run proto_urg       proto_urg       env PROTO=/tmp/docker_proto.html python3 proto_urg.py
run proto_detail    proto_detail    env PROTO=/tmp/docker_proto.html python3 proto_detail.py      # v10.20 — 상세 화면
run proto_item      proto_item      env PROTO=/tmp/docker_proto.html python3 proto_item.py        # v10.21 — 매물 상세가 누른 매물의 내용으로
run proto_axis      proto_axis      env PROTO=/tmp/docker_proto.html python3 proto_axis.py        # v10.22 — 소개창업 축의 상세 4종 · 항목별 주소
run proto_lang      proto_lang      env PROTO=/tmp/docker_proto.html python3 proto_lang.py        # v10.22 — 언어 단추 · 로그인 화면
run proto_guard     proto_guard     env PROTO=/tmp/docker_proto.html python3 proto_guard.py       # v10.22 — 시연 보장(소개뱅크몰의 이미 고른 갈래 단추)
# v10.21 (D023) — 매물 상세의 서버 · 실제 웹을 Docker 의 API · DB · 사용자 웹에서도 (시험 자료의 거래 3건은 넣었다가 지웁니다)
run srv_detail      srv_detail      env API=$A0 python3 srv_detail.py
run site_detail     site_detail     env API=$A0 python3 site_detail.py
# v10.23 — 소개광장: 서버(작성자 가림 · 검색 · 쪽 번호) · 실제 웹(제시 디자인 · Docker 의 사용자 웹이 내주는 그림이 받은 PNG 그대로인지) · 시안(Docker 가 내준 파일로)
WK=/home/claude/pkg/SGB_DevDocker_Integrated_20261002
run srv_cmu         srv_cmu         env API=$A0 python3 srv_cmu.py
run srv_cmu_ui      srv_cmu_ui      env API=$A0 KIT=$WK python3 srv_cmu_ui.py
run proto_cmu       proto_cmu       env PROTO=/tmp/docker_proto.html KIT=$WK python3 proto_cmu.py
# v10.24 — 생활 · 금융 상담: 서버(업종 상세 · Docker 가 기동 때 넣은 시험용 업체 — 시드를 두 번 더 돌려 봄) · 실제 웹 · 시안(Docker 가 내준 파일로)
run srv_fin         srv_fin         env API=$A0 KIT=$D/sgb SEED=1 python3 srv_fin.py
curl -s -o /dev/null --max-time 240 "$SITE/mall?axis=consult"; curl -s -o /dev/null --max-time 240 "$SITE/mal/consult"
run srv_fin_ui      srv_fin_ui      env API=$A0 python3 srv_fin_ui.py
run proto_fin       proto_fin       env PROTO=/tmp/docker_proto.html KIT=$D/sgb python3 proto_fin.py
# v10.25 — 소개몰: 서버(이름 · 약관 · 배송비 무료 · 의료기기 미판매 · 건강기능식품 잠금 · 갈래 조회) · 실제 웹(Docker 의 사용자 웹) · 시안(Docker 가 내준 파일로)
run srv_mall        srv_mall        env API=$A0 KIT=$D/sgb python3 srv_mall.py
run site_mall       site_mall       env API=$A0 KIT=$WK python3 site_mall.py
run proto_mall      proto_mall      env PROTO=/tmp/docker_proto.html KIT=$WK python3 proto_mall.py
# v10.26 — 소개몰 상품 자료 · 옵션 · 교환 비용(D027 · D028 · D029): 서버 · 실제 웹(Docker 의 사용자 웹) · 시안(Docker 가 내준 파일로) · 결함 수정 확인(G-173 ~ G-203)
run srv_opt         srv_opt         env API=$A1 python3 srv_opt.py
run site_opt        site_opt        env API=$A1 OUT=/home/claude/qa python3 site_opt.py
run proto_opt       proto_opt       env PROTO=/tmp/docker_proto.html KIT=$WK OUT=/home/claude/qa python3 proto_opt.py
run fix_1026        fix_1026        env API=$A1 python3 fix_1026.py
# v10.27 — 결함 수정 확인 · G-130 개발분 · 시안 수정 · G-130 시안(Docker 의 사용자 웹이 내준 시안 파일로)
run fix_1027        fix_1027        env API=$A1 python3 fix_1027.py
run fix_1027b       fix_1027b       env API=$A1 python3 fix_1027b.py
run fix_1027b_ui    fix_1027b_ui    env API=$A1 python3 fix_1027b_ui.py
run fix_1027c       fix_1027c       env API=$A1 python3 fix_1027c.py
run fix_1027_proto  fix_1027_proto  env PROTO=/tmp/docker_proto.html python3 fix_1027_proto.py
# v10.28 — 두 묶음 한 판(발송 · 구매확정 · 리뷰 · 문의 · 순위 · 선택 약관 · 상담 이메일 · 개인 정산 · 약관 한 벌 · 재동의) · 시안(Docker 의 사용자 웹이 내준 시안 파일로)
run fix_1028        fix_1028        env API=$A1 python3 fix_1028.py
run fix_1028_ui     fix_1028_ui     env API=$A1 python3 fix_1028_ui.py
run fix_1028_proto  fix_1028_proto  env PROTO=/tmp/docker_proto.html OUT=/tmp python3 fix_1028_proto.py
[ -f g130/g130_check.json ] && cp g130/g130_check.json /tmp/keep_g130_check.json
python3 g130_check.py /tmp/docker_proto.html > docker_g130_check.log 2>&1; r docker_g130_check "$(tail -1 docker_g130_check.log)"
cp g130/g130_check.json g130_check_docker.json 2>/dev/null; [ -f /tmp/keep_g130_check.json ] && mv /tmp/keep_g130_check.json g130/g130_check.json
r "docker 운영 방식 아님(개발 서버) /docs" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 $A0/docs)"
# 실제 자료 모드 — 사용자 웹만 HOME_CONTENT=live 로 다시 띄웁니다(끝에 되돌림)
( cd $D && HOME_CONTENT=live docker compose up -d site >/dev/null 2>&1 ); for i in $(seq 1 40); do curl -s -o /dev/null --max-time 240 $SITE/ && break; sleep 3; done
[ -f web_main.json ] && cp web_main.json /tmp/keep_web_main.json
env API=$A1 python3 web_main.py > docker_web_main_live.log 2>&1; r "docker_web_main_live(HOME_CONTENT=live)" "$(tail -1 docker_web_main_live.log)"
cp web_main.json web_main_docker_live.json 2>/dev/null; [ -f /tmp/keep_web_main.json ] && mv /tmp/keep_web_main.json web_main.json
( cd $D && docker compose up -d site >/dev/null 2>&1 )
echo DOCKERSET-DONE >> "$OUT"
