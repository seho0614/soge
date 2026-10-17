"""v10.46 시험 — 카카오맵 지도 · 키는 운영 화면에서(암호화 저장) · docs/96

  KIT=… python3 test_v1046.py

  ① D099 — 표 3개 · 함수 2개 · 유출 검사 보기 2개 · MAP 줄 · map.enabled 처음 off · 배치 geo_backfill · 마이그레이션 137
  ② 쓰는 이름이 모두 import · 선언됨(새 파일 · 고친 파일 전부 — 10/16 StubPaymentProvider 누락의 재발 방지)
  ③ 등록 — app.module · 배치 3곳(JobName · switch · JOBS) · 연동 목록표 · env 예시 · 화면 목록(screens.json) · 검정 숫자(연동 10종)
  ④ 기존 기능에 영향 없음 — 지도 off 면 아무것도 안 함 · 지금 안내 칸이 fallback 으로 그대로 · 기존 응답 칸 그대로(geo 하나만 더함)
  ⑤ 보안 — 공개 API 에 정확 좌표 · 키 값 없음 · 키는 암호문으로만 · 카카오에 상세주소를 보내지 않음
  실제 동작(마이그레이션 · 불변식 MAP-1 ~ 5 · SQL 대조 · 형식 검사)은 통합 검정(realcheck)이 봅니다.
"""
import json, os, re

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
I = os.path.dirname(os.path.abspath(__file__)) + '/..'
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel, base=None):
    p = os.path.join(base or K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


def strip(s):
    s = re.sub(r'/\*[\s\S]*?\*/|(?<![:\w])//[^\n]*', '', s)   # https:// 같은 글자 속 // 는 주석이 아님
    return s


# ① D099 ---------------------------------------------------------------------
M = rd('prisma/migrations/D099_kakao_map/migration.sql')
ok('D099 있음', bool(M), '')
for t in ('listing_geo', 'geo_region', 'integration_secrets'):
    ok(f'표 {t}', f'CREATE TABLE IF NOT EXISTS public.{t}' in M, '')
for f in ('fn_integ_secret_set', 'fn_integ_secret_get'):
    ok(f'함수 {f}', f'CREATE OR REPLACE FUNCTION public.{f}' in M, '')
for v in ('v_geo_exact_leak', 'v_secret_leak'):
    ok(f'유출 검사 {v}', f'CREATE OR REPLACE VIEW public.{v}' in M, '')
ok('MAP 줄 · 오픈 막지 않음 · IP 불필요', re.search(r"VALUES \('MAP',[\s\S]{0,400}?'NOT_STARTED', false, 'KAKAO_REST_KEY', NULL, false", M) is not None, '')
ok('map.enabled 처음 off', re.search(r"\('map\.enabled', 'off'", M) is not None, '')
ok('배치 geo_backfill 10분', "VALUES ('geo_backfill', 10," in M, '')
ok('키 표는 카카오 키 2개만(CHECK)', "('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY')" in M, '')
ok('키는 pgp_sym_encrypt(fn_enc_key())', 'pgp_sym_encrypt(v, public.fn_enc_key())' in M, '')
ok('재실행 안전(IF NOT EXISTS · ON CONFLICT)', M.count('IF NOT EXISTS') >= 4 and M.count('ON CONFLICT') >= 4, '')
ok('자료를 지우지 않음(DROP · DELETE · TRUNCATE 없음)', not re.search(r'\b(DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE)\b', strip(M)), '')
migs = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations'))
              if os.path.exists(os.path.join(K, 'prisma/migrations', d, 'migration.sql')))
# 뒤 판이 마이그레이션을 더해도 통과하게(v10.47 D100 …) — 137 이상 · D099 가 있음
ok('마이그레이션 137 이상 · D099 있음', len(migs) >= 137 and 'D099_kakao_map' in migs, f'{len(migs)} · {migs[-1]}')

