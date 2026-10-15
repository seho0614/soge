#!/bin/bash
# v10.30 — 이번 판의 결과 파일을 킷의 qa/results_v10_30 로 모읍니다(문서 79 · 매트릭스 엑셀의 수치가 여기서 나옵니다).
#   전수 검정(chain_1030.sh)이 끝난 뒤에 돌립니다 — 돌고 있으면 멈춥니다(FORCE=1 이면 그래도 모음).
#   묶음 크기 한도(30MiB) 때문에 **요약과 새 시험 결과만** 넣습니다 — 시안이 세 벌 들어가는데 이번 판에 그림 53장이 더해져 한 벌이 2.9MB 커졌습니다.
#   큰 기록(버튼 체크 · 모든 쪽 상호 확인 · 시험별 로그 · 화면 그림)은 넣지 않습니다. 다시 돌리면 qa/ 에 같은 이름으로 생깁니다.
Q=/home/claude/qa; R=/home/claude/pkg/SGB_DevDocker_Integrated_20261002/qa/results_v10_30
if [ -z "${FORCE:-}" ] && ps -eo args | grep -q "[c]hain_1030.sh"; then echo "전수 검정(chain_1030.sh)이 아직 돕니다 — 끝난 뒤에 다시(FORCE=1 이면 그래도 모음)"; exit 1; fi
rm -rf $R; mkdir -p $R; cd $Q
cp final_all.txt $R/final_all_v1030.txt
[ -f final_all_reruns_1030.txt ] && cp final_all_reruns_1030.txt $R/
for f in site_mny.json proto_mny.json measure_mny_site.json measure_mny_proto.json mny_site.json mny_proto.json proto_diff.json proto_pixel.json money_assets.json changed_files_v1030.json found_v1030.json mny_gwan_off.txt \
         attrib_1030.txt hyd_mny.txt hyd_mny_base.txt hyd_base_gwan.txt doc79_notes.json \
         site_mall.json proto_cmu.json proto_mall.json fixtures.json e2e.json api_smoke.json link_check.json db_link.json flow_trade.json flow_mall.json flow_plaza.json flow_biz.json flow_proto.json hyd_load.txt web_main.json web_mal.json; do
  [ -f "$f" ] && cp "$f" $R/ || echo "없음: $f"
done
# 버튼 체크 · 모든 쪽 상호 확인은 요약 한 줄씩만(전체 기록은 1MB 가 넘습니다)
python3 - <<'PY' > $R/큰기록_요약.txt
import json, os
Q = '/home/claude/qa'
def J(f):
    try: return json.load(open(os.path.join(Q, f), encoding='utf8'))
    except Exception as e: return None
for f in ('btn_site.json', 'btn_bo.json', 'site_final.json', 'admin_final.json'):
    d = J(f)
    if d is None: print(f, '— 없음'); continue
    if isinstance(d, dict):
        keys = {k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in d.items() if not isinstance(v, (list, dict)) or len(str(v)) < 200 or k in ('summary', 'total')}
        print(f, '—', json.dumps(keys, ensure_ascii=False)[:600])
    else: print(f, '— 항목', len(d))
PY
# v10.29 그대로와 견준 시험의 실패 단계(이 판 쪽 기록에서 FAIL 줄만)
for f in rr_*.log; do [ -f "$f" ] && { echo "== $f"; grep -E "^\s*(FAIL|✗)" "$f" | cut -c1-260; }; done > $R/넘어온_실패단계_v1030.txt
[ -f /tmp/verify.log ] && grep -E "^통과 [0-9]+ / 실패|^통과 [0-9]+ · 실패|뚫림|SQL 대조|▲위험|전체 검증|라우트 [0-9]+건" /tmp/verify.log > $R/verify_요약_v1030.txt
cat > $R/README.txt <<T
v10.30 결과 폴더 — 전수 검정(final_all_v1030.txt · 다시 돌린 것은 final_all_reruns_1030.txt — 같은 시험의 줄은 다시 돌린 줄이 앞섬)
· 새 시험(site_mny · proto_mny) · 자리 대조(measure_mny_site · measure_mny_proto) · 그림 자리 표(money_assets — 조각마다의 지문 포함) · 앞 시안(v10.28)과 비교(proto_diff · proto_pixel)
· 바뀐 파일(changed_files_v1030 — v10.29 묶음 대비) · 찾은 것(found_v1030) · 관 중지 확인(mny_gwan_off.txt) · 흐름 점검(flow_*) · 연동(link_check · db_link).
· v10.29 그대로와 견줌(attrib_1030.txt · 넘어온_실패단계_v1030.txt) · 화면 다시 그리기 오류 부하 시험(hyd_mny.txt = 이 판의 소개장터 메인 · hyd_load.txt = 전수 검정 · hyd_mny_base.txt · hyd_base_gwan.txt = v10.29 그대로).
묶음 크기 한도(30MiB) 때문에 요약과 새 시험 결과만 넣었습니다 — 버튼 체크 · 모든 쪽 상호 확인은 한 줄 요약(큰기록_요약.txt), 시험별 로그 · 화면 그림은 넣지 않았습니다.
Docker 실구동 · PowerShell 도우미 · 서버 적용 리허설은 이 판에서 돌리지 못했습니다(문서 79 의 「확인하지 못한 것」).
T
ls $R | wc -l; du -sk $R
