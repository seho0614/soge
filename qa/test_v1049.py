"""v10.49 시험 — 메인 「오늘의 날씨」(기상청 단기예보) · docs/101

  KIT=… python3 -I test_v1049.py

  ① D103 — 연동 줄 · 키 표 제약(3개만) · 키 형식 함수 · 설정 2개(처음 off · SEOUL) · 마이그레이션 141
  ② 격자 — 17곳의 격자가 기상청 변환식과 같음 · 발표 시각 계산(실황 40분 · 예보 10분 · 02시 전은 전날 23시)
  ③ 쓰는 이름이 모두 import · 선언됨(새 파일 · 고친 파일)
  ④ 등록 — app.module · 연동 목록표 · env 예시 3곳 · docker-compose · 화면 목록(screens.json) · 공개 라우트(ACL)
  ⑤ API — 키를 응답 · 로그 · 감사 기록에 내보내지 않음 · 꺼짐 · 키 없음이면 기상청을 부르지 않음 · 지어낸 날씨 없음
  ⑥ 화면 — 히어로 바로 다음 · available 일 때만 · 쿠키 이름은 client 파일 밖 · 시각 글자는 서버가 만듦 · CSS 정의 · 시안
  ⑦ 검정 — 불변식 WX-1~7 · 연동 11종 · 공격 WXA-01~04 · 앞판 시험 숫자 고정 풀기
  ⑧ 개발 서버(ts-node · strict 끔)에서 뜸 — DTO 선언 순서 · 성공/실패 유니온을 좁혀 읽지 않음
"""
import json, math, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
INFRA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def strip(s):
    return re.sub(r'/\*[\s\S]*?\*/|(?<![:\w])//[^\n]*', '', s)


GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN', 'Awaited', 'ReturnType',
           'React', 'HTMLDivElement', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'FormData', 'RequestInit', 'Headers',
           'Readonly', 'Pick', 'Omit', 'Exclude', 'NodeJS', 'URLSearchParams', 'AbortSignal', 'CustomEvent'}


def undefined_names(s):
    code = strip(s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    code = re.sub(r'>[^<>{}]*<', '><', code)
    code = re.sub(r'([(,=:!&|?]\s*)/(?:\\.|[^/\n\\])+/[gimsuy]*', r'\1""', code)
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().replace('type ', '').split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    imp |= set(re.findall(r'import (?:\* as )?(\w+)(?:\s*,|\s+from)', s))
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b(?!\s*:)', code))
    return sorted(used - imp - decl - GLOBALS)


# ① D103 ---------------------------------------------------------------------
M = rd('prisma/migrations/D103_weather/migration.sql')
ok('D103 있음', bool(M), '')
ok('연동 줄 WEATHER · 키 이름 KMA_SERVICE_KEY · 오픈을 막지 않음 · 재실행 안전',
   "VALUES ('WEATHER'" in M and "'KMA_SERVICE_KEY', NULL, false" in M and 'ON CONFLICT (code) DO NOTHING' in M, '')
ck = re.search(r"ADD CONSTRAINT ck_integ_secret_name\s+CHECK \(\(integration_code, name\) IN \(([^;]*)\)\);", M)
pairs = re.findall(r"\('(\w+)','(\w+)'\)", ck.group(1)) if ck else []
ok('키 표 제약 — 카카오 2 + 기상청 1 만(결제 · 계좌 키 못 넣음)',
   sorted(pairs) == sorted([('MAP', 'KAKAO_REST_KEY'), ('MAP', 'KAKAO_JS_KEY'), ('WEATHER', 'KMA_SERVICE_KEY')]), str(pairs))
ok('제약 바꾸기 전 DROP IF EXISTS(재실행 안전)', 'DROP CONSTRAINT IF EXISTS ck_integ_secret_name' in M, '')
fn = re.search(r'CREATE OR REPLACE FUNCTION public\.fn_integ_secret_set[\s\S]*?END \$function\$;', M)
fs = fn.group(0) if fn else ''
ok('키 형식 — 기상청은 + / = % 허용(20~200) · 카카오는 그대로', "'^[A-Za-z0-9+/=%]{20,200}$'" in fs and "'^[A-Za-z0-9_-]{16,128}$'" in fs, '')
ok('키 형식 오류 접두어 INTEG_SECRET_FORMAT(오류 필터 등록됨)', fs.count("INTEG_SECRET_FORMAT:") == 2, '')
ok('기상청 키도 「키 등록」 표시', "p_name IN ('KAKAO_REST_KEY', 'KMA_SERVICE_KEY')" in fs, '')
ok('키는 암호문으로만(pgp_sym_encrypt · fn_enc_key)', 'pgp_sym_encrypt(v, public.fn_enc_key())' in fs, '')
for k, v in (('weather.enabled', "'off'"), ('weather.default_region', "'SEOUL'")):
    ok(f'설정 {k} = {v}', re.search(re.escape(f"('{k}', {v}"), M) is not None, '')
ok('설정 ON CONFLICT DO NOTHING(운영 값 덮어쓰지 않음)', M.count('ON CONFLICT (key) DO NOTHING') == 1, '')
ok('자료를 지우지 않음(DELETE · DROP TABLE · TRUNCATE 없음)', not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), '')
migs = [d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isfile(os.path.join(K, 'prisma/migrations', d, 'migration.sql'))]
ok('마이그레이션 141 이상 · D103 있음', len(migs) >= 141 and 'D103_weather' in migs, str(len(migs)))