# ② 쓰는 이름 -----------------------------------------------------------------
GLOBALS = {'Promise', 'Number', 'String', 'Date', 'Error', 'Set', 'Map', 'Object', 'JSON', 'Math', 'Array', 'Boolean', 'RegExp',
           'Record', 'NonNullable', 'Partial', 'Buffer', 'BigInt', 'Intl', 'Symbol', 'Infinity', 'NaN', 'Awaited', 'ReturnType',
           'React', 'HTMLDivElement', 'HTMLElement', 'HTMLInputElement', 'IntersectionObserver', 'AbortSignal', 'URLSearchParams',
           'Readonly', 'Pick', 'Omit', 'Exclude'}


def undefined_names(s):
    code = strip(s)
    code = re.sub(r"`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"", '""', code)
    code = re.sub(r'>[^<>{}]*<', '><', code)      # JSX 글자(한글 문장 속 낱말)
    code = re.sub(r'([(,=:!&|?]\s*)/(?:\\.|[^/\n\\])+/[gimsuy]*', r'\1""', code)   # 정규식 글자(/^Bearer\s+/i 등)
    imp = set()
    for m in re.finditer(r'import (?:type )?\{([^}]*)\}', s):
        imp |= {x.strip().replace('type ', '').split(' as ')[-1] for x in m.group(1).split(',') if x.strip()}
    imp |= set(re.findall(r'import (\w+)(?:\s*,|\s+from)', s))
    decl = set(re.findall(r'(?:class|interface|const|let|function|type|enum)\s+(\w+)', code))
    used = set(re.findall(r'(?<![.\w])([A-Z][a-z][A-Za-z0-9_]*)\b(?!\s*:)', code))
    return sorted(used - imp - decl - GLOBALS)


TS = ['src/common/geo/kakao-local.provider.ts', 'src/common/geo/geo.service.ts', 'src/modules/geo/geo.controller.ts',
      'src/modules/listing/listing.service.ts', 'src/modules/listing/listing.dto.ts', 'src/worker/scheduler.service.ts',
      'src/worker/worker.controller.ts', 'src/app.module.ts', 'src/common/integration/registry.ts',
      'site/src/components/map/KakaoMap.tsx', 'site/src/components/register/RegisterForm.tsx',
      'site/src/app/request/new/RequestForm.tsx', 'site/src/app/[gwan]/[id]/page.tsx', 'site/src/lib/types.ts',
      'web/src/app/admin/MapKeys.tsx', 'web/src/app/admin/ListingGeoPanel.tsx', 'web/src/app/admin/Integrations.tsx',
      'web/src/app/admin/ReviewDecide.tsx']
for f in TS:
    s = rd(f)
    ok(f'파일 있음 {f}', bool(s), '')
    miss = undefined_names(s)
    ok(f'쓰는 이름이 모두 import · 선언됨 — {os.path.basename(f)}', not miss, ' · '.join(miss))

# ③ 등록 -----------------------------------------------------------------------
am = rd('src/app.module.ts')
for c in ('GeoPublicController', 'GeoAdminController', 'GeoReviewController', 'GeoService'):
    ok(f'app.module 에 {c}', re.search(r'\n\s+' + c + r',', am) is not None and c in am.split('@Module')[0], '')
sch, wc = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('배치 — JobName', "| 'geo_backfill'" in sch, '')
ok('배치 — switch', "case 'geo_backfill':" in sch and 'this.geo.backfill(' in sch, '')
ok('배치 — JOBS', "'geo_backfill'," in wc, '')
ok('배치 — 생성자에 GeoService', 'private readonly geo: GeoService' in sch, '')
reg = rd('src/common/integration/registry.ts')
codes = re.findall(r"\{ code: '(\w+)'", reg)
ok('연동 목록표 11개 · MAP', len(codes) == 11 and codes[-1] == 'MAP' and len(set(codes)) == 11, ' · '.join(codes))
env = rd('deploy/aws/env.production.example')
ok('운영 .env 예시 KAKAO_REST_KEY · NEXT_PUBLIC_KAKAO_JS_KEY', 'KAKAO_REST_KEY=' in env and 'NEXT_PUBLIC_KAKAO_JS_KEY=' in env, '')
inv = rd('scripts/verify-invariants.sh')
ok('불변식 연동 10종', 'if [ "$n" = "10" ]; then echo "  ok   INTG  연동 10종 등록"' in inv, '')
ok('불변식 MAP-1 ~ 5', all(f'"MAP-{i} ' in inv for i in range(1, 6)), '')
sc = json.loads(rd('spec/screens.json') or '{}')
apis = {(s['id'], a) for s in sc.get('screens', []) for a in s.get('apis', [])}
NEED = [('SB-ADM-SIT-080', 'GET /admin/map'), ('SB-ADM-SIT-080', 'PUT /admin/map/keys/{name}'),
        ('SB-ADM-SIT-080', 'DELETE /admin/map/keys/{name}'), ('SB-ADM-SIT-080', 'PATCH /admin/map'),
        ('SB-ADM-SIT-080', 'POST /admin/map/test'), ('SB-ADM-REV-020', 'GET /admin/listings/{id}/geo'),
        ('SB-ADM-REV-020', 'POST /admin/listings/{id}/geo/retry'), ('SB-MNY-DTL-010', 'GET /site-settings/map')]
miss = [f'{a} ({i})' for i, a in NEED if (i, a) not in apis]
ok('화면 목록에 새 API 8개', not miss, ' · '.join(miss))
gc = rd('src/modules/geo/geo.controller.ts')
routes = re.findall(r"@(Get|Post|Put|Patch|Delete)\('([^']+)'\)", gc)
ok('컨트롤러 라우트 8개', len(routes) == 8, ' · '.join(f'{m} {p}' for m, p in routes))
ok('응답 스키마 — 라우트마다 @ApiOkResponse', gc.count('@ApiOkResponse(') == 8, str(gc.count('@ApiOkResponse(')))
ok('공개 라우트는 site-settings 아래(ACL 공개 목록)', "@Get('site-settings/map')" in gc and "'site-settings'" in rd('scripts/check-acl.js'), '')
ok('운영 키 API 는 SUPER', re.search(r"export class GeoAdminController", gc) and re.search(r"@Controller\('api/v1/admin'\)\n@Roles\('SUPER'\)\nexport class GeoAdminController", gc), '')
ok('불리언 입력은 @StrictBoolean', '@StrictBoolean() enabled' in gc and '@IsBoolean' not in gc, '')
ver = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))[:2] or [0, 0])
ok('VERSION v10.46 이상', ver >= (10, 46), rd('VERSION').strip())
ok('설계서 docs/96 · 판 문서 docs/97', any(n.startswith('96_') for n in os.listdir(os.path.join(K, 'docs')))
   and any(n.startswith('97_') for n in os.listdir(os.path.join(K, 'docs'))), '')
