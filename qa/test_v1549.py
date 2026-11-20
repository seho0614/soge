"""v10.549 (docs/687) 매물 가격 제안 — 대표 11/21 「(56) ① 매물 가격 제안」
  ① (코드) D286 lpx_offers(회원당 열린 제안 하나 · 자기 매물 LPX_OFFER_SELF · 되제안 · 다시 제안 합쳐 lpx.offer_counter_max(처음 3)번 · DB 가 넘는 것을 막음 · 하한 30% · 기한 7일(대표 11/21) · 지우기 막음) · lpx.offer off · 관별 lpx.offer_gwans NONE(fn_lpx_gwan_on · 서버 정규식 = 값 무늬) · 금액 글자 서버 = DB · 거래를 만들지 않음 · 정기 작업 lpx_hourly · 메뉴 lpx-offers · 화면 LPX-010 · MYP-LPX-010 · 매물 상세 칸 · 사전 · 문서 687
  ② (API · DB) 꺼짐 409 · 관 꺼짐 422(서버 · DB 트리거) · 자기 매물 422 · 하한 422 · 금액 형식 400 · 제안 · 같은 매물 409 · 주인 알림 · 되제안 · 다시 제안 · 3번째 되제안 · 넷째 422 LPX_COUNTER_LIMIT(서버 · DB) · 회원 수락(최종 = 마지막 되제안 · 1:1 문의 안내) · 거두기 · 기한 지나 만료(작업) · 지우기 막음 · 가린 이름 · 운영 목록에 메모 없음 · 권한 주소
  ③ (화면) 검수 › 매물 가격 제안 · 나의공간 › 가격 제안(SITE 있을 때)
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


M86 = migr('D286_')
CT, CM = rd('src/modules/lpx/lpx.controller.ts'), rd('src/modules/lpx/common.ts')
UI, MN, AP = rd('web/src/app/admin/ListingPrice.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/lpx.json')
ENJ = rd('site/src/i18n/messages/en/lpx.json')
DT = rd('site/src/app/[gwan]/[id]/page.tsx')
IX = rd('site/src/i18n/messages/index.ts')


def pub_listing():
    """게시 중 · 거래 금액 있는 시험 매물(…@x.com 주인) — 'id|주인 메일|관|거래 금액|주인 id' 또는 ''"""
    r = psql("SELECT l.id || '|' || a.email || '|' || l.gwan_code || '|' || coalesce(l.deal_amount::text, '') || '|' || a.id FROM listings l JOIN accounts a ON a.id = l.owner_account_id "
             "WHERE l.status = 'PUBLISHED' AND a.email LIKE '%@x.com' AND a.status = 'ACTIVE' AND l.deal_amount >= 10000 ORDER BY l.published_at DESC NULLS LAST LIMIT 1")
    return r if r.count('|') == 4 and '!' not in r else ''

OF = rd('src/modules/lpx/offers.ts')
OB, OV, OP = rd('site/src/components/lpx/LpxOfferBox.tsx'), rd('site/src/components/lpx/OffersView.tsx'), rd('site/src/app/my/offers/page.tsx')

ok('① 코드 — D286 lpx_offers(고유 색인 · LPX_OFFER_SELF · 되제안 · 다시 제안 합쳐 3번(설정 · DB 가 막음) · 하한 30% · 기한 7일 · 지우기 막음) · lpx.offer off · 관별 NONE · 금액 글자 서버 = DB · 거래를 만들지 않음 · lpx_hourly · 서버 · 메뉴 lpx-offers · 화면 LPX-010 · MYP-LPX-010 · 매물 상세 칸 · 사전 · 문서 687 · 판 v10.549',
   'CREATE TABLE IF NOT EXISTS public.lpx_offers' in M86 and 'ux_lpx_offer_live' in M86 and 'LPX_OFFER_SELF' in M86 and 'LPX_COUNTER_LIMIT' in M86 and 'fn_lpx_counter_max()' in M86 and 'ck_lpx_offer_rounds' in M86
   and "('lpx.offer_counter_max', '3'" in M86 and "('lpx.offer_min_pct', '30'" in M86 and "('lpx.offer_days', '7'" in M86 and "'lpx.offer_counter_max': '^[1-5]$'" in CM
   and 'trg_lpx_offer_guard' in M86 and "('lpx.offer', 'off'" in M86 and "('lpx.offer_gwans', 'NONE'" in M86 and "('lpx_hourly', 60," in M86
   and "'^(NONE|[A-Z]{3,4}(,[A-Z]{3,4}){0,29})$'" in M86 and "'lpx.offer_gwans': '^(NONE|[A-Z]{3,4}(,[A-Z]{3,4}){0,29})$'" in CM
   and "LPX_AMOUNT_RE = /^[1-9][0-9]{2,12}$/" in CM and "amount::text ~ '^[1-9][0-9]{2,12}$'" in M86 and "fn_lpx_gwan_on('lpx.offer_gwans', v_gwan)" in M86
   and 'export async function makeOffer' in OF and 'export async function counterOffer' in OF and 'export async function reofferOffer' in OF and "@Post('lpx/offers/:id/reoffer')" in CT and 'export async function offerExpireJob' in OF and 'INSERT INTO deals' not in OF
   and "('lpx-offers', '매물 가격 제안', 'admrev'" in M86 and "@Post('lpx/listings/:id/offers')" in CT and "@Post('lpx/offers/:id/counter')" in CT
   and 'export function LpxOffers' in UI and "['lpx-offers', '매물 가격 제안']" in MN and "{tab === 'lpx-offers' && <LpxOffers />}" in AP
   and '/api/v1/lpx/listings/' in OB and '/api/v1/lpx/me/offers' in OV and 'data-screen="SB-MYP-LPX-010"' in OP and '<LpxOffer listingId={item.id}' in DT
   and '"SB-ADM-LPX-010"' in SJ and '"SB-MYP-LPX-010"' in SJ and '"notContract"' in KOJ and '"notContract"' in ENJ and 'plural' in ENJ
   and re.search(r'const PAGE = \{[^}]*\blpx\b', IX) is not None and '계약이 아님' in doc('687_') and VT >= (10, 549), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    row = pub_listing()
    if not row:
        print('  (게시 중 · 거래 금액 있는 시험 매물이 없음 — ② 건너뜀)')
    else:
        lid, oem, lgw, ask, oid = row.split('|')
        olds = {k: getset(k) for k in ('lpx.offer', 'lpx.offer_gwans', 'lpx.offer_min_pct', 'lpx.offer_counter_max')}
        clean = f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM lpx_offers WHERE listing_id = '{lid}'; COMMIT;"
        psql(clean)
        consent_ok.agree(oem, PW)
        TO = login(oem)
        em1, aid1 = mk_staff('1549a', role=None); consent_ok.agree(em1, PW); T1 = login(em1)
        em2, aid2 = mk_staff('1549b', role=None); consent_ok.agree(em2, PW); T2 = login(em2)
        A = int(ask)
        a90, a92, a93, a97, a99 = (str(A * p // 100) for p in (90, 92, 93, 97, 99))
        try:
            setting('lpx.offer', 'off', '1549')
            off = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, T1)
            setting('lpx.offer', 'on', '1549'); setting('lpx.offer_min_pct', '30', '1549'); setting('lpx.offer_counter_max', '3', '1549')
            setting('lpx.offer_gwans', 'NONE', '1549')
            gw = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, T1)
            gw_db = psql(f"INSERT INTO lpx_offers (listing_id, member_account_id, owner_account_id, amount, expires_at) SELECT id, '{aid1}', owner_account_id, 1000, now() + interval '1 day' FROM listings WHERE id = '{lid}'")
            setting('lpx.offer_gwans', lgw, '1549')
            box = call('GET', f'/lpx/listings/{lid}/offer', None, T1)
            own = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, TO)
            low = call('POST', f'/lpx/listings/{lid}/offers', {'amount': str(max(100, A // 10))}, T1)
            badf = call('POST', f'/lpx/listings/{lid}/offers', {'amount': '12'}, T1)
            o1 = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90, 'memo': '시험 1549 제안 010-1234-5678'}, T1)
            dup = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, T1)
            oid1 = o1.get('id') or '0'
            memo = psql(f"SELECT coalesce(memo, '') FROM lpx_offers WHERE id = {int(oid1)}")
            n_new = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{oid}' AND event_code = 'LPX_OFFER_NEW' AND created_at > now() - interval '10 minutes'")
            ct = call('POST', f'/lpx/offers/{oid1}/counter', {'amount': a99, 'memo': '시험 1549 되제안'}, TO)
            ct2 = call('POST', f'/lpx/offers/{oid1}/counter', {'amount': a99}, TO)
            re1 = call('POST', f'/lpx/offers/{oid1}/reoffer', {'amount': a92, 'memo': '시험 1549 다시 제안'}, T1)
            ct3 = call('POST', f'/lpx/offers/{oid1}/counter', {'amount': a97}, TO)
            re2 = call('POST', f'/lpx/offers/{oid1}/reoffer', {'amount': a93}, T1)
            cnt = psql(f"SELECT counter_count FROM lpx_offers WHERE id = {int(oid1)}")
            lim_db = psql(f"UPDATE lpx_offers SET state = 'OPEN', amount = {a93}, counter_count = 4, expires_at = now() + interval '1 day' WHERE id = {int(oid1)}")
            acc = call('POST', f'/lpx/offers/{oid1}/accept', {}, T1)
            acc2 = call('POST', f'/lpx/offers/{oid1}/accept', {}, T1)
            o2 = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, T2)
            wd = call('POST', f"/lpx/offers/{o2.get('id') or '0'}/withdraw", {}, T2)
            o3 = call('POST', f'/lpx/listings/{lid}/offers', {'amount': a90}, T2)
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; UPDATE lpx_offers SET expires_at = now() - interval '1 minute' WHERE id = {int(o3.get('id') or 0)}; COMMIT;")
            run = call('POST', '/admin/lpx/offers/run', {}, TS)
            st3 = psql(f"SELECT state FROM lpx_offers WHERE id = {int(o3.get('id') or 0)}")
            dele = psql(f"DELETE FROM lpx_offers WHERE id = {int(oid1)}")
            mine_o = call('GET', '/lpx/me/offers', None, TO)
            rrow = next((x for x in (mine_o.get('received') or []) if x.get('id') == oid1), {})
            adm = call('GET', '/admin/lpx/offers', None, TS)
            arow = next((x for x in (adm.get('recent') or []) if x.get('id') == oid1), {})
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'lpx-offers'")
            ok('② 가격 제안 — 꺼짐 409 · 관 꺼짐 422(서버 · DB) · 칸 켜짐(되제안 3번) · 자기 매물 422 · 하한(30%) 422 · 형식 400 · 제안 · 메모 연락처 가림 · 같은 매물 409 · 주인 알림 · 되제안 · 되제안 받은 것에 또 되제안 409 · 다시 제안 · 되제안(3번째) · 넷째 422 LPX_COUNTER_LIMIT(서버 · DB 트리거) · 회원 수락(최종 = 마지막 되제안 · 1:1 문의 안내) · 다시 409 · 거두기 · 만료(작업) · 지우기 막음 · 가린 이름 · 운영 목록에 메모 없음 · 권한 주소 3',
               off.get('_err') == 409 and off.get('code') == 'LPX_OFFER_OFF' and gw.get('_err') == 422 and gw.get('code') == 'LPX_GWAN_OFF' and '!' in gw_db and 'LPX_GWAN_OFF' in gw_db
               and box.get('enabled') is True and box.get('counterMax') == 3 and own.get('_err') == 422 and own.get('code') == 'LPX_OFFER_SELF' and low.get('code') == 'LPX_AMOUNT_LOW' and badf.get('_err') == 400
               and o1.get('state') == 'OPEN' and '010-1234-5678' not in memo and '***' in memo and dup.get('_err') == 409 and dup.get('code') == 'LPX_OFFER_ALREADY' and n_new not in ('', '0')
               and ct.get('state') == 'COUNTERED' and ct.get('counterCount') == 1 and ct2.get('_err') == 409 and re1.get('state') == 'OPEN' and re1.get('counterCount') == 2
               and ct3.get('state') == 'COUNTERED' and ct3.get('counterLeft') == 0 and re2.get('_err') == 422 and re2.get('code') == 'LPX_COUNTER_LIMIT' and cnt == '3'
               and '!' in lim_db and 'LPX_COUNTER_LIMIT' in lim_db and acc.get('state') == 'ACCEPTED' and acc.get('finalAmount') == a97 and (acc.get('next') or {}).get('action') == 'CONVERSATION'
               and acc2.get('_err') == 409 and wd.get('state') == 'WITHDRAWN' and o3.get('state') == 'OPEN' and ((run.get('offers') or {}).get('expired') or 0) >= 1 and st3 == 'EXPIRED'
               and '!' in dele and 'LPX_OFFER' in dele and '*' in str(rrow.get('from') or '') and arow and 'memo' not in arow and rmap == '3',
               f"{off.get('code')} · {gw.get('code')} {gw_db[-30:]} · {box.get('enabled')} · {own.get('code')} {low.get('code')} {badf.get('_err')} · {o1.get('state')} {memo[:20]} {dup.get('code')} {n_new} · "
               f"{ct.get('state')} {ct.get('counterCount')} {ct2.get('code')} · {re1.get('state')} {re1.get('counterCount')} · {ct3.get('state')} {ct3.get('counterLeft')} · {re2.get('code')} {cnt} {lim_db[-40:]} · {acc.get('state')} {acc.get('finalAmount')} {acc.get('next')} {acc2.get('code')} · {wd.get('state')} · {run} {st3} · {dele[-30:]} · {rrow.get('from')} · {sorted(arow)[:4]} · {rmap}")
            if ADMIN_WEB:
                r = admin_page('/#/lpx-offers', lambda pg, seen: seen.update(n=pg.locator('[data-lpx-offers]').count(), s=pg.locator('[data-lpx-offer-switch]').count()))
                if r is not None:
                    seen, perr = r
                    ok('③ 화면 — 검수 › 매물 가격 제안(스위치 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
            if SITE:
                def run_site(b, seen, perr):
                    ps = site_login(b, perr, em1)
                    ps.goto(SITE + '/my/offers', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    seen['my'] = ps.locator('[data-lpx-my-offers]').count()
                r2 = ui(run_site)
                if r2 is not None:
                    seen2, perr2 = r2
                    ok('③ 화면 — 나의공간 › 가격 제안(화면 오류 없음)', seen2.get('my') == 1 and not perr2, f"{seen2} {perr2[:2]}")
        finally:
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM notifications WHERE event_code LIKE 'LPX\\_%' AND (account_id IN ('{aid1}', '{aid2}') OR (account_id = '{oid}' AND created_at > now() - interval '30 minutes')); COMMIT;")
            psql(clean)
            for k, v in olds.items():
                setting(k, v or {'lpx.offer': 'off', 'lpx.offer_gwans': 'NONE', 'lpx.offer_min_pct': '30', 'lpx.offer_counter_max': '3'}[k], '1549 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
