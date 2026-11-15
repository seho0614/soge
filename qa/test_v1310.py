"""v10.310 (docs/433) — 입점 약관 제17조 요율 ↔ 「입점 유형 요율」 대조 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1310.py

  ① (코드) 제17조 표 줄 ↔ hlt_seller_type_rates · 예정 예약 · 상태 6가지 · GET terms/rate-check · publish-preview rateGaps · 화면 상자 · 게시 확인 창 · 문서 433
  ② (API) 처음 1.0 두 줄 blank · 시험 판(9.x 초안 · 12% · 15.5%)으로 match · unset · mismatch · rateGaps · ADMIN 403 · 끝에 시험 판 지우고 요율 되돌림
  ③ (화면) 「약관」 탭 대조 상자
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
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


def admin_account(tag, stamp):
    """ADMIN(최고 관리자 아님) 시험 계정 — 남겨 두어도 두 번째 실행에 지장 없음"""
    import consent_ok
    em = f't{tag}adm{stamp}@x.com'
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    consent_ok.agree(em, PW)
    return em, aid


def login(e):
    return call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')


TERMS_MD5 = "SELECT md5(string_agg(code || version || status || coalesce(body, ''), '|' ORDER BY code, version)) FROM terms"

TS_, TC, TD = rd('src/modules/catalog/terms.service.ts'), rd('src/modules/catalog/terms.controller.ts'), rd('src/modules/catalog/terms.dto.ts')
RC, TP, SJ, D433 = rd('src/modules/catalog/terms-rate-check.ts'), rd('web/src/app/admin/TermsPanel.tsx'), rd('spec/screens.json'), doc('433_')
ok('① 서버 — 제17조 구간 표 줄(브랜드 직영관 · 일반 입점) ↔ hlt_seller_type_rates · 예정 예약 · 상태 6가지 · GET terms/rate-check(SUPER) · publish-preview rateGaps · DTO 순서 · 읽기만',
   "export function article17(body: string)" in RC and "{ type: 'BRAND' as const, label: '브랜드 직영관' }" in RC and "{ type: 'TENANT' as const, label: '일반 입점' }" in RC
   and "'blank' | 'missing' | 'unset' | 'match' | 'scheduled' | 'mismatch'" in RC and 'async rateCheck()' in TS_ and 'FROM hlt_seller_type_rates t' in TS_
   and "x.scope = 'TYPE' AND x.target = t.seller_type AND x.status = 'SCHEDULED'" in TS_ and "@Get('terms/rate-check')" in TC and 'outsourceGaps, rateGaps,' in TS_
   and TD.index('export class TermRateSlotDto') < TD.index('export class TermRateTermDto') < TD.index('export class TermRateCheckDto') and 'rateGaps!: string[]' in TD
   and 'UPDATE' not in TS_[TS_.find('async rateCheck()'):TS_.find('/** v10.206 (docs/330) — 지금 쓰는 외부 서비스')] and '"GET /admin/terms/rate-check"' in SJ, '')
ok('① 화면 — 「약관」 탭 대조 상자 · 다른 줄 빨강 · 게시 확인 창 ⚠(막지 않음) · 저장 뒤 다시 읽음 · 문서 433 · 판 v10.310',
   "useApi<RateCheck>('/admin/terms/rate-check')" in TP and 'data-terms-rate-check=' in TP and 'data-terms-rate-slot=' in TP and 'pv?.rateGaps?.length' in TP
   and 'setEd(null); reload(); rc.reload();' in TP and 'rate-check' in D433 and VT >= (10, 310), VER)

stamp = str(int(time.time()))[-7:]
NV = f'9.{int(stamp) % 900 + 100}'
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    ADM, _ = admin_account('1310', stamp)
    TS, TA = login('admin@x.com'), login(ADM)
    orig = {r.split('|')[0]: r.split('|')[1] for r in psql("SELECT seller_type || '|' || coalesce(rate::text, '') FROM hlt_seller_type_rates").splitlines() if '|' in r}
    setr = lambda t, v: psql(f"UPDATE hlt_seller_type_rates SET rate = {v if v not in (None, '') else 'NULL'} WHERE seller_type = '{t}'")
    st = lambda r, ver: {x['type']: x['state'] for t in (r.get('terms') or []) if t.get('version') == ver for x in t.get('slots') or []}
    try:
        setr('BRAND', None); setr('TENANT', None)
        r0 = call('GET', '/admin/terms/rate-check', None, TS)
        ok('② 처음 — 입점 약관 1.0 두 줄 「약관 칸이 비어 있음」(blank) · 약관 칸 글 「〔 〕%」 · ok false · ADMIN 403',
           st(r0, '1.0') == {'BRAND': 'blank', 'TENANT': 'blank'} and r0.get('ok') is False
           and all((x.get('termText') or '').startswith('〔') for t in r0.get('terms') or [] if t.get('version') == '1.0' for x in t.get('slots') or [])
           and call('GET', '/admin/terms/rate-check', None, TA).get('_err') == 403, f"{st(r0, '1.0')} · {r0.get('ok')}")
        ins = psql("INSERT INTO terms (code, version, title, body, status, effective_from, is_required, display_order) "
                   f"SELECT code, '{NV}', title, replace(replace(body, '| 브랜드 직영관 | 〔 〕% |', '| 브랜드 직영관 | 12% |'), '| 일반 입점 | 〔 〕% |', '| 일반 입점 | 15.5% |'), "
                   "'DRAFT', 'infinity', is_required, display_order FROM terms WHERE code = 'HLT_SELLER' AND version = '1.0'")
        setr('BRAND', 12)
        r1 = call('GET', '/admin/terms/rate-check', None, TS)
        pv1 = call('GET', f'/admin/terms/HLT_SELLER/publish-preview?version={NV}', None, TS)
        setr('TENANT', 10)
        r2 = call('GET', '/admin/terms/rate-check', None, TS)
        setr('TENANT', 15.5)
        r3 = call('GET', '/admin/terms/rate-check', None, TS)
        pv3 = call('GET', f'/admin/terms/HLT_SELLER/publish-preview?version={NV}', None, TS)
        t3 = next((t for t in r3.get('terms') or [] if t.get('version') == NV), {})
        ok('② 시험 판(12% · 15.5%) — 운영 BRAND 12 · TENANT 비움 → match · unset · 게시 미리보기 rateGaps 1줄(일반 입점) → TENANT 10 → mismatch → 15.5 → 판 ok · rateGaps 없음',
           '!' not in ins and st(r1, NV) == {'BRAND': 'match', 'TENANT': 'unset'} and len(pv1.get('rateGaps') or []) == 1 and '일반 입점' in (pv1.get('rateGaps') or [''])[0]
           and st(r2, NV) == {'BRAND': 'match', 'TENANT': 'mismatch'} and st(r3, NV) == {'BRAND': 'match', 'TENANT': 'match'} and t3.get('ok') is True
           and pv3.get('rateGaps') == [] and r3.get('ok') is False,
           f"{ins[:60]} · {st(r1, NV)} · {pv1.get('rateGaps')} · {st(r2, NV)} · {st(r3, NV)} · {pv3.get('rateGaps')}")
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if ADMIN_WEB and sync_playwright:
            seen = {}
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    box = pg.locator('[data-terms-rate-check]')
                    seen['box'] = box.get_attribute('data-terms-rate-check') if box.count() else ''
                    seen['slots'] = sorted(x.get_attribute('data-terms-rate-slot') for x in box.locator('[data-terms-rate-slot]').all()) if box.count() else []
                    b.close()
            except Exception as e:
                seen['err'] = str(e)[:200]
            ok('③ 화면 — 「약관」 탭 대조 상자(gap) · 1.0 blank 두 줄 · 시험 판 match 두 줄',
               seen.get('box') == 'gap' and '1.0:BRAND:blank' in seen.get('slots', []) and f'{NV}:TENANT:match' in seen.get('slots', []), f'{seen}')
        else:
            print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
    finally:
        psql(f"DELETE FROM terms WHERE code = 'HLT_SELLER' AND version = '{NV}' AND status <> 'PUBLISHED'")
        for t, v in orig.items():
            setr(t, v)
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
