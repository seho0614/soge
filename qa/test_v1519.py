"""v10.519 (D277 · docs/657) 광고 성과 보고서 — 대표 11/20 ㊼ ③
  ① (코드) D277 prx_ad_owner · prx_ad_reports(기간 열쇠 하루 · 주 · 달 · 숫자만 · 보낸 것 숫자 · 보낸 표시 못 바꿈 · 못 지움) · 설정 prx.ad_report_mail off · prx.ad_report_cycle MONTHLY(대표 11/20) · 정기 작업 prx_ad_report 08:10 · 서비스(ad_events · ad_invoices 읽기만) · 인쇄 printDoc · 메뉴 · 화면 PRX-030 · 문서 657
  ② (API · DB) 시험 광고주 · 소재 · 지난달 노출 3 · 클릭 1 · 한 달 청구 → 달 보고서 숫자 · 회원 칸 없음 · 하루 보고서(날수 나눔) · 주 열쇠는 월요일만 · 주기 바꾸기(SUPER · ADMIN 403) · 메일 꺼짐 409 · 켜면 주소 없음(ok:false) · 보낸 것은 다시 만들어도 그대로 · 보낸 표시 못 되돌림 · 소재 → 광고주 잇기 · 정리
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
AR, UI = rd('src/modules/prx/adreport.ts'), rd('web/src/app/admin/Prx.tsx')
ok('① 코드 — 보고서 표(기간 열쇠) · 잇기 표 · 보낸 것 가드 · 메일 off · 주기 MONTHLY · 지난 기간 · 기간 열쇠 함수 · 정기 작업 08:10 · ad_events · ad_invoices 읽기만(INSERT 없음) · 인쇄 openPrint · 메뉴 prx-adreport · 화면 PRX-030 · 문서 657 · 판 v10.519',
   'CREATE TABLE IF NOT EXISTS public.prx_ad_reports' in M77 and 'CREATE TABLE IF NOT EXISTS public.prx_ad_owner' in M77 and 'trg_prx_ad_report_guard' in M77
   and "('prx.ad_report_mail', 'off'" in M77 and "('prx.ad_report_cycle', 'MONTHLY'" in M77 and 'UNIQUE (advertiser_id, period_key)' in M77 and "('prx_ad_report', 1440, 8, 10" in M77
   and 'export function lastPeriodKey' in AR and 'export function parsePeriod' in AR and 'FROM ad_events e' in AR and 'FROM ad_invoices i' in AR
   and not re.search(r'INSERT INTO ad_(events|invoices)', AR) and 'openPrint({' in UI and "case 'prx_ad_report':" in SCH and "'prx_ad_report'," in WK
   and "['prx-adreport', '광고 성과 보고서']" in MN and '"SB-ADM-PRX-030"' in SJ and '새 추적' in doc('657_') and VT >= (10, 519), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sw0, cy0 = getset('prx.ad_report_mail'), getset('prx.ad_report_cycle')
    first = (NOW + datetime.timedelta(hours=9)).replace(day=1)
    prev = first - datetime.timedelta(days=1)
    ym = prev.strftime('%Y-%m')
    d0, d1 = prev.replace(day=1).strftime('%Y-%m-%d'), prev.strftime('%Y-%m-%d')
    code, name = f'T1519{STAMP}', f'시험광고주1519-{STAMP}'
    slot = psql("SELECT code FROM ad_slots WHERE is_active ORDER BY code LIMIT 1")
    adv = cid = asf = ''
    try:
        adv = psql(f"INSERT INTO advertisers (code, name) VALUES ('{code}', '{name}') RETURNING id").split('\n')[0]
        cid = psql(f"INSERT INTO ad_placements (slot_code, creative_code, advertiser, title, status) VALUES ('{slot}', '{code}-A', '{name}', '시험 소재', 'DRAFT') RETURNING id").split('\n')[0]
        mid = f"('{d0}'::date + 10)::timestamp AT TIME ZONE 'Asia/Seoul'"
        psql(f"INSERT INTO ad_events (creative_id, slot_code, event_type, occurred_at) SELECT '{cid}', '{slot}', t, {mid} FROM unnest(ARRAY['IMPRESSION','IMPRESSION','IMPRESSION','CLICK']) t")
        psql(f"INSERT INTO ad_events (creative_id, slot_code, event_type, occurred_at) VALUES ('{cid}', '{slot}', 'IMPRESSION', now())")   # 이번 달 — 지난달 보고서에 안 들어가야 함
        psql(f"INSERT INTO ad_invoices (invoice_no, advertiser_id, period_from, period_to, amount, vat, total, due_date) VALUES (fn_next_ad_invoice_no(), '{adv}', '{d0}', '{d1}', 300000, 30000, 330000, '{d1}')")
        mk = call('POST', '/admin/prx/ad-reports/make', {'period': ym, 'advertiserId': adv}, TS)
        ls = call('GET', f'/admin/prx/ad-reports?period={ym}', None, TS)
        row = next((x for x in ls.get('items') or [] if x.get('advertiserId') == adv), {})
        rid = str(row.get('id') or '')
        dt = call('GET', f'/admin/prx/ad-reports/{rid}', None, TS)
        cols = psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'prx_ad_reports' AND column_name ~ 'account|member|email|phone|segment'")
        ok('② 숫자 — 지난달 노출 3 · 클릭 1(이번 달 노출 뺌) · 클릭률 33.33 · 광고비 300,000 · 부가세 포함 330,000 · 클릭당 300,000 · 소재 줄 1 · 메일 글에 숫자 · 보고서 표에 회원 칸 없음',
           mk.get('made') == 1 and int(row.get('impressions') or 0) == 3 and int(row.get('clicks') or 0) == 1 and row.get('ctr') == 33.33
           and int(row.get('cost') or 0) == 300000 and int(row.get('costTotal') or 0) == 330000 and row.get('cpc') == 300000
           and len(dt.get('lines') or []) == 1 and '노출 3회' in (dt.get('mailText') or '') and cols == '0', f'{mk} {row} {cols}')
        day = (prev.replace(day=1) + datetime.timedelta(days=10)).strftime('%Y-%m-%d')
        ndays = prev.day
        es, asf = mk_staff('1519s', 'ADMIN')
        TA = login(es)
        ca = call('PUT', '/admin/prx/ad-reports/switch', {'cycle': 'DAILY', 'reason': '시험 1519'}, TA)
        cy = call('PUT', '/admin/prx/ad-reports/switch', {'cycle': 'DAILY', 'reason': '시험 1519'}, TS)
        lsd = call('GET', '/admin/prx/ad-reports', None, TS)
        md = call('POST', '/admin/prx/ad-reports/make', {'period': day, 'advertiserId': adv}, TS)
        lsday = call('GET', f'/admin/prx/ad-reports?period={day}', None, TS)
        rday = next((x for x in lsday.get('items') or [] if x.get('advertiserId') == adv), {})
        bad_w = call('POST', '/admin/prx/ad-reports/make', {'period': 'W' + day if datetime.date.fromisoformat(day).isoweekday() != 1 else 'W' + (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat(), 'advertiserId': adv}, TS)
        mon = datetime.date.fromisoformat(day) - datetime.timedelta(days=datetime.date.fromisoformat(day).isoweekday() - 1)
        mw = call('POST', '/admin/prx/ad-reports/make', {'period': f'W{mon.isoformat()}', 'advertiserId': adv}, TS)
        wrow = psql(f"SELECT cycle || '|' || period_from || '|' || period_to FROM prx_ad_reports WHERE advertiser_id = '{adv}' AND period_key = 'W{mon.isoformat()}'")
        dupk = psql(f"INSERT INTO prx_ad_reports (advertiser_id, cycle, period_key, period_from, period_to) VALUES ('{adv}', 'DAILY', '{day}', '{day}', '{day}')")
        badk = psql(f"INSERT INTO prx_ad_reports (advertiser_id, cycle, period_key, period_from, period_to) VALUES ('{adv}', 'WEEKLY', 'W{(mon + datetime.timedelta(days=1)).isoformat()}', '{(mon + datetime.timedelta(days=1)).isoformat()}', '{(mon + datetime.timedelta(days=7)).isoformat()}')")
        setting('prx.ad_report_cycle', cy0 or 'MONTHLY', '1519')
        ok('② 주기 · 기간 — 주기 바꾸기 ADMIN 403 · SUPER 됨(DAILY) · 목록 처음 기간 = 어제 · 하루 보고서 노출 3 · 클릭 1 · 광고비 = 300,000 ÷ 그 달 날수 · 주 열쇠 월요일 아니면 422 · 주 보고서(월 ~ 일) · 같은 기간 두 줄 DB 막음 · 월요일 아닌 주 열쇠 DB 막음',
           ca.get('_err') == 403 and cy.get('cycle') == 'DAILY' and lsd.get('cycle') == 'DAILY' and lsd.get('period') == ((NOW + datetime.timedelta(hours=9)).date() - datetime.timedelta(days=1)).isoformat()
           and md.get('made') == 1 and int(rday.get('impressions') or 0) == 3 and int(rday.get('clicks') or 0) == 1 and int(rday.get('cost') or 0) == round(300000 / ndays)
           and bad_w.get('_err') == 422 and bad_w.get('code') == 'PRX_PERIOD' and mw.get('made') == 1 and wrow == f"WEEKLY|{mon.isoformat()}|{(mon + datetime.timedelta(days=6)).isoformat()}"
           and '!' in dupk and '!' in badk, f'{ca.get("_err")} {cy} {lsd.get("period")} {md} {rday} {bad_w} {mw} {wrow} {dupk[-40:]} {badk[-40:]}')
        setting('prx.ad_report_mail', 'off', '1519')
        s0 = call('POST', f'/admin/prx/ad-reports/{rid}/send', None, TS)
        sw = call('PUT', '/admin/prx/ad-reports/switch', {'on': True, 'reason': '시험 1519'}, TS)
        s1 = call('POST', f'/admin/prx/ad-reports/{rid}/send', None, TS)
        setting('prx.ad_report_mail', sw0 or 'off', '1519')
        psql(f"UPDATE prx_ad_reports SET mail_state = 'SENT', mailed_at = now() WHERE id = {int(rid or 0)}")
        psql(f"INSERT INTO ad_events (creative_id, slot_code, event_type, occurred_at) VALUES ('{cid}', '{slot}', 'CLICK', {mid})")
        mk2 = call('POST', '/admin/prx/ad-reports/make', {'period': ym, 'advertiserId': adv}, TS)
        keep = psql(f"SELECT clicks FROM prx_ad_reports WHERE id = {int(rid or 0)}")
        g = psql(f"UPDATE prx_ad_reports SET clicks = 9 WHERE id = {int(rid or 0)}")
        dl = psql(f"DELETE FROM prx_ad_reports WHERE id = {int(rid or 0)}")
        unsent = psql(f"UPDATE prx_ad_reports SET mail_state = NULL WHERE id = {int(rid or 0)}")
        s2 = call('POST', f'/admin/prx/ad-reports/{rid}/send', None, TS)
        own = call('PUT', f'/admin/prx/ad-owners/{cid}', {'advertiserId': adv}, TS)
        linked = psql(f"SELECT count(*) FROM prx_ad_owner WHERE creative_id = '{cid}' AND advertiser_id = '{adv}'")
        un = call('PUT', f'/admin/prx/ad-owners/{cid}', {'advertiserId': ''}, TS)
        ok('② 메일 · 고정 — 꺼짐 409 PRX_MAIL_OFF · 켜면 주소 없음 ok:false(NO_ADDRESS) · 보낸 것은 다시 만들어도 클릭 1 그대로 · DB 가 숫자 바꾸기 · 지우기 · 보낸 표시 되돌리기 막음(같은 기간 두 번 안 보냄) · 다시 보내기 409 · 소재 → 광고주 잇기 · 끊기',
           s0.get('_err') == 409 and s0.get('code') == 'PRX_MAIL_OFF' and sw.get('mailOn') is True and s1.get('ok') is False and s1.get('result') == 'NO_ADDRESS'
           and mk2.get('made') == 0 and keep == '1' and '!' in g and '!' in dl and '!' in unsent and s2.get('_err') == 409 and own.get('ok') is True and linked == '1' and un.get('ok') is True,
           f'{s0} {s1} {mk2} {keep} {g[-50:]} {s2} {linked}')
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM prx_ad_reports WHERE advertiser_id::text = '{adv or '-'}'; DELETE FROM prx_ad_owner WHERE creative_id::text = '{cid or '-'}'; "
             f"DELETE FROM ad_events WHERE creative_id::text = '{cid or '-'}'; DELETE FROM ad_invoices WHERE advertiser_id::text = '{adv or '-'}'; "
             f"DELETE FROM ad_placements WHERE id::text = '{cid or '-'}'; DELETE FROM advertisers WHERE id::text = '{adv or '-'}';")
        setting('prx.ad_report_mail', sw0 or 'off', '1519 되돌림')
        setting('prx.ad_report_cycle', cy0 or 'MONTHLY', '1519 되돌림')
        if asf:
            rm_role(asf, '1519')
    ok('정리 — 시험 광고주 · 소재 · 기록 · 청구 · 보고서 남지 않음 · 메일 스위치 · 주기 원래대로',
       psql(f"SELECT count(*) FROM advertisers WHERE code = '{code}'") == '0' and psql(f"SELECT count(*) FROM ad_placements WHERE creative_code = '{code}-A'") == '0'
       and getset('prx.ad_report_mail') == (sw0 or 'off') and getset('prx.ad_report_cycle') == (cy0 or 'MONTHLY'))
    if ADMIN_WEB:
        r = admin_page('/#/prx-adreport', lambda pg, seen: seen.update(n=pg.locator('[data-prx-adreports]').count(), m=pg.locator('[data-prx-mail]').get_attribute('data-prx-mail') if pg.locator('[data-prx-mail]').count() else None, c=pg.locator('[data-prx-cycle]').get_attribute('data-prx-cycle') if pg.locator('[data-prx-cycle]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 광고 › 광고 성과 보고서(메일 · 주기 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('m') in ('on', 'off') and seen.get('c') in ('DAILY', 'WEEKLY', 'MONTHLY') and not perr, f'{seen} {perr[:2]}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
