"""v10.312 (docs/436) — 입점 요율 정하기 한 흐름 시험
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1312.py

  ① (코드) 시뮬레이션 「이 요율로 정하기」 · 소개몰 정산 고른 값 줄 · 약관 대조 상자 「약관 칸을 운영 요율로 채우기」 · 문서 436 · 판 v10.312
  ② (화면) 시뮬레이션 → 소개몰 정산 고른 값 줄 → 바꾸기 창 취소 → 지우기
  ③ (화면) 운영 요율 13 · 16(시험이 넣고 되돌림) → 약관 칸 채우기 → 되돌리기 → 취소 → 약관 · 요율 그대로
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

SIM, HT, TP, D436 = rd('web/src/app/admin/HealthRateSim.tsx'), rd('web/src/app/admin/HealthTypeRates.tsx'), rd('web/src/app/admin/TermsPanel.tsx'), doc('436_')
ok('① 화면 — 시뮬레이션 「이 요율로 정하기」(브라우저에만 · 저장 아님) → 소개몰 정산 고른 값 줄 · 같은 바꾸기 창 · 약관 대조 상자 「약관 칸을 운영 요율로 채우기」(제17조 구간 표 칸만) · 되돌리기 · 문서 436 · 판 v10.312',
   "export const TYPE_RATE_PICK = 'sgb.typeRatePick';" in SIM and "location.hash = '#/hlt-settle';" in SIM and 'data-hlt-sim-pick=' in SIM
   and 'sessionStorage.getItem(TYPE_RATE_PICK)' in HT and 'onClick={() => void change(t, pick[t.sellerType])}' in HT and 'data-type-rate-pick-clear' in HT
   and 'function fillRateCells(body: string, rates: Record<string, number>)' in TP and 'data-terms-rate-fill={t.version}' in TP and 'data-term-rate-undo' in TP
   and "method: 'PUT'" not in TP[TP.find('function fillRates('):TP.find('async function openReady(')] and '이 요율로 정하기' in D436 and VT >= (10, 312), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    before = psql(TERMS_MD5)
    orig = {r.split('|')[0]: r.split('|')[1] for r in psql("SELECT seller_type || '|' || coalesce(rate::text, '') FROM hlt_seller_type_rates").splitlines() if '|' in r}
    setr = lambda t, v: psql(f"UPDATE hlt_seller_type_rates SET rate = {v if v not in (None, '') else 'NULL'} WHERE seller_type = '{t}'")
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        seen = {}
        try:
            setr('BRAND', 13); setr('TENANT', 16)
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000})
                pg.on('dialog', lambda d: d.dismiss())   # 「바꾸기」 창은 취소(저장 안 함)
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/hlt-sellers', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                sim = pg.locator('[data-hlt-sim]')
                seen['sim'] = sim.count()
                if sim.count():
                    sim.locator('[data-hlt-sim-in="br"]').fill('13'); sim.locator('[data-hlt-sim-in="gr"]').fill('16'); pg.wait_for_timeout(300)
                    seen['pickAttr'] = sim.locator('[data-hlt-sim-pick]').get_attribute('data-hlt-sim-pick')
                    sim.locator('[data-hlt-sim-pick]').click(); pg.wait_for_timeout(2500)
                    seen['hash'] = pg.evaluate('location.hash')
                    bar = pg.locator('[data-type-rate-pick]')
                    seen['bar'] = bar.get_attribute('data-type-rate-pick') if bar.count() else ''
                    seen['use'] = pg.locator('[data-type-rate-pick-use]').count()
                    pg.locator('[data-type-rate-pick-use="BRAND"]').click(); pg.wait_for_timeout(800)   # 창 → 취소
                    pg.locator('[data-type-rate-pick-clear]').click(); pg.wait_for_timeout(400)
                    seen['cleared'] = pg.locator('[data-type-rate-pick]').count()
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                fb = pg.locator('[data-terms-rate-fill="1.0"]')
                seen['fillBtn'] = fb.count()
                if fb.count():
                    fb.click(); pg.wait_for_timeout(1200)
                    ed = pg.locator('[data-term-editor="HLT_SELLER:1.0"]')
                    val = ed.locator('[data-term-text]').input_value()
                    seen['cells'] = ('| 브랜드 직영관 | 13% |' in val, '| 일반 입점 | 16% |' in val, '〔 〕%' not in val[val.find('제17조'):val.find('제18조')])
                    seen['filled'] = ed.locator('[data-term-rate-filled]').get_attribute('data-term-rate-filled') if ed.locator('[data-term-rate-filled]').count() else ''
                    seen['count'] = ed.locator('[data-term-diff-count]').get_attribute('data-term-diff-count') if ed.locator('[data-term-diff-count]').count() else ''
                    ed.locator('[data-term-rate-undo]').click(); pg.wait_for_timeout(400)
                    seen['undo'] = '〔 〕%' in ed.locator('[data-term-text]').input_value()
                    ed.get_by_role('button', name='취소', exact=True).click(); pg.wait_for_timeout(400)
                b.close()
        except Exception as e:
            seen['err'] = str(e)[:200]
        finally:
            for t, v in orig.items():
                setr(t, v)
        after = psql(TERMS_MD5)
        rates_back = {r.split('|')[0]: r.split('|')[1] for r in psql("SELECT seller_type || '|' || coalesce(rate::text, '') FROM hlt_seller_type_rates").splitlines() if '|' in r}
        ok('② 화면 — 시뮬레이션 13 · 16 → 「이 요율로 정하기」 → #/hlt-settle · 고른 값 줄 13|16 · 단추 2 · 바꾸기 창(취소) · 지우기',
           seen.get('sim') == 1 and seen.get('pickAttr') == '13|16' and seen.get('hash') == '#/hlt-settle' and seen.get('bar') == '13|16'
           and seen.get('use') == 2 and seen.get('cleared') == 0, f'{seen}')
        ok('③ 화면 — 운영 요율 13 · 16 → 「약관」 대조 「1.0 약관 칸을 운영 요율로 채우기」 → 칸 제17조 13% · 16% · 「채웠습니다」 · 바뀐 줄 2 → 되돌리기 → 취소 → 약관 · 요율 그대로',
           seen.get('fillBtn') == 1 and seen.get('cells') == (True, True, True) and '13%' in (seen.get('filled') or '') and str(seen.get('count')) == '2|2'
           and seen.get('undo') is True and after == before and rates_back == orig, f"{ {k: seen.get(k) for k in ('fillBtn', 'cells', 'filled', 'count', 'undo', 'err')} } · 표 {after == before} · 요율 {rates_back == orig}")
    else:
        print('  (운영 화면 · playwright 없음 — ② ③ 건너뜀)')
passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
