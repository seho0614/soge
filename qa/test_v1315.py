"""v10.315 (docs/439) — 간주 모드 끄는 순서 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1315.py

  ① (코드) GET /admin/assume-readiness — 서버가 끌 때 보는 조건 그대로 · 키 값 안 보냄 · 읽기만 · 화면 상자 · 문서 439 · 판 v10.315
  ② (API) 4줄 순서 · 지금 값 · 연동 상태 · 「아직」 · 세금계산서 7일 시험 · ADMIN 도 봄
  ③ (화면) 오픈 체크리스트 상자 · 관리자 스위치 위
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

AS, AC, AR, OC, D439 = rd('src/modules/admin/admin.service.ts'), rd('src/modules/admin/admin.controller.ts'), rd('web/src/app/admin/AssumeReadiness.tsx'), rd('web/src/app/admin/OpenChecklist.tsx'), doc('439_')
SEG = AS[AS.find('async assumeReadiness()'):AS.find('  openBlockers() {')]
ok('① 서버 — 간주 4개 · 서버가 끌 때 보는 조건 그대로(연동 TESTING · LIVE · 세금계산서 설정 · 7일 키 확인 · 시험 발행 · 수금 계좌 세 항목) · 키 값 안 보냄 · 읽기만 · 명세',
   "@Get('assume-readiness')" in AC and "'etax.require_config', 'on')) !== 'off'" in SEG and "['ETAX_URL', 'ETAX_KEY']" in SEG and "!!(process.env[k] ?? '').trim()" in SEG
   and "kind IN ('PG_KEY', 'ETAX_KEY', 'ETAX_TEST_ISSUE')" in SEG and "value NOT LIKE '999999-%'" in SEG and "integSteps('BROKER', ['TESTING', 'LIVE'])" in SEG
   and 'process.env[k]}' not in SEG and 'UPDATE' not in SEG and 'INSERT' not in SEG and '"GET /admin/assume-readiness"' in rd('spec/screens.json'), '')
ok('① 화면 — 오픈 체크리스트 「관리자 스위치」 위 「간주 모드 끄는 순서」 · 끌 수 있음 / 아직 — 빠진 것 · 조건 ✓ ✗ · 문서 439 · 판 v10.315',
   '<AssumeReadiness />' in OC and OC.find('<AssumeReadiness />') < OC.find('<Switches />') and "useApi<{ rows: Row[]; note: string }>('/admin/assume-readiness')" in AR
   and 'data-assume-row={r.key}' in AR and '끌 수 있음' in AR and '간주 모드 끄는 순서' in D439 and VT >= (10, 315), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    stamp = str(int(time.time()))[-7:]
    ADM, _ = admin_account('1315', stamp)
    TS, TA = login('admin@x.com'), login(ADM)
    r = call('GET', '/admin/assume-readiness', None, TS)
    a = call('GET', '/admin/assume-readiness', None, TA)
    rows = r.get('rows') or []
    keys = [x.get('key') for x in rows]
    by = {x.get('key'): x for x in rows}
    vals = {k: psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{k}'") for k in keys}
    integ = {x.split('|')[0]: x.split('|')[1] for x in psql("SELECT code || '|' || status FROM integrations WHERE code IN ('PG', 'BROKER', 'ETAX')").splitlines() if '|' in x}
    raw = json.dumps(r, ensure_ascii=False)
    etax = by.get('assume.etax', {})
    ok('② API — 4줄 순서(수금 계좌 · 중개사 · 세금계산서 · 결제) · 지금 값 = 설정 · 연동 상태 줄 = integrations · 연동이 시험 중 · 연결됨이 아니면 「아직」 · 세금계산서 줄에 7일 시험 · 키 · 주소 값 없음 · ADMIN 도 봄',
       keys == ['assume.bank', 'assume.broker', 'assume.etax', 'assume.payment'] and [x.get('order') for x in rows] == [1, 2, 3, 4]
       and all(by[k].get('value') == (vals[k] or 'on') for k in keys)
       and all((integ.get(c) in ('TESTING', 'LIVE')) or by[k].get('ready') is False for k, c in (('assume.broker', 'BROKER'), ('assume.payment', 'PG')))
       and (by['assume.broker'].get('steps') or [{}])[0].get('label', '').startswith('외부 연동 상태') and (by['assume.broker'].get('steps') or [{}])[0].get('now', '').endswith(integ.get('BROKER', '없음'))
       and (any('7일' in s.get('label', '') for s in etax.get('steps', [])) or any('require_config' in s.get('label', '') for s in etax.get('steps', [])))
       and 'sk_' not in raw and 'http://' not in raw and 'https://' not in raw and '_err' not in a and len(a.get('rows') or []) == 4,
       f"{keys} · { {k: (by[k].get('value'), by[k].get('ready'), by[k].get('missing')) for k in keys} } · 연동 {integ}")
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
                pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-assume-readiness]')
                seen['rows'] = [x.get_attribute('data-assume-row') for x in box.locator('[data-assume-row]').all()] if box.count() else []
                seen['steps'] = box.locator('[data-assume-step]').count() if box.count() else 0
                seen['before'] = pg.evaluate("(() => { const a = document.querySelector('[data-assume-readiness]'), b = document.querySelector('[data-admin-switches]'); return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); })()")
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        ok('③ 화면 — 오픈 체크리스트 「간주 모드 끄는 순서」 4줄 · 조건 줄 · 「관리자 스위치」 위',
           seen.get('rows') == ['assume.bank', 'assume.broker', 'assume.etax', 'assume.payment'] and seen.get('steps', 0) >= 8 and seen.get('before') is True, f'{seen}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
