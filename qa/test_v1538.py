"""v10.538 (docs/676) 웹 푸시 알림 — 대표 11/20 「(53) ① 웹 푸시」
  ① (코드) D283 구독 · 보낸 기록 · 외부 연동 WEBPUSH(18) · 받는 키 2 · push.* off · ASSUME · RFC 8291 · VAPID · 서비스 워커 push · 회원 화면 · 메뉴 · 화면 · 문서
  ② (API · DB) 처음 값 · 꺼짐 422 · 키 · 낯선 주소 422(서버 · DB) · 켜기 한 줄 · 보내기 꺼짐 422 · 간주 보냄 · 한 번만 · 기록 고치기 막음 · 시험 · 회원 403 · 끄기 · 권한 주소
  ③ (화면) 회원 › 웹 푸시 · 나의공간 › 웹 푸시(SITE 있을 때)
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) · 값 없음은 NULL"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def new_member(tag, addr=True):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id') if addr else None
    return em, aid, tok, adr


def direct_product(min_stock=5):
    """직판 · 판매 중 · 켠 옵션 하나(재고 넉넉) 상품 코드 · 옵션 번호 · 재고 · 값"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                f"AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > {min_stock}) = 1 "
                f"AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= {min_stock}) ORDER BY p.code LIMIT 1")
    opt = psql(f"SELECT o.id || '|' || o.stock || '|' || o.price FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") if code else ''
    return code, (opt.split('|') + ['', '', ''])[:3]


def marketing(aid, codes="'MARKETING'"):
    return psql(f"INSERT INTO term_agreements (account_id, term_code, term_version, agreed) SELECT '{aid}', code, version, true FROM v_terms_current WHERE code IN ({codes})")


SJ = rd('spec/screens.json')
M83 = migr('D283_')
stamp = int(time.time()) % 1000000


WP, CT, UI, MN, AP, SW, RG, SS, VI, PG, PT = (rd('src/modules/mkx/webpush.ts'), rd('src/modules/mkx/mkx.controller.ts'), rd('web/src/app/admin/Mkx.tsx'), rd('web/src/lib/adminMenu.ts'),
                                              rd('web/src/App.tsx'), rd('site/public/sw.js'), rd('src/common/integration/registry.ts'), rd('src/common/integration/secret.service.ts'),
                                              rd('scripts/verify-invariants.sh'), rd('site/src/app/my/push/page.tsx'), rd('site/src/components/mkx/PushToggle.tsx'))
ok('① 코드 — D283 구독 표(받는 주소 CHECK · 알려진 푸시 서비스) · 보낸 기록(알림 × 구독 한 번) · 기기 10개 · push.enabled · push.send off · ASSUME · 외부 연동 WEBPUSH(18 · 받는 키 2 · 형식 검사) · '
   'RFC 8291 aes128gcm · VAPID ES256 · 404 · 410 GONE · 밤 쉬기 · 하루 상한 · 서비스 워커 push · notificationclick · 회원 화면 · 메뉴 mkx-push · 화면 MKX-010 · MYP-MKX-010 · 문서 676 · 판 v10.538',
   'CREATE TABLE IF NOT EXISTS public.mkx_push_subs' in M83 and 'fcm\\.googleapis\\.com' in M83 and 'uq_mkx_push_send' in M83 and "'MKX_PUSH_MAX:" in M83
   and "('push.enabled', 'off'" in M83 and "('push.send', 'off'" in M83 and "('push.send_mode', 'ASSUME'" in M83
   and "VALUES ('WEBPUSH', '웹 푸시(VAPID)'" in M83 and "('WEBPUSH','WEBPUSH_VAPID_PUBLIC'), ('WEBPUSH','WEBPUSH_VAPID_PRIVATE')" in M83 and "p_name = 'WEBPUSH_VAPID_PRIVATE'" in M83
   and "('SOCIAL','NAVER_CLIENT_SECRET')" in M83 and "'Content-Encoding: aes128gcm" in WP and "dsaEncoding: 'ieee-p1363'" in WP and "hkdfSync('sha256'" in WP
   and "st === 404 || st === 410" in WP and 'export class WebPushHttp' in WP and 'quiet_hours_exempt' in WP and 'DAILY_MAX' in WP
   and "@Post('push/subscribe')" in CT and "@Post('push/keys')" in CT and 'export function MkxPush' in UI
   and "['mkx-push', '웹 푸시']" in MN and "{tab === 'mkx-push' && <MkxPush />}" in AP and "addEventListener('push'" in SW and "addEventListener('notificationclick'" in SW
   and "code: 'WEBPUSH'" in RG and "name: 'WEBPUSH_VAPID_PRIVATE'" in SS and 'if [ "$n" = "18" ]' in VI and 'SB-MYP-MKX-010' in PG and 'pushManager.subscribe' in PT
   and '"SB-ADM-MKX-010"' in SJ and '"SB-MYP-MKX-010"' in SJ and '처리방침' in doc('676_') and VT >= (10, 538), VER)

