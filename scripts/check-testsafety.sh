#!/usr/bin/env bash
# =====================================================================
# 시험 안전 점검 — 검정 자체의 결함을 잡습니다.
#
# 이번 작업에서 반복해 겪은 일곱 가지입니다. 사람이 기억해야 하는
# 규칙은 언젠가 빠지므로 코드로 고정합니다.
#
#   bash scripts/check-testsafety.sh
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

# ★ DB 조회용. 예전에는 이 줄이 없어 ⑫ 가 `Q: unbound variable` 로
#   죽었고, 안전 개수가 19 → 18 로 조용히 줄었습니다.
#   psql 이 없는 환경(킷에는 안 들어 있습니다)에서도 스크립트가
#   멈추지 않도록 없으면 빈 결과를 돌려주는 대역을 씁니다.
if command -v psql >/dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ]; then
  Q="psql $DATABASE_URL -t -A"
else
  Q="true"
fi

ok=0; ng=0
chk() { # 이름, 실제, 기대
  if [ "$2" = "$3" ]; then printf "  안전  %s\n" "$1"; ok=$((ok+1))
  else printf "  ▲위험 %s (기대 %s / 실제 %s)\n" "$1" "$3" "$2"; ng=$((ng+1)); fi
}

echo "== 시험 안전 점검 ====================================="

# ① WHERE 없는 UPDATE/DELETE
#    "UPDATE terms SET status='LEGAL_REVIEW'" 에 WHERE 가 없어
#    10월 1일 발행이 검정 한 번에 사라졌습니다.
# 정리(cleanup) 구문만 봅니다.
#
# blocked/eq 안의 UPDATE·DELETE 는 **일부러 위반을 시도하는 것**이라
# WHERE 가 없어도 정상입니다 — 트리거가 막는지 보는 게 목적입니다.
# 위험한 것은 $PSQL 로 직접 실행하는 정리 구문입니다.
n=$(python3 - <<'PYEND'
import re, glob
bad = 0
for f in glob.glob('scripts/*.sh'):
    s = open(f, encoding='utf-8').read()
    for m in re.finditer(r'\$PSQL -c "', s):
        # 셸 이스케이프(\$\$)로 구문이 잘리면 다음 줄의 WHERE 를 놓칩니다.
        # 따옴표가 아니라 세미콜론까지를 한 구문으로 봅니다.
        seg0 = s[m.end():m.end()+800]
        stmt = seg0.split(';')[0] if ';' in seg0 else seg0
        # ON CONFLICT DO UPDATE 의 UPDATE 는 전체 갱신이 아닙니다.
        stmt = re.sub(r'ON CONFLICT.*?DO UPDATE.*', '', stmt, flags=re.S)
        for op in re.finditer(r'\b(UPDATE|DELETE FROM)\s+\w+', stmt):
            tail = stmt[op.start():]
            seg = tail.split(';')[0]
            if 'WHERE' not in seg and 'TRUNCATE' not in seg:
                bad += 1
print(bad)
PYEND
)
chk "① WHERE 없는 UPDATE·DELETE 없음" "$n" "0"

