"""v10.517 (D277 · docs/655) 메인 팝업 공지 — 대표 11/20 ㊼ ①
  ① (코드) D277 prx_popups · fn_prx_popup_audience · 설정 prx.popup_max · 서비스 · 컨트롤러(공개 /popups) · 사이트 HomePopups · 오늘 하루 안 보기(브라우저) · 사전 ko · en · 메뉴 · 화면 목록 · 문서 655
  ② (API · DB) 만들면 꺼짐 · 켜면 비로그인에게 보임 · 대상 GUEST 만이면 회원에게 안 보임 · 대상 MEMBER 로 고치면 반대 · 나쁜 주소 400 · 끝난 팝업 켜기 409 · 정리
  ③ (화면) 운영 화면 노출 › 메인 팝업 · 사용자 웹 메인 팝업 · 오늘 하루 안 보기 뒤 다시 열면 안 보임
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
SITE = os.environ.get('SITE')
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

def ui(fn):
    """playwright 가 있으면 브라우저 하나로 fn(b, seen, perr) · 없으면 None"""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    seen, perr = {}, []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            fn(b, seen, perr)
            b.close()
    except Exception as ex:
        perr.append(str(ex)[:160])
    return seen, perr


def site_login(b, perr, email):
    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
    ps.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
    ps.fill('input[name=email]', email); ps.fill('input[name=password]', PW); ps.click('form.auth button'); ps.wait_for_timeout(2500)
    return ps

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S+00:00')


NOW = datetime.datetime.utcnow()
STAMP = int(time.time()) % 1000000
M77 = migr('D277_')
MN, AP, SCH, WK = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
PC = rd('src/modules/prx/prx.controller.ts')
PO, HP, PH, PG = rd('src/modules/prx/popups.ts'), rd('site/src/components/home/HomePopups.tsx'), rd('site/src/components/home/popupHide.ts'), rd('site/src/app/page.tsx')
KO, EN = rd('site/src/i18n/messages/ko/main.json'), rd('site/src/i18n/messages/en/main.json')
ok('① 코드 — D277 팝업 표 · 대상 함수 · 설정 prx.popup_max 3 · 공개 /popups · 사이트 팝업 · localStorage sgb.homePopupHide · 사전 ko · en popup · 메뉴 prx-popup · 화면 PRX-010 · HOM-PRX-010 · 문서 655 · 판 v10.517',
   'CREATE TABLE IF NOT EXISTS public.prx_popups' in M77 and 'FUNCTION public.fn_prx_popup_audience' in M77 and "('prx.popup_max', '3'" in M77
   and 'export async function publicPopups' in PO and "@Get('popups')" in PC and 'PrxPublicController' in PC
   and 'export function HomePopups' in HP and "POPUP_HIDE_KEY = 'sgb.homePopupHide'" in PH and '<HomePopups items={popups} />' in PG
   and '"popup": {' in KO and '"popup": {' in EN and '"hideToday"' in KO and '"hideToday"' in EN
   and "['prx-popup', '메인 팝업']" in MN and "{tab === 'prx-popup' && <PrxPopups />}" in AP
   and '"SB-ADM-PRX-010"' in SJ and '"SB-HOM-PRX-010"' in SJ and '오늘 하루 안 보기' in doc('655_') and VT >= (10, 517), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    tag = f'시험1517-{STAMP}'
    try:
        body = {'title': f'{tag} 안내', 'body': '시험 팝업입니다.', 'linkUrl': '/support', 'linkLabel': '자세히', 'audience': ['GUEST'],
                'startsAt': iso(NOW - datetime.timedelta(hours=1)), 'endsAt': iso(NOW + datetime.timedelta(hours=2)), 'priority': 0}
        c = call('POST', '/admin/prx/popups', body, TS)
        pid = str(c.get('id') or '')
        g0 = call('GET', '/popups')
        tg = call('POST', f'/admin/prx/popups/{pid}/toggle', {'on': True}, TS)
        g1 = call('GET', '/popups'); m1 = call('GET', '/popups', None, TB)
        e = call('PUT', f'/admin/prx/popups/{pid}', {**body, 'audience': ['MEMBER']}, TS)
        g2 = call('GET', '/popups'); m2 = call('GET', '/popups', None, TB)
        has = lambda r: isinstance(r, list) and any(x.get('id') == pid for x in r)
        bad = call('POST', '/admin/prx/popups', {**body, 'linkUrl': 'javascript:alert(1)'}, TS)
        mb = call('GET', '/admin/prx/popups', None, TB)
        old = call('POST', '/admin/prx/popups', {**body, 'title': f'{tag} 지난', 'startsAt': iso(NOW - datetime.timedelta(days=3)), 'endsAt': iso(NOW - datetime.timedelta(days=1))}, TS)
        ton = call('POST', f"/admin/prx/popups/{old.get('id')}/toggle", {'on': True}, TS)
        ok('② API — 만들면 꺼짐(공개에 없음) · 켜면 비로그인에게 보임 · 회원에게 안 보임(GUEST 만) · 대상 MEMBER 로 고치면 회원만 · 나쁜 주소 400 · 회원은 운영 API 403 · 끝난 팝업 켜기 409 PRX_POPUP_ENDED',
           bool(pid) and not has(g0) and tg.get('isOn') is True and has(g1) and not has(m1) and e.get('ok') is True and not has(g2) and has(m2)
           and bad.get('_err') == 400 and mb.get('_err') == 403 and ton.get('_err') == 409 and ton.get('code') == 'PRX_POPUP_ENDED',
           f"{c} {tg} {bad.get('_err')} {mb.get('_err')} {ton}")
        if SITE:
            psql(f"UPDATE prx_popups SET audience = ARRAY['GUEST'] WHERE id = {int(pid)}")
            def chk(b, seen, perr):
                ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda x: perr.append(str(x)[:120]))
                ps.goto(SITE + '/', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                sel = f'[data-home-popup="{pid}"]'
                for _ in range(5):
                    if ps.locator(sel).count() or not ps.locator('[data-home-popup-close]').count(): break
                    ps.click('[data-home-popup-close]'); ps.wait_for_timeout(300)
                seen['shown'] = ps.locator(sel).count()
                if seen['shown']:
                    ps.click(f'{sel} [data-home-popup-hide]'); ps.wait_for_timeout(300)
                ps.reload(wait_until='networkidle'); ps.wait_for_timeout(1500)
                seen['again'] = ps.locator(sel).count()
            r = ui(chk)
            if r is not None:
                seen, perr = r
                ok('③ 화면(사용자 웹) — 메인에 팝업 · 「오늘 하루 안 보기」 뒤 다시 열면 그 팝업 안 보임 · 화면 오류 없음', seen.get('shown') == 1 and seen.get('again') == 0 and not perr, f'{seen} {perr[:2]}')
    finally:
        psql(f"DELETE FROM prx_popups WHERE title LIKE '{tag}%'")
    ok('정리 — 시험 팝업 남지 않음', psql(f"SELECT count(*) FROM prx_popups WHERE title LIKE '{tag}%'") == '0')
    if ADMIN_WEB:
        r = admin_page('/#/prx-popup', lambda pg, seen: seen.update(n=pg.locator('[data-prx-popups]').count(), pv=pg.locator('[data-prx-preview]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면(운영) — 노출 › 메인 팝업(목록 · 미리 보기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('pv') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
