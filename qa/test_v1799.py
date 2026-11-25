"""v10.799 (docs/915 · D333) ERP 연결 ① — introspect(서비스 토큰) · ERP 서비스 토큰 만들기
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb python3 test_v1799.py
  ① (코드) D333 설정 · 넘겨주기 표 · 가드(비면 닫힘 · timingSafeEqual) · AuthMiddleware 결과 그대로 · 원문 저장 안 함 · SUPER · 명세 · 문서 915
  ② (API) 토큰 없음 403 · SUPER 토큰 만들기(64자 해시만 DB) · 틀린 토큰 403 · 맞는 토큰 + 운영자 → active · staff · mfaOk · tasks · exp · 맞는 토큰 + 로그인 없음 → active false · 회원 → NOT_STAFF · 상태 tokenSet
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb' if os.path.isdir(KIT + '/sgb') else KIT
API = os.environ.get('API')
DB = os.environ.get('DB')
ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


def doc(prefix):
    d = os.path.join(K, 'docs')
    return next((open(os.path.join(d, x), encoding='utf-8').read() for x in (os.listdir(d) if os.path.isdir(d) else []) if x.startswith(prefix)), '')


VER = rd('VERSION').strip()
VT = tuple(int(x) for x in re.findall(r'\d+', VER))


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=180).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip() + ('\n!' + r.stderr.strip() if r.returncode else '')).strip()




def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


def call_h(m_, p, hd, b=None):
    h = {'content-type': 'application/json', **hd}
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ == 'POST' else None), headers=h, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code')}


MIG = rd('prisma/migrations/D333_erp_link/migration.sql')
G, L, C = rd('src/modules/erp-link/erp-link.guard.ts'), rd('src/modules/erp-link/erp-link.ts'), rd('src/modules/erp-link/erp-link.controller.ts')
SC = rd('spec/screens.json')
ok('① D333 — erp.service_token_hash(NULL · sha256 꼴 · SUPER) · erp_handoff_codes(해시 · 5분 안) · 주소 표 2 이상',
   "('erp.service_token_hash', NULL, 'SUPER'" in MIG and "'^[0-9a-f]{64}$'" in MIG and 'CREATE TABLE IF NOT EXISTS public.erp_handoff_codes' in MIG
   and "interval '5 minutes'" in MIG and MIG.count("'integrations'") >= 2, '')
ok('① 가드 · 판정 — 비면 ERP_TOKEN_UNSET · timingSafeEqual · req.principal 그대로 · 원문은 sha256 만 저장 · 만들기 SUPER · @UseGuards · 명세 ERP-010 · 문서 915',
   "'ERP_TOKEN_UNSET'" in G and 'timingSafeEqual' in G and 'req.principal' in C and 'sha256hex(token)' in L and "@Roles('SUPER')" in C
   and '@UseGuards(ErpLinkGuard)' in C and '"GET /auth/introspect"' in SC and '"POST /admin/erp/service-token"' in SC and 'introspect' in doc('915_') and VT >= (10, 799), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    T = login('admin@x.com')
    r0 = call_h('GET', '/auth/introspect', {'Authorization': 'Bearer ' + (T or '')})
    rot = call('POST', '/admin/erp/service-token', {}, T)
    tok = rot.get('token') or ''
    h = psql("SELECT value FROM site_settings WHERE key = 'erp.service_token_hash'")
    import hashlib
    bad = call_h('GET', '/auth/introspect', {'X-Erp-Service-Token': tok + 'x', 'Authorization': 'Bearer ' + (T or '')})
    good = call_h('GET', '/auth/introspect', {'X-Erp-Service-Token': tok, 'Authorization': 'Bearer ' + (T or '')})
    anon = call_h('GET', '/auth/introspect', {'X-Erp-Service-Token': tok})
    ok('② 만들기 — 원문 erp_ + 64 · DB 는 sha256 만 · 틀린 토큰 403 ERP_TOKEN_INVALID · (만들기 전 응답은 403)',
       r0.get('_err') == 403 and tok.startswith('erp_') and len(tok) == 68 and h == hashlib.sha256(tok.encode()).hexdigest() and tok not in h
       and bad.get('_err') == 403 and bad.get('code') == 'ERP_TOKEN_INVALID', f"{r0.get('code')} · {len(tok)} · {bad.get('code')}")
    ok('② 맞는 토큰 + SUPER → active · staff · super · mfaOk · perm(enforce · decide · tasks 목록) · exp · 로그인 없음 → active false UNAUTHENTICATED',
       good.get('active') is True and good.get('staff') is True and good.get('super') is True and isinstance(good.get('mfaOk'), bool)
       and isinstance((good.get('perm') or {}).get('tasks'), list) and (good.get('perm') or {}).get('decide') in ('ROLE', 'COMPARE', 'GROUPS')
       and isinstance(good.get('exp'), int) and anon.get('active') is False and anon.get('reason') == 'UNAUTHENTICATED',
       f"{ {k: good.get(k) for k in ('active', 'staff', 'super', 'mfaOk', 'exp')} } · {anon}")
    consent_ok.agree('buyer@x.com', PW)
    TB = login('buyer@x.com')
    mem = call_h('GET', '/auth/introspect', {'X-Erp-Service-Token': tok, 'Authorization': 'Bearer ' + (TB or '')})
    st = call('GET', '/admin/erp/link', None, T)
    ok('② 회원 토큰 → active false NOT_STAFF · 상태 tokenSet true · 값은 응답에 없음',
       mem.get('active') is False and mem.get('reason') == 'NOT_STAFF' and st.get('tokenSet') is True and tok not in json.dumps(st) and h not in json.dumps(st), f'{mem} · {st}')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
