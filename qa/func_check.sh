#!/usr/bin/env bash
# 서비스 전체 기능 점검 (v10.73) — 개발 서버 점검판에서 흐름 시험 8가지를 차례로 돌립니다.
#
#   SITE_MODE=prod ~/sgb-check.sh main up  # 먼저 점검판을 올림(갈래는 바꿔도 됨) · 사용자 웹 운영 방식 권장(v10.74)
#   bash ~/sogaebank/sgb-infra/qa/func_check.sh
#   ONLY="flow_trade crawl_site" CRAWL_ROLES=admin bash …/func_check.sh    # 일부만
#   ~/sgb-check.sh main down
#
# · 점검판 포트(13000 · 15173 · 15174 · 15432)만 씁니다. 확인판(3000 · 5174) · RDS 는 쓰지 않습니다.
# · 시험 폴더를 결과 폴더로 복사해 그 안에서 돌립니다 — 저장소에 결과 파일이 생기지 않습니다.
# · 시험 이미지 sgb-qa:v1 이 없으면 qa-image/Dockerfile 로 만듭니다.
# · 결과: ~/check-results/<시각>_func/summary.txt (시험마다 한 줄) · log_<시험>.txt · *.json
set -u
export DOCKER_HOST=${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}
QA=$(cd "$(dirname "$0")" && pwd)
KIT=$(dirname "$(find ~/kits/run/current -maxdepth 3 -path '*/sgb/VERSION' 2>/dev/null | head -1)")
[ -n "$KIT" ] && [ -d "$KIT" ] || { echo "[중단] 점검판 kit 이 없습니다 — 먼저 ~/sgb-check.sh 갈래 up"; exit 1; }
curl -s -o /dev/null --max-time 10 http://localhost:13000/api/v1/health || { echo "[중단] 점검판 API(13000)가 응답하지 않습니다 — ~/sgb-check.sh 갈래 up"; exit 1; }
# v10.74 — 운영 방식(SITE_MODE=prod)이면 사용자 웹이 빌드를 마칠 때까지 기다립니다(최대 15분)
for i in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:15174/)" = 200 ] && break; sleep 10; done
SMODE=$(docker inspect -f '{{join .Config.Cmd " "}}' sgb-site 2>/dev/null | grep -q 'next start' && echo prod || echo dev)
IMG=sgb-qa:v1
docker image inspect $IMG >/dev/null 2>&1 || docker build -q -t $IMG "$QA/qa-image" >/dev/null || { echo "[중단] 시험 이미지를 만들지 못했습니다"; exit 1; }
RES=~/check-results/$(date +%Y%m%d_%H%M)_func; mkdir -p "$RES/w"
cp -r "$QA"/. "$RES/w/"
ONLY=${ONLY:-fixtures e2e flow_trade flow_biz flow_mall flow_plaza crawl_site crawl_admin}
echo "== 기능 점검: $(cat "$KIT/VERSION") · 사용자 웹 $SMODE · $ONLY → $RES" | tee "$RES/summary.txt"
touch "$RES/.start"
for s in $ONLY; do
  t0=$(date +%s)
  docker run --rm --network host -v "$RES/w":/w -v "$KIT":/core:ro -w /w \
    -e API=http://localhost:13000/api/v1 -e SITE=http://localhost:15174 -e BO=http://127.0.0.1:15173 \
    -e DB=postgresql://sgb:sgb@localhost:15432/sgb -e DATABASE_URL=postgresql://sgb:sgb@localhost:15432/sgb \
    -e KIT=/core -e QA=/w -e SGB_ROOT=/core -e SGB_QA_OUT=/w/out -e CRAWL_ROLES="${CRAWL_ROLES:-}" \
    $IMG timeout 5400 python3 "$s.py" > "$RES/log_$s.txt" 2>&1
  rc=$?
  case $s in crawl_*) last="결과 아래 줄" ;; *) last=$(tail -1 "$RES/log_$s.txt" | cut -c1-200) ;; esac
  echo "$s | rc=$rc · $(( $(date +%s) - t0 ))s · $last" | tee -a "$RES/summary.txt"
done
# 이번에 새로 쓴 결과만 (qa 폴더에 남아 있던 옛 결과는 빼고)
find "$RES/w" -maxdepth 2 -name '*.json' -newer "$RES/.start" -exec cp {} "$RES/" \;
rm -f "$RES/.start"
python3 - "$RES" >> "$RES/summary.txt" <<'PY'
import json, sys, os
p = os.path.join(sys.argv[1], 'site_crawl.json')
if os.path.exists(p):
    d = json.load(open(p))
    w = d.get('restart_waits') or []
    pg = d.get('pages') or []
    bad = [x for x in pg if x.get('errors') or x.get('api_fail') or x.get('bad_text') or (x.get('status') or 0) >= 400]
    ph = [x for x in bad if '{' in x.get('route', '') and not (x.get('errors') or x.get('api_fail') or x.get('bad_text'))]
    print(f'사용자 웹 | 화면 {len(pg)} · 오류 {len(bad) - len(ph)} · 표본 없는 주소(404) {len(ph)}'
          + (' — ' + ' · '.join(sorted({x["route"] for x in ph})) if ph else ''))
    print(f'사용자 웹 다시 켜짐을 기다린 곳 {len(w)}곳' + (' — ' + ' · '.join(f'{r}:{u}({n}번)' for r, u, n in w[:10]) if w else ''))
p = os.path.join(sys.argv[1], 'admin_crawl.json')
if os.path.exists(p):
    t = json.load(open(p)).get('tabs') or []
    print(f'운영 화면 | 탭 {len(t)} · 오류 {sum(1 for x in t if x.get("errors") or x.get("api_fail") or x.get("errview"))}')
PY
echo "끝 | $(date)" | tee -a "$RES/summary.txt"
