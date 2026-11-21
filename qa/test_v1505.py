"""v10.505 (docs/643) 소개몰 재입고 알림 — 대표 11/20 「㊹ ①」
  ① (코드) D274 hlt_restock_subs · 지킴 · 재고 0 → 양수 트리거 · 따라잡기 · 알림 HLT_RESTOCK · 회원 API · 상품 상세 단추 · 사전 · 메뉴 · 화면 · 문서 643
  ② (API · DB) 꺼짐 · 신청 · 다시 신청 · 운영 보기 · 지우기 · 고치기 막음 · 회원당 상한 · 재고 돌아옴 → 알림 한 번 · 취소 · 수신 끔 · 지금 보내기 · 권한 주소
  ③ (화면) 소개몰 › 재입고 알림
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


def new_member(tag):
    """새 회원(본인인증 · 약관 동의) · 토큰 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M74 = migr('D274_')
stamp = int(time.time()) % 1000000
T0 = psql("SELECT now()::text") if (API and DB) else ''
HR, HC, BTN, OR, PP, MN, AP, NJ, PG = (rd('src/modules/health/health-restock.ts'), rd('src/modules/health/health-mlx.controller.ts'), rd('site/src/components/health/RestockButton.tsx'),
                                       rd('site/src/components/health/OptionRows.tsx'), rd('site/src/app/health/p/[code]/page.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                                       rd('spec/notifications.json'), rd('web/src/app/admin/HealthMlx.tsx'))
KO, EN = rd('site/src/i18n/messages/ko/order.json'), rd('site/src/i18n/messages/en/order.json')

ok('① 코드 — D274 재입고 알림 표 · 지킴 · 재고 0 → 양수 트리거 · 따라잡기 · 알림 HLT_RESTOCK · mall.restock_alert off · 정기 작업 mlx_daily_purge · 회원 API(신청 · 내 목록 · 취소) · 운영 API · 상품 상세 단추(공개 설정) · 사전 ko · en · 메뉴 hlt-restock · 화면 MLX-010 · 문서 643 · 판 v10.505',
   'CREATE TABLE IF NOT EXISTS public.hlt_restock_subs' in M74 and 'trg_hlt_restock_guard' in M74 and 'trg_hlt_restock_fire' in M74 and 'FUNCTION public.fn_hlt_restock_catchup' in M74
   and "('HLT_RESTOCK', '재입고 알림', true" in M74 and "('mall.restock_alert', 'off', 'GLOBAL'" in M74 and "('mlx_daily_purge', 1440, 4, 35" in M74
   and 'export async function restockSubscribe' in HR and "@Post('restock')" in HC and "@Delete('restock/:id')" in HC and 'export function RestockButton' in BTN
   and '<RestockButton optionId={o.id} />' in OR and "restock={st['mall.restock_alert'] === 'on'}" in PP and '"restockBtn"' in KO and '"restockBtn"' in EN
   and "['hlt-restock', '재입고 알림']" in MN and "{tab === 'hlt-restock' && <HealthRestock />}" in AP and '"code":"HLT_RESTOCK"' in NJ and 'export function HealthRestock' in PG
   and '"SB-ADM-MLX-010"' in SJ and '"SB-HLT-MLX-010"' in SJ and '재입고' in doc('643_') and VT >= (10, 505), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.restock_alert', 'mall.restock_max')
    s0 = {k: getset(k) for k in keys}
    aid, oid, o0, pst0, pid = '', '', '', '', ''
    try:
        em, aid, TM = new_member('1505')
        row = psql("SELECT o.id || '|' || o.stock || '|' || o.is_active || '|' || p.status || '|' || p.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id "
                   "JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' AND o.is_active AND o.stock > 0 ORDER BY p.code, o.sort LIMIT 1")
        oid, o0, act0, pst0, pid = (row.split('|') + ['', '', '', '', ''])[:5] if row and '!' not in row else ('', '', '', '', '')
        other = psql(f"SELECT o.id || '|' || o.product_id FROM hlt_product_options o WHERE o.id <> '{oid}' ORDER BY o.id LIMIT 1") if oid else ''
        setting('mall.restock_alert', 'off', '1505'); setting('mall.restock_max', '30', '1505')
        psql(f"UPDATE hlt_product_options SET stock = 0 WHERE id = '{oid}'")
        off = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        setting('mall.restock_alert', 'on', '1505')
        s1 = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        s2 = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        bad = call('POST', '/me/health/restock', {'optionId': 'x'}, TM)
        mine = call('GET', '/me/health/restock', None, TM)
        av403 = call('GET', '/admin/health/restock', None, TM)
        av = call('GET', '/admin/health/restock', None, TS)
        dl = psql(f"DELETE FROM hlt_restock_subs WHERE account_id = '{aid}'")
        up = psql(f"UPDATE hlt_restock_subs SET created_at = now() - interval '1 day' WHERE account_id = '{aid}'")
        setting('mall.restock_max', '1', '1505')
        mx = psql(f"INSERT INTO hlt_restock_subs (account_id, option_id, product_id, expires_at) VALUES ('{aid}', '{other.split('|')[0]}', '{other.split('|')[-1]}', now() + interval '1 day')") if '|' in other else '!skip HLT_RESTOCK_MAX'
        setting('mall.restock_max', '30', '1505')
        psql(f"UPDATE hlt_product_options SET stock = {int(o0 or 0)} WHERE id = '{oid}'")
        st1 = psql(f"SELECT state FROM hlt_restock_subs WHERE id = {s1.get('id') or 0}")
        n1 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_RESTOCK'")
        instock = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        psql(f"UPDATE hlt_product_options SET stock = 0 WHERE id = '{oid}'"); psql(f"UPDATE hlt_product_options SET stock = {int(o0 or 0)} WHERE id = '{oid}'")
        n2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_RESTOCK'")
        psql(f"UPDATE hlt_product_options SET stock = 0 WHERE id = '{oid}'")
        s3 = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        c1 = call('DELETE', f"/me/health/restock/{s3.get('id')}", None, TM)
        c2 = call('DELETE', f"/me/health/restock/{s3.get('id')}", None, TM)
        psql(f"INSERT INTO notification_preferences (account_id, event_code, channel, enabled) VALUES ('{aid}', 'HLT_RESTOCK', 'INAPP', false) ON CONFLICT DO NOTHING")
        s4 = call('POST', '/me/health/restock', {'optionId': oid}, TM)
        psql(f"UPDATE hlt_product_options SET stock = {int(o0 or 0)} WHERE id = '{oid}'")
        st4 = psql(f"SELECT state FROM hlt_restock_subs WHERE id = {s4.get('id') or 0}")
        n3 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_RESTOCK'")
        psql(f"DELETE FROM notification_preferences WHERE account_id = '{aid}' AND event_code = 'HLT_RESTOCK'")
        psql(f"INSERT INTO hlt_restock_subs (account_id, option_id, product_id, expires_at) VALUES ('{aid}', '{oid}', '{pid}', now() + interval '1 day')")
        run = call('POST', '/admin/health/restock/run', {}, TS)
        n4 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_RESTOCK'")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'hlt-restock'")
        ok('② 재입고 — 꺼짐 422 · 신청 · 다시 신청 already · 잘못된 옵션 400 · 내 목록 · 회원 403 · 운영 기다림 · 지우기 막음 · 신청 시각 고치기 막음 · 회원당 상한 · 재고 돌아옴 → 알림 1 · 재고 있음 422 · 두 번째 0 → 양수는 알림 없음(한 번) · 취소 · 다시 취소 409 · 수신 끔이면 닫히되 알림 없음 · 지금 보내기(따라잡기) +1 · 권한 주소 2',
           bool(oid) and int(o0 or 0) > 0 and off.get('code') == 'HLT_RESTOCK_OFF' and bool(s1.get('id')) and s1.get('already') is False and s2.get('already') is True and bad.get('_err') == 400
           and any(x.get('id') == s1.get('id') for x in (mine.get('items') or [])) and av403.get('_err') == 403 and av.get('waiting', 0) >= 1
           and 'HLT_RESTOCK_KEEP' in dl and 'HLT_RESTOCK_FIXED' in up and 'HLT_RESTOCK_MAX' in mx and st1 == 'NOTIFIED' and n1 == '1' and instock.get('code') == 'HLT_RESTOCK_IN_STOCK'
           and n2 == '1' and c1.get('state') == 'CANCELED' and c2.get('_err') == 409 and st4 == 'NOTIFIED' and n3 == '1' and run.get('notified', 0) >= 1 and n4 == '2' and rmap == '2',
           f"{oid[:8]} {o0} {off.get('code')} {s1.get('id')}/{s1.get('already')} {s2.get('already')} {bad.get('_err')} {av403.get('_err')} {av.get('waiting')} · {dl[-40:]} {up[-40:]} {mx[-40:]} · {st1} {n1} {instock.get('code')} {n2} · {c1.get('state')} {c2.get('_err')} {st4} {n3} {run.get('notified')} {n4} {rmap}")
    finally:
        if oid:
            psql(f"UPDATE hlt_product_options SET stock = {int(o0 or 0)}, is_active = {act0 or 'true'} WHERE id = '{oid}'")
            if pst0: psql(f"UPDATE hlt_products SET status = '{pst0}' WHERE id = '{pid}' AND status <> '{pst0}'")
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_restock_subs WHERE account_id = '{aid}'; DELETE FROM notifications WHERE account_id = '{aid}'; "
                 f"DELETE FROM notification_preferences WHERE account_id = '{aid}';")
        for k, x in s0.items():
            setting(k, x or None, '1505 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/hlt-restock', lambda pg, seen: seen.update(n=pg.locator('[data-hlt-restock]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 재입고 알림(요약 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
