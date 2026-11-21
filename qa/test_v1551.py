"""v10.551 (docs/689) 판매자 자리 비움 — 대표 11/21 「(56) ③ 판매자 자리 비움 모드」
  ① (코드) D286 lpx_away(살아 있는 줄 하나 · 닫기만 · 지우기 막음) · lpx_away_notices(같은 자리 비움 · 같은 회원 한 번) · fn_lpx_away_on(스위치 · 오늘 · 기간) · 자동 안내 fn_lpx_away_autonotice(오류 삼킴) · 트리거 1:1 문의 · 공개 질문 · 방문 예약(vsx_bookings 있을 때만) · lpx.away off · 매물 상세 띠 · 나의공간 · 메뉴 lpx-away · 화면 LPX-030 · MYP-LPX-020 · 문서 689
  ② (API · DB) 꺼짐 409 · 켜기(안내 연락처 가림) · 공개 표시 · 1:1 문의 첫 줄에 자동 안내 한 번 · 공개 질문은 같은 회원이면 더 안 감 · 다른 회원 질문 한 번 · 지난 날짜 422 · 너무 김 422 · 끝내기 · 표시 사라짐 · 다시 끝내기 409 · 지우기 막음 · 정리 작업 · 권한 주소
  ③ (화면) 검수 › 판매자 자리 비움 · 나의공간 › 자리 비움(SITE 있을 때)
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

AW, AN, AV, APG = rd('src/modules/lpx/away.ts'), rd('site/src/components/lpx/LpxAwayNote.tsx'), rd('site/src/components/lpx/AwayView.tsx'), rd('site/src/app/my/away/page.tsx')

ok('① 코드 — D286 lpx_away · lpx_away_notices(기본 키 한 번) · fn_lpx_away_on · 자동 안내(오류 삼킴) · 트리거 문의 · 질문 · 방문 예약(표 있을 때만) · lpx.away off · 최대 일수 · 끝나면 ENDED · 서버 · 매물 상세 띠 · 나의공간 · 메뉴 lpx-away · 화면 LPX-030 · MYP-LPX-020 · 문서 689 · 판 v10.551',
   'CREATE TABLE IF NOT EXISTS public.lpx_away (' in M86 and 'CREATE TABLE IF NOT EXISTS public.lpx_away_notices' in M86 and 'PRIMARY KEY (away_id, account_id)' in M86
   and 'ux_lpx_away_live' in M86 and 'FUNCTION public.fn_lpx_away_on(p_account uuid)' in M86 and 'FUNCTION public.fn_lpx_away_autonotice(' in M86 and 'EXCEPTION WHEN OTHERS THEN' in M86
   and 'trg_lpx_away_on_conversation AFTER INSERT ON public.conversations' in M86 and 'trg_lpx_away_on_question AFTER INSERT ON public.public_questions' in M86
   and "to_regclass('public.vsx_bookings')" in M86 and "('lpx.away', 'off'" in M86 and "('lpx.away_max_days', '30'" in M86 and "'LPX_AWAY_AUTO'" in M86
   and 'export async function setAway' in AW and 'export async function awayEndJob' in AW and "state = 'ENDED'" in AW and '<LpxAwayNote listingId={item.id}' in DT
   and "getTranslations('lpx.away')" in AN and '/api/v1/lpx/me/away' in AV and 'data-screen="SB-MYP-LPX-020"' in APG and "@Put('lpx/me/away')" in CT
   and 'export function LpxAway' in UI and "['lpx-away', '판매자 자리 비움']" in MN and "{tab === 'lpx-away' && <LpxAway />}" in AP
   and '"SB-ADM-LPX-030"' in SJ and '"SB-MYP-LPX-020"' in SJ and '"nowShowing"' in KOJ and '"nowShowing"' in ENJ and '저절로' in doc('689_') and VT >= (10, 551), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    row = pub_listing()
    if not row:
        print('  (게시 중 시험 매물이 없음 — ② 건너뜀)')
    else:
        lid, oem, lgw, ask, oid = row.split('|')
        old_on, old_max = getset('lpx.away'), getset('lpx.away_max_days')
        t0 = psql("SELECT now()::text")
        clean = (f"BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM lpx_away_notices WHERE away_id IN (SELECT id FROM lpx_away WHERE account_id = '{oid}' AND (created_at >= '{t0}' OR message LIKE '시험 1551%')); "
                 f"DELETE FROM lpx_away WHERE account_id = '{oid}' AND (created_at >= '{t0}' OR message LIKE '시험 1551%'); COMMIT;")
        psql(clean)
        consent_ok.agree(oem, PW)
        TO = login(oem)
        em1, aid1 = mk_staff('1551a', role=None); consent_ok.agree(em1, PW); T1 = login(em1)
        em2, aid2 = mk_staff('1551b', role=None); consent_ok.agree(em2, PW); T2 = login(em2)
        d0 = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')")
        d3 = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 3, 'YYYY-MM-DD')")
        dm1 = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 1, 'YYYY-MM-DD')")
        d60 = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 60, 'YYYY-MM-DD')")
        try:
            setting('lpx.away', 'off', '1551')
            off = call('PUT', '/lpx/me/away', {'startsOn': d0, 'endsOn': d3}, TO)
            setting('lpx.away', 'on', '1551'); setting('lpx.away_max_days', '30', '1551')
            on = call('PUT', '/lpx/me/away', {'startsOn': d0, 'endsOn': d3, 'message': '시험 1551 출장 010-1234-5678'}, TO)
            ex = call('GET', f'/site/lpx/listings/{lid}')
            cv = call('POST', '/conversations', {'targetType': 'LISTING', 'targetId': lid, 'message': '시험 1551 문의'}, T1)
            q1 = call('POST', f'/listings/{lid}/questions', {'question': '시험 1551 질문 하나'}, T1)
            n1 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid1}' AND event_code = 'LPX_AWAY_AUTO'")
            v1 = psql(f"SELECT coalesce(string_agg(via, ','), '') FROM lpx_away_notices WHERE account_id = '{aid1}'")
            q2 = call('POST', f'/listings/{lid}/questions', {'question': '시험 1551 질문 둘'}, T2)
            v2 = psql(f"SELECT coalesce(string_agg(via, ','), '') FROM lpx_away_notices WHERE account_id = '{aid2}'")
            past = call('PUT', '/lpx/me/away', {'startsOn': dm1, 'endsOn': d3}, TO)
            long_ = call('PUT', '/lpx/me/away', {'startsOn': d0, 'endsOn': d60}, TO)
            mine = call('GET', '/lpx/me/away', None, TO)
            dele = psql(f"DELETE FROM lpx_away WHERE id = {int(on.get('id') or 0)}")
            end = call('POST', '/lpx/me/away/end', {}, TO)
            ex2 = call('GET', f'/site/lpx/listings/{lid}')
            end2 = call('POST', '/lpx/me/away/end', {}, TO)
            run = call('POST', '/admin/lpx/offers/run', {}, TS)
            adm = call('GET', '/admin/lpx/away', None, TS)
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'lpx-away'")
            cur = mine.get('current') or {}
            ok('② 자리 비움 — 꺼짐 409 · 켜기 · 안내 연락처 가림 · 공개 표시 · 1:1 문의 첫 줄에 안내 한 번(질문은 더 안 감) · 다른 회원 질문 한 번 · 지난 날짜 422 · 너무 김 422 · 보이는 중 · 지우기 막음 · 끝내기 · 표시 사라짐 · 다시 409 · 정리 작업 · 운영 목록 · 권한 주소 2',
               off.get('_err') == 409 and off.get('code') == 'LPX_AWAY_OFF' and on.get('ok') is True and '010-1234-5678' not in str(on.get('message')) and '***' in str(on.get('message'))
               and (ex.get('away') or {}).get('endsOn') == d3 and cv.get('conversationId') and q1.get('id') and n1 == '1' and v1 == 'CONVERSATION' and q2.get('id') and v2 == 'QUESTION'
               and past.get('_err') == 422 and past.get('code') == 'LPX_AWAY_DATE' and long_.get('_err') == 422 and long_.get('code') == 'LPX_AWAY_LONG'
               and cur.get('showing') is True and cur.get('notices') == 2 and '!' in dele and 'LPX_AWAY' in dele and end.get('ok') is True and ex2.get('away') is None
               and end2.get('_err') == 409 and end2.get('code') == 'LPX_AWAY_NONE' and isinstance((run.get('away') or {}).get('ended'), int) and 'summary' in adm and rmap == '2',
               f"{off.get('code')} · {on.get('ok')} {on.get('message')} · {ex.get('away')} · {cv.get('conversationId')} {q1.get('id')} {n1} {v1} · {q2.get('id')} {v2} · {past.get('code')} {long_.get('code')} · "
               f"{cur.get('showing')} {cur.get('notices')} · {dele[-30:]} · {end.get('ok')} {ex2.get('away')} {end2.get('code')} · {run.get('away')} · {rmap}")
            if ADMIN_WEB:
                r = admin_page('/#/lpx-away', lambda pg, seen: seen.update(n=pg.locator('[data-lpx-away]').count(), s=pg.locator('[data-lpx-away-switch]').count()))
                if r is not None:
                    seen, perr = r
                    ok('③ 화면 — 검수 › 판매자 자리 비움(스위치 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 1 and not perr, f"{seen} {perr[:2]}")
            if SITE:
                def run_site(b, seen, perr):
                    ps = site_login(b, perr, oem)
                    ps.goto(SITE + '/my/away', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    seen['my'] = ps.locator('[data-lpx-my-away]').count()
                r2 = ui(run_site)
                if r2 is not None:
                    seen2, perr2 = r2
                    ok('③ 화면 — 나의공간 › 자리 비움(화면 오류 없음)', seen2.get('my') == 1 and not perr2, f"{seen2} {perr2[:2]}")
        finally:
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
                 f"DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE initiator_id IN ('{aid1}', '{aid2}')); "
                 f"DELETE FROM conversations WHERE initiator_id IN ('{aid1}', '{aid2}'); "
                 f"DELETE FROM public_questions WHERE asker_id IN ('{aid1}', '{aid2}'); "
                 f"DELETE FROM notifications WHERE account_id IN ('{aid1}', '{aid2}') OR (account_id = '{oid}' AND created_at >= '{t0}'); COMMIT;")
            psql(clean)
            setting('lpx.away', old_on or 'off', '1551 되돌림')
            setting('lpx.away_max_days', old_max or '30', '1551 되돌림')
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