dc = rd('docker-compose.yml', I)
ok('개발 Docker api 에 KAKAO_REST_KEY · NEXT_PUBLIC_KAKAO_JS_KEY', 'KAKAO_REST_KEY: ${KAKAO_REST_KEY:-}' in dc
   and 'NEXT_PUBLIC_KAKAO_JS_KEY: ${NEXT_PUBLIC_KAKAO_JS_KEY:-}' in dc, '')
ok('final_parts 에 test_v1046', 'test_v1046' in rd('qa/final_parts.sh', I), '')

# ④ 기존 기능에 영향 없음 ---------------------------------------------------------
gs = rd('src/common/geo/geo.service.ts')
ok('상세 geo — 지도 off 면 null', re.search(r'async listingGeo\([\s\S]{0,200}?if \(!\(await this\.enabled\(\)\)\) return null;', gs) is not None, '')
ok('좌표 예약 — 지도 off 면 아무것도 안 함', re.search(r'scheduleListing[\s\S]{0,400}?if \(await this\.enabled\(\)\)', gs) is not None, '')
ok('배치 — 지도 off · 키 없음이면 건너뜀', "if (!(await this.enabled()) || !(await this.restKey())) return { affected: 0" in gs, '')
ok('좌표 예약은 요청 · 트랜잭션 밖(새 RequestCtx · setImmediate)', 'setImmediate(' in gs and 'RequestCtx.run({ requestId: `geo-' in gs, '')
ls = rd('src/modules/listing/listing.service.ts')
ok('등록 · 수정 응답 그대로(out 을 그대로 돌려줌)', ls.count('return out;') == 2 and ls.count('this.geo.scheduleListing(out.listingId)') == 2, '')
ok('상세 — 좌표를 못 읽어도 상세는 나감(.catch → null)', 'this.geo.listingGeo(id, !!isOwn, ad).catch(() => null)' in ls, '')
ok('상세 — 기존 칸 그대로 + geo 하나', 'canInquire, inquireBlockReason: reason, geo };' in ls, '')
km = rd('site/src/components/map/KakaoMap.tsx')
ok('지도 부품 — 켜졌다고 확인되기 전에는 fallback(지금 화면)', "if (!want || state === 'idle' || state === 'off') return <div ref={watch} data-kmap-watch=\"\">{fallback}</div>;" in km, '')
ok('지도 부품 — 키를 빌드에 넣지 않음(서버에서 받음)', "fetch('/api/v1/site-settings/map'" in km and 'process.env' not in strip(km), '')
rf, qf = rd('site/src/components/register/RegisterForm.tsx'), rd('site/src/app/request/new/RequestForm.tsx')
ok('매물 등록 — 지금 안내 칸이 fallback 으로 그대로', 'fallback={\n        <div className="w1-mapph" data-reg-map="">' in rf
   and '이 주소의 지도는 좌표 연동 뒤에 이 자리에 들어갑니다.' in rf, '')