if API and DB:
    TS = login('admin@x.com')
    keys = ('push.enabled', 'push.send', 'push.send_mode', 'push.quiet', 'push.daily_max')
    s0 = {k: getset(k) for k in keys}
    aid, nid, made_keys = '', '', False
    try:
        dflt = psql("SELECT string_agg(key || '=' || value, ',' ORDER BY key) FROM site_settings WHERE key IN ('push.enabled', 'push.send', 'push.send_mode')")
        n_int = psql("SELECT count(*) FROM integrations")
        em, aid, TM, _ = new_member('1538', addr=False)
        setting('push.enabled', 'off', '1538')
        off = call('GET', '/me/push', None, TM)
        ep = f'https://fcm.googleapis.com/fcm/send/test1538-{stamp}'
        sub = {'endpoint': ep, 'p256dh': 'B' + 'A' * 86, 'auth': 'A' * 22, 'ua': 'Chrome (시험)'}
        s_off = call('POST', '/me/push/subscribe', sub, TM)
        setting('push.enabled', 'on', '1538')
        had = call('GET', '/admin/mkx/push', None, TS)
        if not ((had.get('keys') or {}).get('publicSet')):
            mk = call('POST', '/admin/mkx/push/keys', {}, TS)
            made_keys = mk.get('ok') is True
        else:
            mk = {'ok': True}
        time.sleep(1)
        bad = call('POST', '/me/push/subscribe', {**sub, 'endpoint': 'https://evil.example.com/push/1'}, TM)
        s1 = call('POST', '/me/push/subscribe', sub, TM)
        s2 = call('POST', '/me/push/subscribe', sub, TM)
        cnt = psql(f"SELECT count(*) FROM mkx_push_subs WHERE account_id = '{aid}' AND state = 'ACTIVE'")
        dbbad = psql(f"INSERT INTO mkx_push_subs (account_id, endpoint, endpoint_hash, p256dh, auth, key_tag) VALUES ('{aid}', 'https://evil.example.com/x', repeat('a', 64), 'B' || repeat('A', 86), repeat('A', 22), 'AAAAAAAA')")
        nid = psql(f"INSERT INTO notifications (account_id, event_code, title, body, link_url) VALUES ('{aid}', 'NOTICE_PUBLISHED', '시험 1538', '웹 푸시 시험 알림입니다.', '/my/notifications') RETURNING id")
        nid = nid.splitlines()[0] if nid and not nid.startswith('!') else ''
        setting('push.send', 'off', '1538')
        r_off = call('POST', '/admin/mkx/push/run', None, TS)
        setting('push.send', 'on', '1538'); setting('push.send_mode', 'ASSUME', '1538'); setting('push.quiet', 'off', '1538'); setting('push.daily_max', '20', '1538')
        r1 = call('POST', '/admin/mkx/push/run', None, TS)
        st = psql(f"SELECT state FROM mkx_push_sends WHERE notification_id = {nid or 0}") if nid else ''
        r2 = call('POST', '/admin/mkx/push/run', None, TS)
        st2 = psql(f"SELECT count(*) FROM mkx_push_sends WHERE notification_id = {nid or 0}") if nid else ''
        ro = psql(f"UPDATE mkx_push_sends SET state = 'SENT' WHERE notification_id = {nid or 0}") if nid else '!'
        tst = call('POST', '/me/push/test', None, TM)
        mine = call('GET', '/me/push', None, TM)
        a403 = call('GET', '/admin/mkx/push', None, TM)
        av = call('GET', '/admin/mkx/push', None, TS)
        un = call('POST', '/me/push/unsubscribe', {'endpoint': ep}, TM)
        tst2 = call('POST', '/me/push/test', None, TM)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'mkx-push'")
        ok('② 웹 푸시 — 처음 off · ASSUME · 연동 18 · 꺼짐이면 구독 422 · 키(없으면 만듦) · 낯선 주소 422 · 켜기 · 다시 켜도 한 줄 · DB 가 낯선 주소 막음 · 보내기 꺼짐 422 · 간주로 보냄 · 같은 알림 다시 안 보냄 · 기록 고치기 막음 · 시험 · 내 기기 · 회원 403 · 운영 보기 · 끄기 · 끈 뒤 시험 409 · 권한 주소 3',
           dflt == 'push.enabled=off,push.send=off,push.send_mode=ASSUME' and n_int in ('18', '19') and off.get('enabled') is False and s_off.get('code') == 'MKX_PUSH_OFF'
           and mk.get('ok') is True and bad.get('code') == 'MKX_PUSH_ENDPOINT' and s1.get('ok') is True and s2.get('ok') is True and cnt == '1' and '!' in dbbad
           and r_off.get('code') == 'MKX_PUSH_SEND_OFF' and (r1.get('assumed') or 0) >= 1 and st == 'ASSUMED' and st2 == '1' and '!' in ro
           and tst.get('mode') == 'ASSUME' and tst.get('sent') == 1 and len(mine.get('subs') or []) >= 1 and bool(mine.get('publicKey'))
           and a403.get('_err') == 403 and (av.get('counts') or {}).get('active', 0) >= 1 and un.get('off') == 1 and tst2.get('_err') == 409 and rmap == '3',
           f"{dflt} {n_int} · {off.get('enabled')} {s_off.get('code')} · {mk.get('ok') or mk} {bad.get('code')} {s1.get('ok') or s1} {cnt} {dbbad[-40:]} · "
           f"{r_off.get('code')} {r1.get('assumed')} {st} {st2} {ro[-30:]} · {tst.get('mode')} {tst.get('sent')} · {a403.get('_err')} {(av.get('counts') or {}).get('active')} {un.get('off')} {tst2.get('_err')} {rmap}")
    finally:
        if aid:
            psql(f"DELETE FROM mkx_push_subs WHERE account_id = '{aid}'; DELETE FROM notifications WHERE account_id = '{aid}';")
        if made_keys:
            call('DELETE', '/admin/integration-keys/WEBPUSH/WEBPUSH_VAPID_PUBLIC', None, TS)
            call('DELETE', '/admin/integration-keys/WEBPUSH/WEBPUSH_VAPID_PRIVATE', None, TS)
            psql("UPDATE integrations SET secret_registered = false WHERE code = 'WEBPUSH'")
        psql("DELETE FROM ops_alerts WHERE alert_code IN ('MKX_PUSH_NOT_READY', 'MKX_PUSH_AUTH') AND resolved_at IS NULL AND raised_at > now() - interval '1 hour'")
        for k, x in s0.items():
            setting(k, x or None, '1538 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/mkx-push', lambda pg, seen: seen.update(n=pg.locator('[data-mkx-push]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 웹 푸시(스위치 · 키 · 기록 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run_site(b, seen, perr):
            ps = site_login(b, perr, 'buyer@x.com')
            ps.goto(SITE + '/my/push', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['page'] = ps.locator('[data-mkx-push-page]').count()
        r2 = ui(run_site)
        if r2 is not None:
            seen2, perr2 = r2
            ok('③ 화면 — 나의공간 › 웹 푸시(안내 · 화면 오류 없음)', seen2.get('page') == 1 and not perr2, f"{seen2} {perr2[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
