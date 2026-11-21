"""v10.542 (docs/680) 매물 방문 예약 — 대표 11/20 「(54) ① 매물 방문 예약」
  ① (코드) D284 vsx_slots · vsx_bookings(겹침 · 자기 매물 · 상태 한 방향 · 지우기 막음 · 닫으면 취소) · vsx.enabled off · 관별 vsx.gwans NONE(트리거 fn_vsx_gwan_on · 서버 정규식 = 값 무늬) · 노쇼 횟수는 운영만 · 정기 작업 vsx_visit · 서버 · 메뉴 vsx-visits · 화면 VSX-010 · MYP-VSX-010 · 매물 상세 칸 · 사전 · 문서 680
  ② (API · DB) 꺼짐 409 · 관 꺼짐 422 VSX_GWAN_OFF(서버 · DB 트리거) · 주인 칸 열기(겹침 건너뜀) · 회원 요청 · 같은 칸 409 · 같은 매물 409 · 자기 매물 422 · 주인 보기에 노쇼 칸 없음 · 주인 확정 · 알림 · 전날 알림(작업) · 이른 노쇼 422 · 회원 취소 · 칸 닫기 · 기록 지우기 막음 · 권한 주소
  ③ (화면) 검수 › 매물 방문 예약 · 나의공간 › 방문 예약(SITE 있을 때)
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


M84 = migr('D284_')
CT, ST = rd('src/modules/vsx/vsx.controller.ts'), rd('src/modules/vsx/vsx-settings.ts')
UI, MN, AP = rd('web/src/app/admin/Vsx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
KOJ = rd('site/src/i18n/messages/ko/vsx.json')
ENJ = rd('site/src/i18n/messages/en/vsx.json')

VS = rd('src/modules/vsx/visits.ts')
VB, VV, VP = rd('site/src/components/vsx/VisitBook.tsx'), rd('site/src/components/vsx/VisitsView.tsx'), rd('site/src/app/my/visits/page.tsx')
DT = rd('site/src/app/[gwan]/[id]/page.tsx')

ok('① 코드 — D284 vsx_slots · vsx_bookings(겹침 VSX_SLOT_OVERLAP · 자기 매물 VSX_BOOKING_SELF · 칸 하나 예약 하나 · 7일 안 표시 · 지우기 막음 · 닫으면 취소) · vsx.enabled off · vsx_visit 매시간 · 서버 회원 · 주인 · 운영 · 메뉴 vsx-visits · 화면 VSX-010 · MYP-VSX-010 · 매물 상세 VisitBook · 사전 ko · en · 문서 680 · 판 v10.542',
   'CREATE TABLE IF NOT EXISTS public.vsx_slots' in M84 and 'CREATE TABLE IF NOT EXISTS public.vsx_bookings' in M84 and 'VSX_SLOT_OVERLAP' in M84 and 'VSX_BOOKING_SELF' in M84
   and 'ux_vsx_booking_live' in M84 and "interval '7 days'" in M84 and 'trg_vsx_slot_close_cascade' in M84 and "('vsx.enabled', 'off'" in M84 and "('vsx_visit', 60," in M84
   and "('vsx-visits', '매물 방문 예약', 'admrev'" in M84 and 'export async function bookVisit' in VS and 'export async function vsxVisitJob' in VS and 'maskName(name)' in VS
   and "@Controller('api/v1/vsx')" in CT and "@Post('owner/listings/:id/slots')" in CT and "@Post('bookings/:id/mark')" in CT and 'export function VsxVisits' in UI
   and "['vsx-visits', '매물 방문 예약']" in MN and "{tab === 'vsx-visits' && <VsxVisits />}" in AP and '/api/v1/vsx/listings/' in VB and '/api/v1/vsx/me' in VV
   and 'data-screen="SB-MYP-VSX-010"' in VP and '<VisitBook listingId={item.id}' in DT and '"SB-ADM-VSX-010"' in SJ and '"SB-MYP-VSX-010"' in SJ
   and '"confirmClose"' in KOJ and '"confirmClose"' in ENJ and 'plural' in ENJ and '노쇼' in doc('680_') and VT >= (10, 542), VER)

ok('① 코드 — 관별 설정(대표 11/21) vsx.gwans NONE · 값 무늬 = 서버 VSX_GWANS_RE · 트리거 fn_vsx_gwan_on(칸 · 예약) · 422 VSX_GWAN_OFF · 운영 관별 스위치 · 노쇼 횟수는 운영 화면에서만(회원 API · 화면 · 사전에 없음) · 문서 법무 확인 끝',
   "('vsx.gwans', 'NONE'" in M84 and "'^(NONE|[A-Z][A-Z0-9_]{1,19}(,[A-Z][A-Z0-9_]{1,19}){0,29})$'" in M84 and 'FUNCTION public.fn_vsx_gwan_on(p_gwan text)' in M84
   and M84.count('public.fn_vsx_gwan_on(v_gwan)') == 2 and "VSX_GWANS_RE = /^(NONE|[A-Z][A-Z0-9_]{1,19}(,[A-Z][A-Z0-9_]{1,19}){0,29})$/" in ST
   and "'VSX_GWAN_OFF'" in VS and 'visitGwans' in CT and 'function GwanBox' in UI and 'noshow180' in UI and 'noshow180' in VS.split('adminVisits', 1)[-1]
   and 'noshow180' not in VS.split('adminVisits', 1)[0] and 'noshow180' not in VV and '"noshow"' not in KOJ and '"noshow"' not in ENJ and '법무 확인 끝(11/21 대표)' in doc('680_'), '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    old_on = getset('vsx.enabled')
    row = psql("SELECT l.id || '|' || a.email FROM listings l JOIN accounts a ON a.id = l.owner_account_id WHERE l.status = 'PUBLISHED' AND a.email LIKE '%@x.com' AND a.status = 'ACTIVE' ORDER BY l.published_at DESC NULLS LAST LIMIT 1")
    if '|' not in row or '!' in row:
        print('  (게시 중 시험 매물이 없음 — ② 건너뜀)')
    else:
        lid, oem = row.split('|', 1)
        lgw = psql(f"SELECT gwan_code FROM listings WHERE id = '{lid}'")
        old_gw = getset('vsx.gwans')
        clean = (f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM vsx_bookings WHERE listing_id = '{lid}'; DELETE FROM vsx_slots WHERE listing_id = '{lid}'; COMMIT;")
        psql(clean)
        consent_ok.agree(oem, PW)
        TO = login(oem)
        em1, aid1 = mk_staff('1542a', role=None); consent_ok.agree(em1, PW); T1 = login(em1)
        em2, aid2 = mk_staff('1542b', role=None); consent_ok.agree(em2, PW); T2 = login(em2)
        day = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 2, 'YYYY-MM-DD')")
        try:
            setting('vsx.enabled', 'off', '1542')
            off_get = call('GET', f'/vsx/listings/{lid}/slots', None, T1)
            off_open = call('POST', f'/vsx/owner/listings/{lid}/slots', {'date': day, 'times': ['10:00'], 'minutes': 30}, TO)
            setting('vsx.enabled', 'on', '1542')
            setting('vsx.gwans', 'NONE', '1542')
            gw_off = call('POST', f'/vsx/owner/listings/{lid}/slots', {'date': day, 'times': ['10:00'], 'minutes': 30}, TO)
            gw_db = psql(f"INSERT INTO vsx_slots (listing_id, owner_account_id, starts_at, ends_at) SELECT id, owner_account_id, now() + interval '3 days', now() + interval '3 days 30 minutes' FROM listings WHERE id = '{lid}'")
            gw_get = call('GET', f'/vsx/listings/{lid}/slots', None, T1)
            setting('vsx.gwans', lgw, '1542')
            op = call('POST', f'/vsx/owner/listings/{lid}/slots', {'date': day, 'times': ['10:00', '10:20'], 'minutes': 30}, TO)
            bad_t = call('POST', f'/vsx/owner/listings/{lid}/slots', {'date': day, 'times': ['10:05'], 'minutes': 30}, TO)
            sl = call('GET', f'/vsx/listings/{lid}/slots', None, T1)
            sid = ((sl.get('slots') or [{}])[0]).get('id')
            own = call('POST', f'/vsx/listings/{lid}/book', {'slotId': sid or '0'}, TO)
            b1 = call('POST', f'/vsx/listings/{lid}/book', {'slotId': sid or '0', 'memo': '시험 1542 방문'}, T1)
            b2 = call('POST', f'/vsx/listings/{lid}/book', {'slotId': sid or '0'}, T2)
            b1b = call('POST', f'/vsx/listings/{lid}/book', {'slotId': sid or '0'}, T1)
            bid = b1.get('id')
            mine_o = call('GET', '/vsx/me', None, TO)
            orow = next((x for x in (mine_o.get('asOwner') or []) if x.get('id') == bid), {})
            cf = call('POST', f'/vsx/bookings/{bid}/confirm', {}, TO)
            n_cf = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid1}' AND event_code = 'VSX_BOOK_CONFIRMED'")
            # 전날 알림 — 칸을 내일 12:00 으로 옮겨(replica) 작업을 한 번
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; UPDATE vsx_slots SET starts_at = (((now() AT TIME ZONE 'Asia/Seoul')::date + 1) + time '12:00') AT TIME ZONE 'Asia/Seoul', "
                 f"ends_at = (((now() AT TIME ZONE 'Asia/Seoul')::date + 1) + time '12:30') AT TIME ZONE 'Asia/Seoul' WHERE id = {int(sid or 0)}; COMMIT;")
            run = call('POST', '/admin/vsx/visits/run', {}, TS)
            hour = int(psql("SELECT EXTRACT(hour FROM now() AT TIME ZONE 'Asia/Seoul')::int") or 0)
            rem = psql(f"SELECT (reminded_at IS NOT NULL) FROM vsx_bookings WHERE id = {int(bid or 0)}")
            early = call('POST', f'/vsx/bookings/{bid}/mark', {'result': 'NOSHOW'}, TO)
            cc = call('POST', f'/vsx/bookings/{bid}/cancel', {'reason': '시험 1542 취소'}, T1)
            n_cc = psql(f"SELECT count(*) FROM notifications WHERE account_id = (SELECT owner_account_id FROM listings WHERE id = '{lid}') AND event_code = 'VSX_BOOK_CANCELLED' AND created_at > now() - interval '10 minutes'")
            cl = call('POST', f'/vsx/owner/slots/{sid}/close', {}, TO)
            st = psql(f"SELECT state FROM vsx_slots WHERE id = {int(sid or 0)}")
            dele = psql(f"DELETE FROM vsx_bookings WHERE id = {int(bid or 0)}")
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'vsx-visits'")
            ok('② 방문 예약 — 꺼짐(빈 목록 · 409 VSX_OFF) · 관 꺼짐(422 VSX_GWAN_OFF · DB 트리거도 · 빈 목록) · 주인 보기에 노쇼 칸 없음 · 칸 열기 1 · 겹침 건너뜀 1 · 10분 단위 아님 400 · 자기 매물 422 · 요청 · 같은 칸 409 VSX_SLOT_TAKEN · 같은 매물 409 VSX_ALREADY · 주인 보기 가린 이름 · 확정 · 알림 · 전날 알림(10시 뒤) · 이른 노쇼 422 · 회원 취소 · 주인 알림 · 칸 닫기 · 지우기 막음 · 권한 주소 2',
               off_get.get('enabled') is False and off_open.get('code') == 'VSX_OFF' and gw_off.get('_err') == 422 and gw_off.get('code') == 'VSX_GWAN_OFF'
               and '!' in gw_db and 'VSX_GWAN_OFF' in gw_db and gw_get.get('enabled') is False and 'noshow180' not in orow and op.get('made') == 1 and len(op.get('skipped') or []) == 1
               and bad_t.get('_err') == 400 and own.get('_err') == 422 and own.get('code') == 'VSX_BOOKING_SELF' and b1.get('state') == 'REQUESTED'
               and b2.get('_err') == 409 and b2.get('code') == 'VSX_SLOT_TAKEN' and b1b.get('code') == 'VSX_ALREADY'
               and '*' in str(orow.get('visitor') or '') and orow.get('canConfirm') is True and cf.get('state') == 'CONFIRMED' and n_cf == '1'
               and run.get('on') is True and (rem == 't' if hour >= 10 else True) and early.get('_err') == 422 and early.get('code') == 'VSX_BOOKING_EARLY'
               and cc.get('state') == 'CANCELLED' and n_cc not in ('', '0') and cl.get('ok') is True and st == 'CLOSED' and '!' in dele and 'VSX_BOOKING' in dele and rmap == '2',
               f"{off_get.get('enabled')} {off_open.get('code')} · 관 {gw_off.get('code')} {gw_db[-30:]} {gw_get.get('enabled')} · {op.get('made')} {op.get('skipped')} · {bad_t.get('_err')} · {own.get('code')} · {b1.get('state')} {b2.get('code')} {b1b.get('code')} · "
               f"{orow.get('visitor')} {orow.get('canConfirm')} · {cf.get('state')} {n_cf} · {run} h{hour} {rem} · {early.get('code')} · {cc.get('state')} {n_cc} · {cl.get('ok')} {st} · {dele[-40:]} · {rmap}")
            if ADMIN_WEB:
                r = admin_page('/#/vsx-visits', lambda pg, seen: seen.update(n=pg.locator('[data-vsx-visits]').count(), s=pg.locator('[data-vsx-visit-switch]').count()))
                if r is not None:
                    seen, perr = r
                    ok('③ 화면 — 검수 › 매물 방문 예약(스위치 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
            if SITE:
                def run_site(b, seen, perr):
                    ps = site_login(b, perr, em1)
                    ps.goto(SITE + '/my/visits', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    seen['my'] = ps.locator('[data-vsx-my]').count()
                r2 = ui(run_site)
                if r2 is not None:
                    seen2, perr2 = r2
                    ok('③ 화면 — 나의공간 › 방문 예약(화면 오류 없음)', seen2.get('my') == 1 and not perr2, f"{seen2} {perr2[:2]}")
        finally:
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM notifications WHERE event_code LIKE 'VSX\\_%' AND (account_id IN ('{aid1}', '{aid2}') OR (account_id = (SELECT owner_account_id FROM listings WHERE id = '{lid}') AND created_at > now() - interval '30 minutes')); COMMIT;")
            psql(clean)
            setting('vsx.enabled', old_on or 'off', '1542 되돌림')
            setting('vsx.gwans', old_gw or 'NONE', '1542 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