ok('요청 등록 — 지금 지역 칸이 fallback 으로 그대로', 'fallback={\n        <div className="w1-rmap" aria-live="polite">' in qf, '')
ok('공유 기능(P2Promo)은 그대로', 'NEXT_PUBLIC_KAKAO_JS_KEY' in rd('site/src/components/partner/P2Promo.tsx'), '')
css = rd('site/src/styles/kmap.css')
used_cls = set(re.findall(r'kmap[\w-]*', ' '.join(re.findall(r'className=\{?[`"]([^`"]+)', km))))
ok('새 클래스는 kmap- 만 · kmap.css 에 정의', all(('.' + c) in css for c in used_cls) and used_cls, ' · '.join(sorted(used_cls)))

# ⑤ 보안 -------------------------------------------------------------------------
pub = re.search(r'async publicConfig\(\) \{([\s\S]*?)\n  \}', gs)
ok('공개 설정 — enabled · jsKey 만', pub and 'restKey' not in pub.group(1) and 'enabled: on && !!js, jsKey: on && js ? js : null' in pub.group(1), '')
lg = re.search(r'async listingGeo\([\s\S]*?\n  \}\n', gs)
other = lg.group(0).split('const sido')[1] if lg and 'const sido' in lg.group(0) else ''
ok('남에게는 geo_region 만(listing_geo 를 읽지 않음)', other and 'listing_geo' not in other and 'geo_region' in other, '')
ok('REGION 좌표는 소수 4자리', 'round(lat, 4) AS lat, round(lng, 4) AS lng' in gs, '')
sv = re.search(r'async secretsView\(\) \{([\s\S]*?)\n  \}', gs)
ok('키 상태 — 값 대신 끝 4자리', sv and 'value_enc' not in sv.group(1) and 'fn_integ_secret_get' not in sv.group(1) and '••••••' in sv.group(1), '')
ok('카카오에는 도로명 · 지번만(상세주소 안 보냄)', "const q = (a?.road || a?.jibun || '').trim();" in gs and 'detail' not in re.search(r'async geocodeListing[\s\S]*?\n  \}\n', gs).group(0), '')
kp = rd('src/common/geo/kakao-local.provider.ts')
ok('카카오 호출 — 키는 머리글만(주소창에 넣지 않음)', "Authorization: `KakaoAK ${key}`" in kp and 'appkey' not in kp, '')
ok('키 넣기 응답 — 감사 기록에 키가 남지 않음(secretsView 를 돌려줌)', re.search(r'async setSecret[\s\S]{0,400}?return this\.secretsView\(\);', gs) is not None, '')
mk = rd('web/src/app/admin/MapKeys.tsx')
ok('운영 화면 — 키 입력은 password · 저장 뒤 비움', 'type="password"' in mk and "setVal((x) => ({ ...x, [n]: '' }))" in mk, '')

n_ok = sum(1 for r in RES if r[0])
print(f'통과 {n_ok} / {len(RES)}')
