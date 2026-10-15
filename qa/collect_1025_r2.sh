#!/bin/bash
# v10.25 확장 점검(10/8) — 이번 실행의 결과 파일을 킷의 qa/results_v10_25_r2 로 모읍니다(문서 74 · 매트릭스 49 ~ 57 시트의 수치가 여기서 나옵니다).
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_25_r2
mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1025_r2.txt
for f in link_check.json link_integrations.json link_assume.json link_nocaller.json db_link.json db_link_noapi.json db_link_struct.json db_link_counts.json \
         btn_site.json btn_bo.json flow_trade.json flow_mall.json flow_plaza.json flow_biz.json flow_proto.json proto_demo.json findings_r2.json admin_final.json \
         srv_pay.json srv_file.json srv_lead.json srv_billing.json srv_consult.json srv_proto.json e2e.json; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
cat > $R/README.txt <<'T'
v10.25 확장 점검(2026-10-08) 결과 폴더 — 제품 코드는 v10.25 그대로이고 점검만 넓혔습니다.
  final_all_v1025_r2.txt   전수 검정 A ~ E 구간의 한 줄 결과(E = 확장 점검)
  link_check · link_*      연동 테스트(연결 구간을 실제로 호출) · 외부 연동 7건의 키 이름 대조 · 간주 값을 읽는 곳 · 화면과 못 이은 API
  db_link · db_link_*      DB 연동 테스트(왕복 · 조회 전수 · 제약/트리거 · 거래 단위 · 새 설치 DB 와 구조 비교) · API 와 못 이은 표 · 표별 행 수
  btn_site · btn_bo        버튼 체크(단추마다 한 줄 — 누구로 · 어디서 · 무엇을 눌러 · 무슨 반응 · 어떤 요청)
  flow_*                   flow 점검(흐름 · 단계 · 방법 · 통과 여부 · 자세히) — trade · mall · plaza · biz 는 실제 웹, proto 는 시안
  proto_demo               시안의 시연 안 되는 부분(안내로 대신 · 표시만 · 없는 주소 · 여는 길 없는 화면)
  findings_r2              이번에 나온 것 32건(번호 G-170 ~ G-201) — defects.json 에도 들어 있습니다
Docker · PowerShell · 새로 설치 · 서버 적용 리허설 결과는 results_v10_25 의 것이 그대로입니다(제품 코드 같음).
T
ls $R | wc -l