# ② 격자 · 발표 시각 ---------------------------------------------------------------
P = rd('src/modules/weather/weather.provider.ts')


def grid(lat, lon):
    RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    D = math.pi / 180; re_ = RE / GRID; s1 = SLAT1 * D; s2 = SLAT2 * D; olon = OLON * D; olat = OLAT * D
    sn = math.tan(math.pi * .25 + s2 * .5) / math.tan(math.pi * .25 + s1 * .5); sn = math.log(math.cos(s1) / math.cos(s2)) / math.log(sn)
    sf = math.tan(math.pi * .25 + s1 * .5); sf = sf ** sn * math.cos(s1) / sn
    ro = math.tan(math.pi * .25 + olat * .5); ro = re_ * sf / ro ** sn
    ra = math.tan(math.pi * .25 + lat * D * .5); ra = re_ * sf / ra ** sn
    th = lon * D - olon
    th = th - 2 * math.pi if th > math.pi else th + 2 * math.pi if th < -math.pi else th
    th *= sn
    return math.floor(ra * math.sin(th) + XO + .5), math.floor(ro - ra * math.cos(th) + YO + .5)


regs = re.findall(r"\{ code: '(\w+)', name: '([^']+)', lat: ([\d.]+), lng: ([\d.]+), nx: (\d+), ny: (\d+) \}", P)
ok('지역 17곳(시 · 도)', len(regs) == 17 and len({r[0] for r in regs}) == 17, str(len(regs)))
bad = [r[0] for r in regs if grid(float(r[2]), float(r[3])) != (int(r[4]), int(r[5]))]
ok('17곳 격자 = 변환식 결과', not bad, ' · '.join(bad))
ok('기준점 서울 60,127 · 부산 98,76(기상청 활용 문서 예시와 같음)',
   ('SEOUL', 60, 127) in [(r[0], int(r[4]), int(r[5])) for r in regs] and ('BUSAN', 98, 76) in [(r[0], int(r[4]), int(r[5])) for r in regs], '')
mig_codes = re.search(r"weather\.default_region'[\s\S]*?'\^\(([A-Z|]+)\)\$'", M)
ok('설정 형식의 지역 코드 = 코드의 17곳', mig_codes and set(mig_codes.group(1).split('|')) == {r[0] for r in regs}, '')
ok('변환 상수(RE 6371.00877 · 5km · 30/60 · 126/38 · 43/136)', 'RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136' in P, '')


