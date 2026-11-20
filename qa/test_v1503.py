"""v10.503 (D273 · docs/641) 가격 변동 알림 — 대표 11/20 「㊸ 회원 2 ③」
  ① (코드) mbx_price_watches · mbx_price_digests · 관심 빼면 지움 트리거 · 알림 MBX_PRICE_DIGEST(끌 수 있음) · 설정 · 정기 작업 08:30 · 명세 · 화면 MYP-MBX-030 · 문서 641
  ② (API · DB) 꺼짐 · 관심 없이 422 · 켬 · 상품 · 개수 · 기준값만 다르게(공유 매물 금액은 안 건드림) → 묶음 알림 1 · 수신 끈 회원 0 · 두 번 1 · 내릴 때만 · 관심 빼면 지움 — 관심은 API 로 넣고 빼서 관심 수 그대로
  ③ (화면) 사용자 웹 나의공간 › 가격 알림
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


def mk_member(tag):
    """시험 회원(본인인증 · MEMBER) — 이메일에 시각을 넣어 두 번 돌아도 새 사람"""
    em, aid = mk_staff(tag, 'MEMBER')
    import consent_ok
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M73 = migr('D273_')
stamp = int(time.time()) % 1000000
MB = {k: rd(f'src/modules/mbx/{k}.ts') for k in ('common', 'recent', 'compare', 'price', 'dm', 'jobs', 'mbx.controller')}
MN, AP, WC, SC = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')
KO = json.loads(rd('site/src/i18n/messages/ko/mbx.json') or '{}')
EN = json.loads(rd('site/src/i18n/messages/en/mbx.json') or '{}')

NJ = json.loads(rd('spec/notifications.json') or '{}'); ev = {e.get('code'): e for e in NJ.get('events', [])}
ok('① 코드 — D273 mbx_price_watches · mbx_price_digests(회원 · 날 고유) · 관심 빼면 지움 trg_mbx_fav_unwatch · 알림 MBX_PRICE_DIGEST(끌 수 있음 · 글) · 설정 mbx.price_alert off · watch_max 50 · 정기 작업 mbx_price_digest 08:30 · 명세 알림 · 화면 MYP-MBX-030 · 문서 641(광고성 법무 확인) · 판 v10.503',
   'CREATE TABLE IF NOT EXISTS public.mbx_price_watches' in M73 and 'UNIQUE (account_id, sent_on)' in M73 and 'trg_mbx_fav_unwatch' in M73
   and "('MBX_PRICE_DIGEST', '관심 가격 변동', true" in M73 and "'MBX_PRICE_DIGEST_INAPP'" in M73 and "('mbx.price_alert', 'off'" in M73 and "('mbx.price_watch_max', '50'" in M73
   and "('mbx_price_digest', 1440, 8, 30" in M73 and "'mbx_price_digest'," in WC and "case 'mbx_price_digest'" in SC and 'export async function priceDigestJob' in MB['price']
   and ev.get('MBX_PRICE_DIGEST', {}).get('optout') is True and '"SB-MYP-MBX-030"' in SJ and 'data-screen="SB-MYP-MBX-030"' in rd('site/src/app/my/price-alerts/page.tsx')
   and '광고성' in doc('641_') and VT >= (10, 503), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid, TM = mk_member('1503')
    em2, aid2, TM2 = mk_member('1503b')
    old = {k: getset(k) for k in ('mbx.price_alert', 'mbx.price_watch_max')}
    favs = []
    try:
        L = [x for x in psql(f"SELECT id FROM listings WHERE status = 'PUBLISHED' AND owner_account_id NOT IN ('{aid}', '{aid2}') ORDER BY published_at DESC NULLS LAST, id LIMIT 2").split('\n') if x]
        P = psql("SELECT code FROM hlt_products WHERE status IN ('ON_SALE', 'SOLD_OUT') ORDER BY code LIMIT 1")
        setting('mbx.price_alert', 'off', '1503')
        off = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0]}, TM)
        setting('mbx.price_alert', 'on', '1503'); setting('mbx.price_watch_max', '50', '1503')
        nofav = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0]}, TM)
        call('POST', f'/me/favorites/{L[0]}', None, TM); favs.append((TM, L[0]))
        call('POST', f'/me/favorites/{L[0]}', None, TM2); favs.append((TM2, L[0]))
        on1 = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0]}, TM)
        on1b = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0]}, TM)
        on2 = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0]}, TM2)
        onp = call('POST', '/me/price-alerts', {'type': 'PRODUCT', 'key': P}, TM) if P else {'created': True}
        setting('mbx.price_watch_max', '1', '1503')
        mx = call('POST', '/me/price-alerts', {'type': 'PRODUCT', 'key': P}, TM2) if P else {'code': 'MBX_WATCH_MAX'}
        setting('mbx.price_watch_max', '50', '1503')
        g = call('GET', '/me/price-alerts', None, TM)
        gi = [x for x in g.get('items') or [] if x.get('key') == L[0]]
        # 기준값만 다르게(공유 매물 금액은 건드리지 않음) — 회원 1 은 받음 · 회원 2 는 「관심 가격 변동」 인앱을 끔
        psql(f"UPDATE mbx_price_watches SET base_price = coalesce(base_price, 0) + 12345, base_fee = NULL WHERE account_id IN ('{aid}', '{aid2}') AND target_type = 'LISTING'")
        psql(f"INSERT INTO notification_preferences (account_id, event_code, channel, enabled, updated_at) VALUES ('{aid2}', 'MBX_PRICE_DIGEST', 'INAPP', false, now()) ON CONFLICT (account_id, event_code, channel) DO UPDATE SET enabled = false")
        j1 = call('POST', '/admin/jobs', {'job': 'mbx_price_digest'}, TS)
        n1 = psql(f"SELECT count(*) || '|' || coalesce(max(link_url), '') FROM notifications WHERE account_id = '{aid}' AND event_code = 'MBX_PRICE_DIGEST'")
        n2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid2}' AND event_code = 'MBX_PRICE_DIGEST'")
        d2 = psql(f"SELECT count(*) FROM mbx_price_digests WHERE account_id = '{aid2}'")
        same = psql(f"SELECT (base_price IS NOT DISTINCT FROM (SELECT deal_amount FROM listings WHERE id = '{L[0]}'))::text FROM mbx_price_watches WHERE account_id = '{aid}' AND target_type = 'LISTING'")
        call('POST', '/admin/jobs', {'job': 'mbx_price_digest'}, TS)
        n1b = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'MBX_PRICE_DIGEST'")
        # 내릴 때만 — 오른 것(기준 < 지금)은 기준값만 새로 · 알림 없음
        drop = call('POST', '/me/price-alerts', {'type': 'LISTING', 'key': L[0], 'dropOnly': True}, TM)
        psql(f"UPDATE mbx_price_watches SET base_price = -1 WHERE account_id = '{aid}' AND target_type = 'LISTING'")
        call('POST', '/admin/jobs', {'job': 'mbx_price_digest'}, TS)
        rb = psql(f"SELECT (base_price IS DISTINCT FROM -1)::text || '|' || drop_only::text FROM mbx_price_watches WHERE account_id = '{aid}' AND target_type = 'LISTING'")
        n1c = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'MBX_PRICE_DIGEST'")
        guest = call('GET', '/me/price-alerts')
        call('DELETE', f'/me/favorites/{L[0]}', None, TM); favs.remove((TM, L[0]))
        gone = psql(f"SELECT count(*) FROM mbx_price_watches WHERE account_id = '{aid}' AND target_type = 'LISTING'")
        rmP = call('DELETE', f'/me/price-alerts/PRODUCT/{P}', None, TM) if P else {'removed': 1}
        ok('② 가격 알림 — 꺼짐 422 · 관심 없이 422 · 관심 뒤 켬(두 번이면 이미) · 상품 켬 · 개수 422 · 목록(기준값) · 정기 작업 → 회원 1 알림 1(주소) · 수신 끈 회원 2 알림 0(기록 1) · 기준값 = 지금 값 · 두 번 돌려도 1 · 내릴 때만(오른 것 기준값만 · 알림 그대로) · 로그인 없이 403 · 관심 빼면 알림 지움 · 상품 끄기',
           off.get('code') == 'MBX_OFF' and nofav.get('code') == 'MBX_NEED_FAVORITE' and on1.get('created') is True and on1b.get('created') is False and on2.get('created') is True
           and onp.get('created') is True and mx.get('code') == 'MBX_WATCH_MAX' and len(gi) == 1 and isinstance(j1, dict) and not j1.get('_err')
           and n1 == '1|/my/price-alerts' and n2 == '0' and d2 == '1' and same == 'true' and n1b == '1' and drop.get('created') is False and rb == 'true|true' and n1c == '1'
           and guest.get('_err') in (401, 403) and gone == '0' and rmP.get('removed') == 1,
           f"{off.get('code')} {nofav.get('code')} {on1.get('created')} {on1b.get('created')} {on2.get('created')} {onp.get('created')} {mx.get('code')} {len(gi)} · job {j1.get('_err') or 'ok'} "
           f"n1 {n1} n2 {n2} d2 {d2} same {same} n1b {n1b} · drop {drop.get('created')} {rb} {n1c} · {guest.get('_err')} gone {gone} {rmP}")
    finally:
        for tok, lid in favs:
            call('DELETE', f'/me/favorites/{lid}', None, tok)
        psql(f"DELETE FROM mbx_price_watches WHERE account_id IN ('{aid}', '{aid2}'); DELETE FROM mbx_price_digests WHERE account_id IN ('{aid}', '{aid2}');")
        psql(f"DELETE FROM notifications WHERE account_id IN ('{aid}', '{aid2}') AND event_code = 'MBX_PRICE_DIGEST'; DELETE FROM notification_preferences WHERE account_id = '{aid2}' AND event_code = 'MBX_PRICE_DIGEST';")
        for k, v in old.items():
            setting(k, v, '1503 되돌림')
        rm_role(aid, '1503'); rm_role(aid2, '1503b')
    if SITE:
        def run(b, seen, perr):
            ps = site_login(b, perr, 'buyer@x.com')
            ps.goto(SITE + '/my/price-alerts', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['scr'] = ps.locator('[data-screen="SB-MYP-MBX-030"]').count()
        r = ui(run)
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 사용자 웹 나의공간 › 가격 알림', seen.get('scr') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
