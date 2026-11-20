"""v10.541 (docs/679) 문자 마케팅 — 대표 11/20 「(53) ④ 문자 마케팅」(㊳ 캠페인 위)
  ① (코드) D283 대상 MALL_BUYERS · MALL_REBUY · 7일 상한 트리거 · 080 수신 거부 기록 · 설정 · campaign.ts 패치 · 메뉴 · 화면 · 문서
  ② (API · DB) 상한 FREQ_CAP · 새 대상 캠페인 · 운영 보기 · 080 반영(철회 · 대기 멈춤 · 알림 · 기록) · 웹훅 꺼짐 403 · 회원 403 · 권한 주소
  ③ (화면) 회원 › 문자 마케팅
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


SM, CT, UI, MN, AP, CP, MC = (rd('src/modules/mkx/sms.ts'), rd('src/modules/mkx/mkx.controller.ts'), rd('web/src/app/admin/Mkx.tsx'), rd('web/src/lib/adminMenu.ts'),
                              rd('web/src/App.tsx'), rd('src/modules/marketing/campaign.ts'), rd('web/src/app/admin/MktCampaigns.tsx'))
ok('① 코드 — ㊳ 캠페인 위: 대상 MALL_BUYERS · MALL_REBUY(CHECK · 목록 · SQL · 화면 이름) · 회원별 7일 상한 트리거(FREQ_CAP · ㊳ 지킴 다음 차례) · 080 수신 거부 기록(지문 · 끝 4자리 · 쌓기만) · '
   'mkx.sms_weekly_max 2 · 단가 0 · 웹훅 off · 토큰 지문 · (광고) · 080 문구는 renderCampaign 그대로 · 메뉴 mkx-sms · 화면 MKX-040 · 문서 679(법무 확인 끝) · 판 v10.541',
   "CHECK (audience IN ('ALL', 'RECENT_90', 'CHURN_RISK', 'MALL_BUYERS', 'MALL_REBUY'))" in M83 and "'UNSUBSCRIBED', 'FREQ_CAP')" in M83 and 'trg_mkx_sms_freq_cap' in M83
   and 'CREATE TABLE IF NOT EXISTS public.mkx_optout080' in M83 and "('mkx.sms_weekly_max', '2'" in M83 and "('mkx.optout080_hook', 'off'" in M83 and "('mkx.optout080_token_hash', ''" in M83
   and "'MALL_BUYERS', 'MALL_REBUY'" in CP and "$2 = 'MALL_REBUY'" in CP and 'MALL_BUYERS:' in MC and 'renderCampaign' in SM and 'timingSafeEqual' in SM and "'CONSENT_OPTOUT'" in SM
   and "@Post('site/optout080')" in CT and 'export function MkxSms' in UI and "['mkx-sms', '문자 마케팅']" in MN and "{tab === 'mkx-sms' && <MkxSms />}" in AP
   and '"SB-ADM-MKX-040"' in SJ and '법무 확인 끝' in doc('679_') and VT >= (10, 541), VER)

if API and DB:
    TS = login('admin@x.com')
    keys = ('mkx.sms_weekly_max', 'mkx.optout080_hook')
    s0 = {k: getset(k) for k in keys}
    T0 = psql("SELECT clock_timestamp()::text")
    cids, aid = [], ''
    mk_ok = psql("SELECT count(*) FROM v_terms_current WHERE code IN ('MARKETING', 'MARKETING_NIGHT')")
    if mk_ok != '2':
        print(f'  (마케팅 · 야간 약관이 지금 판이 아님({mk_ok}) — ② 건너뜀)')
    else:
        try:
            em, aid, TM, _ = new_member('1541', addr=False)
            phone = f'0109{stamp:06d}'[:11]
            psql(f"UPDATE accounts SET phone = '{phone}' WHERE id = '{aid}'")
            marketing(aid, "'MARKETING', 'MARKETING_NIGHT'")
            setting('mkx.sms_weekly_max', '1', '1541'); setting('mkx.optout080_hook', 'off', '1541')
            for i in (1, 2):
                c = psql(f"INSERT INTO mkt_campaigns (title, channel, body, audience) VALUES ('시험 1541 문자 {i}', 'SMS', '이번 주 소개몰 할인 안내입니다. 소개몰에서 확인해 주십시오.', 'MALL_BUYERS') RETURNING id")
                cids.append(c.splitlines()[0] if c and not c.startswith('!') else '')
            ins = []
            for i, c in enumerate(cids):
                ins.append(psql(f"INSERT INTO mkt_campaign_sends (campaign_id, account_id, to_masked, unsub_hash) VALUES ({c or 0}, '{aid}', '***{phone[-4:]}', encode(sha256('t1541-{stamp}-{i}'::bytea), 'hex')) RETURNING state || '|' || coalesce(skip_reason, '')"))
            caps = [x.splitlines()[0] if x and not x.startswith('!') else x for x in ins]
            api_c = call('POST', '/admin/marketing/campaigns', {'title': f'시험 1541 대상 {stamp}', 'channel': 'SMS', 'body': '소개몰 구매 회원 대상 시험 문자입니다. 확인해 주십시오.', 'audience': 'MALL_REBUY'}, TS)
            if api_c.get('id'): cids.append(str(api_c.get('id')))
            aud = call('GET', f"/admin/marketing/campaigns/{api_c.get('id')}/audience", None, TS) if api_c.get('id') else {}
            av = call('GET', '/admin/mkx/sms', None, TS)
            camp = next((x for x in (av.get('campaigns') or []) if x.get('id') == cids[0]), {})
            empty = call('POST', '/admin/mkx/sms/optout080', {'phones': 'abcdefghijkl'}, TS)
            opt = call('POST', '/admin/mkx/sms/optout080', {'phones': f'{phone[:3]}-{phone[3:7]}-{phone[7:]}\n0101'}, TS)
            cons = psql(f"SELECT string_agg(term_code || '=' || agreed::text, ',' ORDER BY term_code) FROM v_term_consent_current WHERE account_id = '{aid}' AND term_code IN ('MARKETING', 'MARKETING_NIGHT')")
            q1 = psql(f"SELECT state || '|' || coalesce(skip_reason, '') FROM mkt_campaign_sends WHERE campaign_id = {cids[0] or 0} AND account_id = '{aid}'")
            rec = psql(f"SELECT phone_last4 || '|' || accounts || '|' || withdrew || '|' || source FROM mkx_optout080 WHERE created_at >= '{T0}' AND phone_last4 = '{phone[-4:]}' ORDER BY id DESC LIMIT 1")
            note = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'CONSENT_OPTOUT'")
            ro = psql(f"DELETE FROM mkx_optout080 WHERE phone_last4 = '{phone[-4:]}'")
            hook = call('POST', '/site/optout080', {'phones': [phone]}, None)
            a403 = call('GET', '/admin/mkx/sms', None, TM)
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'mkx-sms'")
            ok('② 문자 마케팅 — 대상 MALL_BUYERS 로 캠페인(DB CHECK) · 7일 상한 1 → 첫 줄 QUEUED · 둘째 SKIPPED FREQ_CAP · API 대상 MALL_REBUY · 받을 사람 보기 · 운영 보기(바이트 · 종류) · 번호 없음 422 · '
               '080 반영(하이픈 번호 · 짧은 줄 무시) → 찾음 1 · 철회 2 · 동의 false · 대기 줄 UNSUBSCRIBED · 기록 끝 4자리 · 처리 결과 알림 · 기록 지우기 막음 · 웹훅 꺼짐 403 · 회원 403 · 권한 주소 3',
               all(cids[:2]) and caps == ['QUEUED|', 'SKIPPED|FREQ_CAP'] and bool(api_c.get('id')) and aud.get('audience') == 'MALL_REBUY'
               and camp.get('type') in ('SMS', 'LMS') and (camp.get('bytes') or 0) > 0 and 'audiences' in av and empty.get('code') == 'MKX_OPTOUT_EMPTY'
               and opt.get('matched') == 1 and opt.get('withdrew') == 2 and opt.get('invalid') == 1 and cons == 'MARKETING=false,MARKETING_NIGHT=false'
               and q1 == 'SKIPPED|UNSUBSCRIBED' and rec == f'{phone[-4:]}|1|2|PASTE' and note == '1' and '!' in ro
               and hook.get('_err') == 403 and hook.get('code') == 'MKX_OPTOUT_HOOK_OFF' and a403.get('_err') == 403 and rmap == '3',
               f"{cids} {caps} {api_c.get('id') or api_c} {aud.get('audience')} · {camp.get('type')} {camp.get('bytes')} {empty.get('code')} · {opt} {cons} {q1} {rec} {note} {ro[-30:]} · "
               f"{hook.get('code')} {a403.get('_err')} {rmap}")
        finally:
            ids = ','.join(x for x in cids if x and x.isdigit()) or '0'
            psql(f"SET session_replication_role = replica; DELETE FROM mkt_unsubscribes WHERE campaign_id IN ({ids}); DELETE FROM mkt_campaign_sends WHERE campaign_id IN ({ids}); DELETE FROM mkt_campaigns WHERE id IN ({ids}); "
                 f"DELETE FROM mkx_optout080 WHERE created_at >= '{T0}';")
            if aid:
                psql(f"SET session_replication_role = replica; DELETE FROM term_agreements WHERE account_id = '{aid}' AND term_code IN ('MARKETING', 'MARKETING_NIGHT'); "
                     f"DELETE FROM notifications WHERE account_id = '{aid}' AND event_code = 'CONSENT_OPTOUT'; UPDATE accounts SET phone = NULL WHERE id = '{aid}';")
            for k, x in s0.items():
                setting(k, x or None, '1541 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/mkx-sms', lambda pg, seen: seen.update(n=pg.locator('[data-mkx-sms]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 문자 마케팅(대상 · 상한 · 080 · 화면 오류 없음)', seen.get('n') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