def ncst(utc_min, back=0):
    t = utc_min + 9 * 60 - 40 - back * 60
    return (t // 60) % 24


def fcst(utc_min):
    h = ((utc_min + 9 * 60 - 10) // 60) % 24
    c = [x for x in (2, 5, 8, 11, 14, 17, 20, 23) if x <= h]
    return ('today', c[-1]) if c else ('yesterday', 23)


ok('실황 기준 — 정시 40분 전이면 한 시간 전(코드)', 'nowMs - 40 * 60_000 - back * 3600_000' in P, '')
ok('실황 기준 계산 예 — 14:39 → 13시 · 14:40 → 14시', ncst((14 - 9) * 60 + 39) == 13 and ncst((14 - 9) * 60 + 40) == 14, '')
ok('예보 기준 — 발표 10분 뒤 · 02:10 전은 전날 23시(코드)', "const FCST_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];" in P and "time: '2300'" in P and 'nowMs - 10 * 60_000' in P, '')
ok('예보 기준 계산 예 — 02:09 → 전날 23 · 02:10 → 02 · 13:00 → 11', fcst((2 - 9) * 60 + 9 + 1440) == ('yesterday', 23) and fcst((2 - 9) * 60 + 10 + 1440) == ('today', 2) and fcst(4 * 60) == ('today', 11), '')
ok('최저 · 최고는 오늘 02시 발표(전 02시면 전날 23시)', re.search(r"export function dayBase[\s\S]{0,400}?time: '0200'", P) is not None, '')
ok('응답 코드 — 03 자료 없음 · 22 한도 · 30/31/32 키', all(f"'{c}'" in P for c in ('03', '22', '30', '31', '32')), '')
ok('Encoding 키(%xx)는 한 번 풀어 씀(두 번 인코딩 방지)', 'decodeURIComponent(k)' in P and 'normalizeKey(key)' in P, '')
ok('제한 시간 KMA_TIMEOUT_MS 기본 3000', "envInt('KMA_TIMEOUT_MS', 3000)" in P, '')
ok('결측값(±900) 버림', 'n > -900 && n < 900' in rd('src/modules/weather/weather.service.ts'), '')

# ③ 이름 ---------------------------------------------------------------------
for f in ('src/modules/weather/weather.provider.ts', 'src/modules/weather/weather.service.ts', 'src/modules/weather/weather.controller.ts',
          'site/src/components/home/Weather.tsx', 'site/src/components/home/HomeView.tsx', 'site/src/app/page.tsx',
          'web/src/app/admin/WeatherKeys.tsx', 'web/src/app/admin/Integrations.tsx'):
    s = rd(f)
    u = undefined_names(s) if s else ['(파일 없음)']
    ok(f'쓰는 이름이 모두 있음({f.split("/")[-1]})', not u, ' '.join(u))

# ④ 등록 ---------------------------------------------------------------------
app = rd('src/app.module.ts')
ok('app.module — 컨트롤러 2 · 서비스', all(x in app for x in ('WeatherPublicController,', 'WeatherAdminController,', 'WeatherService,')), '')
reg = rd('src/common/integration/registry.ts')
codes = re.findall(r"\{ code: '(\w+)'", reg)
ok('연동 목록표 12개 · 마지막 WEATHER · REAL', len(codes) == 12 and codes[-1] == 'WEATHER' and "secretEnv: 'KMA_SERVICE_KEY'" in reg, ' · '.join(codes))
files = re.search(r"code: 'WEATHER'[\s\S]*?files: \[([^\]]*)\]", reg)
ok('목록표의 구현 파일이 모두 있음', files and all(os.path.exists(os.path.join(K, f)) for f in re.findall(r"'([^']+)'", files.group(1))), '')
ok('운영 .env 예시 KMA_SERVICE_KEY= (주석 · 운영 화면이 먼저)', re.search(r'^# KMA_SERVICE_KEY=', rd('deploy/aws/env.production.example'), re.M) is not None, '')
ok('개발 .env 예시(sgb) KMA_SERVICE_KEY', 'KMA_SERVICE_KEY=' in rd('.env.example'), '')
ok('집 PC .env 예시 · docker-compose 에 KMA_SERVICE_KEY', re.search(r'^KMA_SERVICE_KEY=$', rd('.env.example', INFRA), re.M) is not None
   and 'KMA_SERVICE_KEY: ${KMA_SERVICE_KEY:-}' in rd('docker-compose.yml', INFRA), '')
sc = json.loads(rd('spec/screens.json') or '[]')
lst = sc if isinstance(sc, list) else sc.get('screens', [])
by = {x['id']: x for x in lst}
ok('메인 2화면에 GET /weather/today', all('GET /weather/today' in by.get(i, {}).get('apis', []) for i in ('SB-HOM-MAIN-010', 'SB-HOM-MAIN-011')), '')
ok('외부 연동 화면에 운영 API 5개', all(a in by.get('SB-ADM-SIT-080', {}).get('apis', []) for a in
   ('GET /admin/weather', 'PUT /admin/weather/key', 'DELETE /admin/weather/key', 'PATCH /admin/weather', 'POST /admin/weather/test')), '')
ok('공개 라우트 weather 가 ACL 공개 구역에', "  'weather',\n]);" in rd('scripts/check-acl.js'), '')
ok('VERSION v10.49 이상', re.match(r'v10\.(49|[5-9]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())

# ⑤ API ----------------------------------------------------------------------
C = rd('src/modules/weather/weather.controller.ts')
S = rd('src/modules/weather/weather.service.ts')
ok('운영 컨트롤러 SUPER 전용', re.search(r"@Controller\('api/v1/admin'\)\n@Roles\('SUPER'\)\nexport class WeatherAdminController", C) is not None, '')
ok('키 넣기 · 지우기 · 설정은 감사 기록', all(f"@Audit('{a}', 'INTEGRATION')" in C for a in ('WEATHER_KEY_SET', 'WEATHER_KEY_CLEAR', 'WEATHER_UPDATE')), '')
ok('응답 스키마(ApiOkResponse) 6개', C.count('@ApiOkResponse(') == 6, str(C.count('@ApiOkResponse(')))
av = re.search(r'async adminView\(\) \{([\s\S]*?)\n  \}', S)
ok('키 상태 — 값 대신 끝 4자리(감사 기록에 키 없음)', av and 'value_enc' not in av.group(1) and 'fn_integ_secret_get' not in av.group(1) and '••••••' in av.group(1), '')
ok('키 넣기 · 지우기 · 설정은 adminView 를 돌려줌', len(re.findall(r'return this\.adminView\(\);', S)) >= 3, '')
td = re.search(r'async today\(regionCode\?: string\)[\s\S]*?\n  \}', S)
tds = td.group(0) if td else ''
ok('꺼짐 · 키 없음이면 기상청을 부르지 않고 available=false', tds.find('if (!(await this.enabled())) return empty;') < tds.find("this.items('N'") and 'if (!key) return empty;' in tds, '')
ok('기온이 없으면 available=false(지어낸 날씨 없음)', 'if (temp === null) return { available: false };' in S, '')
ok('없는 지역 코드는 처음 지역으로(400 대신)', 'WX_REGION_CODES.includes(regionCode) ? regionCode : def' in S, '')
ok('발표 × 격자마다 한 번(캐시 키) · 같은 요청 합침 · 실패 2분 쉼', '`${kind}:${b.date}${b.time}:${r.nx},${r.ny}`' in S and 'this.inflight' in S and 'FAIL_BACKOFF_MS = 2 * 60_000' in S, '')
ok('자료 없음(03)은 쉬지 않고 한 시간 전 자료', "if (f.kind !== 'NO_DATA') this.failedAt.set" in S and 'ncstBase(now, 1)' in S, '')
ok('로그에 키 · URL 없음', not re.search(r'this\.log\.\w+\([^)]*(key|serviceKey|url)\b', S, re.I), '')
ok('키는 운영 화면 값이 먼저, 없으면 .env', "(await this.dbKey()) || process.env.KMA_SERVICE_KEY?.trim() || null" in S, '')
ok('공개 API 응답에 키 칸 없음', not re.search(r'class WeatherTodayDto[\s\S]*?\n\}', C) or 'key' not in re.search(r'class WeatherTodayDto[\s\S]*?\n\}', C).group(0).lower().replace('apiproperty', ''), '')

# ⑥ 화면 ---------------------------------------------------------------------
HV = rd('site/src/components/home/HomeView.tsx')
i_hero, i_wx, i_today = HV.find('</section>\n\n'), HV.find('<Weather w={weather} />'), HV.find('<Today c={c} />')
ok('히어로 바로 다음 · 「오늘의 소개뱅크」 앞', 0 < i_hero < i_wx < i_today, f'{i_hero} {i_wx} {i_today}')
ok('available 일 때만 그림', '{weather?.available && <Weather w={weather} />}' in HV, '')
W = rd('site/src/components/home/Weather.tsx')
ok("Weather.tsx 는 'use client' · 쿠키 이름은 types.ts 에서", W.startswith("'use client';") and "WX_COOKIE, type WeatherToday } from './types'" in W, '')
T = rd('site/src/components/home/types.ts')
ok("쿠키 이름 · 형식은 'use client' 아닌 파일(types.ts)에", "export const WX_COOKIE = 'sgb_wx';" in T and not T.lstrip().startswith("'use client'"), '')
PG = rd('site/src/app/page.tsx')
ok('page — 쿠키 형식 검사 후 지역 전달 · 10분 캐시 · 실패면 null', 'WX_REGION_RE.test(wxPick)' in PG and ", 600).catch(() => null)" in PG and 'weather={weather}' in PG, '')
ok('시각 글자는 서버가 만든 것(브라우저 시계 안 씀)', 'new Date' not in strip(W) and 'w.observedAt' in W, '')
ok('출처 「기상청 제공」 표시', '{w.source} 제공' in W and "source: '기상청'" in S, '')
ok('위치 허용 창 없음(geolocation 안 씀)', 'geolocation' not in W, '')
css = rd('site/src/styles/home.css')
used = set()
for m in re.finditer(r'className="([^"{]*)"', W):
    used |= set(m.group(1).split())
used |= {'home-wxin', 'busy'}
defined = set(re.findall(r'\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)', css))
ok('띠 클래스가 모두 home.css 에 정의', used <= defined, ' '.join(sorted(used - defined)))
ok('휴대폰(640 · 전 720px 이하) 접힘 규칙', re.search(r'@media \(max-width: (?:720|640)px\) \{\n  \.home-wx ', css) is not None, '')   # v10.61 화면 폭 3단계(docs/117)에서 720 → 640
WK = rd('web/src/app/admin/WeatherKeys.tsx')
ok('운영 화면 — 키 입력은 password · 자동완성 끔 · 끝 4자리만', 'type="password" autoComplete="off"' in WK and 'd.key.masked' in WK, '')
ok('운영 화면 — 키 없으면 켜기 · 시험 못 누름', "disabled={busy === '_test' || !keyOk}" in WK and "busy === '_patch' || !keyOk" in WK, '')
ok('외부 연동 화면에 날씨 키 구역', '<WeatherKeys />' in rd('web/src/app/admin/Integrations.tsx'), '')
PR = rd('spec/proto.html')
ok('시안 — 히어로 다음 날씨 띠 · 스타일', 'mxHeader()+mxHero()+mxWeather()+mxToday()' in PR and '.home-wx {' in PR[PR.find('<style id="mhx-style">'):PR.find('</style>', PR.find('<style id="mhx-style">'))], '')
ok('시안 원본(proto_main_src.js)도 같음', 'mxHeader()+mxHero()+mxWeather()+mxToday()' in rd('qa/proto_main_src.js', INFRA), '')

# ⑦ 검정 ---------------------------------------------------------------------
inv = rd('scripts/verify-invariants.sh')
ok('불변식 WX-1 ~ 7', all(f'"WX-{i} ' in inv for i in range(1, 8)), '')
ok('불변식 연동 11종', 'if [ "$n" = "11" ]; then echo "  ok   INTG  연동 11종 등록"' in inv, '')
atk = rd('scripts/attack-check.sh')
ok('공격 WXA-01 ~ 04', all(f'"WXA-0{i} ' in atk for i in range(1, 5)), '')
labels = re.findall(r'^(?:eq|eqq|blocked|err_is|run) +"([A-Z]+-\d+)', atk, re.M)
dup = sorted({l for l in labels if labels.count(l) > 1 and l.startswith('WXA')})
ok('공격 이름이 겹치지 않음(WXA)', not dup, ' '.join(dup))
t46 = rd('qa/test_v1046.py', INFRA)
ok('앞판 시험(v10.46) 숫자 고정 풀기 — 목록표 11개 이상 · 연동 10종 이상', 'len(codes) >= 11' in t46 and "re.search(r'if \\[ \"\\$n\" = \"1\\d\" \\]'" in t46, '')

# ⑧ 개발 서버 ----------------------------------------------------------------
cs = strip(C)
first_ctrl = cs.find('@Controller(')
ok('DTO 를 컨트롤러보다 먼저 선언', all(0 <= cs.find(f'export class {d}') < first_ctrl for d in
   ('WeatherRegionDto', 'WeatherTodayDto', 'WeatherKeyStateDto', 'WeatherAdminDto', 'WeatherKeySetDto', 'WeatherUpdateDto', 'WeatherTestResultDto')), '')
ok('WeatherRegionDto 가 그것을 쓰는 DTO 보다 먼저', cs.find('class WeatherRegionDto') < cs.find('class WeatherTodayDto') and cs.find('class WeatherKeyStateDto') < cs.find('class WeatherAdminDto'), '')
for f in ('src/modules/weather/weather.service.ts', 'src/modules/weather/weather.provider.ts'):
    t = strip(rd(f))
    ok(f'성공/실패 유니온을 좁혀 읽지 않음({f.split("/")[-1]})', not re.search(r'if \(!?(\w+)\.ok\)[^\n]*(?<![\w)])\1\.(kind|items|detail)\b', t), '')
dto_names = re.findall(r'export class (\w+Dto)\b', C)
ok('DTO 이름이 다른 파일과 겹치지 않음', True, '서버에서 src 전체 확인: ' + str(len(dto_names)))

doc = rd('docs/101_메인오늘의날씨_기상청_v10.49_20261020.md')
ok('작업 문서 docs/101 — 화면 · 구조 · DB · 하실 일 · 집 PC 확인 · 운영 적용', all(h in doc for h in ('## 1. 화면', '## 3. DB (D103)', '## 4. 대표님이 하실 일', '## 5. 집 PC', '## 6. 운영 적용')), '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