# ② 안전장치 중복 실행
#    체인 끝에 같은 것을 하나 더 붙이면 두 번째 성공이 첫 실패를 덮습니다.
n=$(python3 -c "
import json;d=json.load(open('package.json',encoding='utf-8'))
print(max((v.count('merge-openapi') for v in d['scripts'].values()), default=0))")
chk "② merge-openapi 중복 실행 없음" "$n" "1"

# ③ 검정에 '건너뜀' 표시가 있는가
#    0행 대상 DELETE 는 트리거가 돌지 않고 성공합니다.
#    대상이 없으면 '건너뜀'이어야 하고, 건너뜀은 통과가 아닙니다.
n=$(grep -c '건너뜀' scripts/attack-check.sh 2>/dev/null || echo 0)
chk "③ 건너뜀 표시 기능 있음" "$([ "$n" -gt 0 ] && echo yes || echo no)" "yes"

# ④ '차단됨'을 왜 차단됐는지까지 보는가
#    없는 함수를 부르면 오류가 "함수 없음"이라 차단된 것처럼 보입니다.
n=$(grep -c 'does not exist\|undefined_function\|42883' scripts/attack-check.sh 2>/dev/null || echo 0)
chk "④ 함수 부재를 차단으로 오인하지 않음" "$([ "$n" -gt 0 ] && echo yes || echo no)" "yes"

# ⑤ 기준선 REF 목록 — 생성기가 만드는 것을 담지 않는가
#    terms 본문이 담겨 이용약관이 11자로 되돌아갔습니다.
n=$(grep -c "'terms'" scripts/build-baseline.js 2>/dev/null | head -1 | tr -d ' ')
chk "⑤ REF 에 terms 없음 (생성기가 만듦)" "$n" "0"

#    반대로 job_schedules 가 빠져 배치 11건이 사라졌습니다.
for t in job_schedules classify_vocab lead_grade_rates report_reasons trust_weights listing_checklist; do
  n=$(grep -c "'$t'" scripts/build-baseline.js 2>/dev/null | head -1 | tr -d ' ')
  chk "⑤ REF 에 $t 있음" "$([ "$n" -gt 0 ] && echo yes || echo no)" "yes"
done

# ⑥ CSS 클래스·토큰
#    없는 클래스는 오류 없이 스타일만 빠집니다.
for d in site web; do
  if [ -d "$d/src/styles" ]; then
    n=$(python3 -c "
import re,glob
css=''.join(open(f,encoding='utf-8').read() for f in glob.glob('$d/src/styles/*.css'))
used=set(re.findall(r'var\((--[a-z0-9-]+)',css)); defined=set(re.findall(r'(--[a-z0-9-]+)\s*:',css))
print(len(used-defined))")
    chk "⑥ $d 미정의 CSS 토큰 없음" "$n" "0"
  fi
done

# ⑦ 한글 SMS 28자
#    바이트가 아니라 글자 수로 세면 한글에서 넘칩니다.
# 소스가 아니라 DB 에 있습니다 — v_sms_over_limit 가 octet_length 로 셉니다.
# 글자 수로 세면 한글에서 넘칩니다(한글 1자 = 3바이트, 90바이트 = 약 28자).
n=$(psql "${DATABASE_URL:-}" -t -A -c \
    "SELECT (pg_get_viewdef('v_sms_over_limit'::regclass) LIKE '%octet_length%')::int;" 2>/dev/null | tr -d ' ')
chk "⑦ SMS 길이를 바이트로 셈" "${n:-0}" "1"

# ⑧ 시안 — TO_PATH 와 ROUTES 는 짝입니다.
#    한쪽에만 넣으면 **주소는 바뀌는데 화면을 못 찾아 "페이지 없음"**이 뜹니다.
#    실제로 계약 화면 3개와 수정 화면이 이렇게 깨졌습니다.
# ★ 시안 경로는 바뀝니다. 킷 안 것을 먼저 보고, 없으면 산출물 폴더를
#   차례로 찾습니다. 예전에는 `01_현행/소개뱅크_로컬확인_*.html` 만
#   보고 있어, 폴더 이름이 바뀌자 이 검사가 조용히 **건너뛰어졌습니다**
#   (안전 개수가 19 → 18 로 줄었는데 원인이 안 보였습니다).
H=""
for cand in spec/proto.html \
            /mnt/user-data/outputs/EN/SGB_Prototype_*.html \
            /mnt/user-data/outputs/*/소개뱅크_로컬확인_*.html; do
  [ -f "$cand" ] && H="$cand" && break
done
if [ -n "$H" ]; then
  n=$(python3 - "$H" <<'PYEND'
import re, sys
h = open(sys.argv[1], encoding='utf-8').read()
m = re.search(r'TO_PATH\s*=\s*\{', h); s = m.end()-1; d = 0
for k in range(s, len(h)):
    if h[k] == '{': d += 1
    elif h[k] == '}':
        d -= 1
        if d == 0: break
paths = dict(re.findall(r'(\w+)\s*:\s*"([^"]+)"', h[s:k+1]))
m2 = re.search(r'ROUTES\s*=\s*\[', h)
# 20261003 — 경로 표는 여러 묶음(NEW_ROUTES 4곳 + ROUTES)에 나뉘어 있습니다. 예전에는 첫 표에서 80,000자만 봤는데,
#   묶음이 하나 늘자(v10.14 투표 모듈) 본 표가 그 범위 밖으로 밀려 106건이 「짝 없음」으로 잘못 나왔습니다. 끝까지 봅니다.
pats = re.findall(r're:\s*/(\^[^/]*(?:\\/[^/]*)*)/\s*,', h[m2.start():])
cs = []
for p in pats:
    try: cs.append(re.compile(p.replace('\\/', '/')))
    except re.error: pass
print(sum(1 for v in paths.values() if not any(c.match(v) for c in cs)))
PYEND
)
  chk "⑧ 시안 TO_PATH↔ROUTES 짝 맞음" "${n:-0}" "0"
else
  # 시안을 못 찾으면 **위험으로 셉니다.** 건너뛰면 깨져도 모릅니다.
  chk "⑧ 시안 파일을 찾을 수 없음" "0" "1"
fi

# ⑨ 화면 ID 일관성.
#    코드 주석과 spec/screens.json 이 어긋나면 **추적이 끊깁니다** —
#    "이 화면이 어느 API 를 쓰는가" 를 문서로 찾을 수 없게 됩니다.
#    실제로 SB-AI- 와 SB-AIS- 가 섞여 있었습니다.
n=$(node -e "
const s=require('./spec/screens.json');
const ids=new Set(s.screens.map(x=>x.id));
const fs=require('fs');
let bad=new Set();
function scan(d){ for(const f of fs.readdirSync(d,{withFileTypes:true})){
  const p=d+'/'+f.name;
  if(f.isDirectory()) scan(p);
  else if(/\.(ts|tsx)\$/.test(f.name)){
    const t=fs.readFileSync(p,'utf8');
    for(const m of t.matchAll(/SB-[A-Z]+-[A-Z]+-[0-9]+/g)) if(!ids.has(m[0])) bad.add(m[0]);
  } } }
scan('src'); scan('web/src');
console.log(bad.size);" 2>/dev/null)
chk "⑨ 코드 화면 ID 가 정의에 있음" "${n:-0}" "0"

# 같은 ID 를 두 화면이 쓰면 어느 쪽인지 알 수 없습니다.
n=$(node -e "
const s=require('./spec/screens.json');
const ids=s.screens.map(x=>x.id);
console.log(ids.length - new Set(ids).size);" 2>/dev/null)
chk "⑩ 화면 ID 중복 없음" "${n:-0}" "0"

# ⑪ 기준선이 빈 DB 에서 서는가.
#    함수가 쓰는 곳보다 뒤에 놓이면 "function does not exist" 로 멈춥니다.
#    개발 DB 에는 이미 있어서 안 보이고, **받은 사람이 처음 세울 때만**
#    드러납니다 — 실제로 한 번 겪었습니다.
#
#    문법 검사로는 못 잡습니다. 빈 DB 에 실제로 세워 봐야 압니다.
#    여기서는 정의가 있는지만 확인하고, 진짜 확인은 deploy-check 가 합니다.
n=$(grep -c 'CREATE FUNCTION public.fn_match_scores' prisma/migrations/B075_functions/migration.sql 2>/dev/null || echo 0)
chk "⑪ 기준선에 함수 정의가 있음" "$([ "${n:-0}" -ge 1 ] && echo 1 || echo 0)" "1"

# ⑫ 관 코드가 코드에 박혀 있지 않은가.
#    건강상품관을 만들었을 때 10개 파일에 ['MNY','MAL','BIZ'] 가
#    박혀 있어, **DB 에는 있는데 API 가 "허용되지 않은 값" 으로**
#    막았습니다. 목록이 0건으로 나오는데 원인이 안 보입니다.
n=$($Q -c "SELECT count(*) FROM gwans WHERE is_active AND NOT is_hub" 2>/dev/null | tr -d '[:space:]')
c=$(grep -rl "'MNY'" src --include=*.ts 2>/dev/null | while read f; do
      grep -o "\['MNY'[^]]*\]" "$f" | head -1; done \
    | grep -c "HLT" 2>/dev/null || echo 0)
t=$(grep -rl "'MNY'" src --include=*.ts 2>/dev/null | wc -l)
chk "⑫ 관 코드 목록이 최신" "$([ "${c:-0}" -ge "${t:-1}" ] && echo 1 || echo 0)" "1"

echo "======================================================="

# ⑬ 주소 매핑에 모든 관이 있는가
#
# ★ 건강상품이 PATH_GWAN 에 빠져 **/health 가 404** 였습니다.
#   DB 에도 있고 API 도 받는데 화면만 못 갔습니다 — 관 코드를 코드에
#   박으면 관을 늘릴 때마다 이런 곳이 남습니다(함정 ⑦).
n=$(psql "$DATABASE_URL" -t -A -c "SELECT count(*) FROM gwans WHERE is_active AND NOT is_hub" 2>/dev/null | tr -d '[:space:]')
m=$(grep -oE "'[A-Z]{3}'" site/src/lib/format.ts 2>/dev/null | sort -u | wc -l | tr -d ' ')
if [ "${n:-0}" = "${m:-0}" ]; then
  echo "  ok   ⑬ 주소 매핑에 관 ${n}개 전부"
else
  echo "  ▲    ⑬ 관 ${n}개인데 매핑 ${m}개 — site/src/lib/format.ts 를 보십시오"
  ng=$((ng+1))   # 이 파일의 위험 카운터는 ng 입니다 (risk 는 오타였습니다)
fi

echo "======================================================="

# ⑭ 오픈 점검(open-check.sh)의 SQL 이 전부 실행되는가   (10/3 · v10.16)
#
# ★ 「미발행 약관 없음」 줄의 SQL 이 문법 오류였습니다(작은따옴표 앞에 \). 결과가 늘 「?」라 **항상 차단**으로 셌고,
#   약관을 전부 발행해도 「열 수 없습니다」가 풀리지 않았습니다. 값이 틀린 것은 눈에 띄지만 「?」는 다른 차단에 묻힙니다.
n=$(bash scripts/open-check.sh 2>/dev/null | grep -cE '[[:space:]]\?[[:space:]]+\(기대' || true)
chk "⑭ 오픈 점검의 SQL 이 전부 실행됨 (「?」 0건)" "${n:-1}" "0"

# ⑮ AWS 적용 스크립트(deploy/aws)의 문법
n=0; for f in deploy/aws/*.sh; do bash -n "$f" 2>/dev/null || n=$((n+1)); done
chk "⑮ deploy/aws 스크립트 문법 오류 0" "$n" "0"

# ⑯ Nginx 설정 도우미가 채우지 않은 자리(__이름__)를 남기지 않는가 · 접근 제한이 location 안에 있는가
#   (server 바로 아래에 두면 인증서 발급 · 갱신 확인까지 막힙니다)
conf=$(APP_LINK=/nonexistent bash deploy/aws/nginx-render.sh example.co.kr admin.example.co.kr 203.0.113.10 2>/dev/null)
n=$(printf '%s\n' "$conf" | grep -c '__[A-Z_]*__' || true)
m=$(printf '%s\n' "$conf" | grep -cE '^  (allow|deny) ' || true)
k=$(printf '%s\n' "$conf" | grep -cE '^    deny all;' || true)
chk "⑯ Nginx 설정 — 빈 자리 0 · server 바로 아래 allow/deny 0 · location 안 deny 4" "$n/$m/$k" "0/0/4"

# ⑰ PowerShell 도우미가 docker 를 직접 부르지 않는가 · UTF-8(BOM)인가   (10/6 · v10.17)
#
# ★ PowerShell 이 docker 의 출력을 대신 읽으면 ISE 같은 창에서 진행 줄이 빨간 오류(NativeCommandError)로 보이고,
#   컨테이너가 내는 한글(UTF-8)이 CP949 로 읽혀 깨집니다 — 결과는 통과인데 화면은 실패처럼 보였습니다.
#   그래서 docker 는 docker/native.ps1 의 도우미(DkShow · DkTee · DkGet · DkQuiet)로만 부릅니다.
#   BOM 이 없으면 Windows PowerShell 5.1 이 파일을 CP949 로 읽어 스크립트 안의 한글이 깨집니다.
#   (검정 컨테이너에는 /docker 만 보이므로 거기서는 dev.ps1 을 뺀 두 파일을 봅니다.)
psd=""; for d in ../docker /docker; do [ -f "$d/native.ps1" ] && { psd="$d"; break; }; done
n=0
if [ -z "$psd" ]; then n=1
else
  for f in "$psd/native.ps1" "$psd/realcheck.ps1" "$psd/../dev.ps1"; do
    [ -f "$f" ] || { [ "$f" = "$psd/../dev.ps1" ] && continue; n=$((n+1)); continue; }
    [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" = "efbbbf" ] || n=$((n+1))
    [ "$(basename "$f")" = "native.ps1" ] && continue
    # 주석(# 뒤)을 떼고, 줄 처음 · ; · { · ( · | 뒤에 명령으로 나오는 docker 를 셉니다 (문자열 안의 "docker …" 는 세지 않음)
    k=$(sed 's/#.*//' "$f" | grep -cE '(^|[;{(|])[[:space:]]*docker[[:space:]]' || true)
    n=$((n + ${k:-0}))
    grep -q 'native\.ps1' "$f" || n=$((n+1))
  done
fi
chk "⑰ PowerShell 도우미 — docker 직접 호출 0 · UTF-8(BOM) · native.ps1 경유" "$n" "0"

echo "안전 $ok · ▲위험 $ng"
[ "$ng" -eq 0 ] || exit 1
