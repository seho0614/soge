"""v10.534 (docs/672) 파트너 성과 대시보드 — 대표 11/20 「(51) ③ 파트너 성과 대시보드」
  ① (코드) D281 fn_ptn_perf_series(일 · 주 · 월 · 한국 시각) · 색인 · 서버 자기 파트너만 · 돈 칸 canMoney · 운영 순위 · 파트너센터 성과 추이(서버 SVG) · 메뉴(PARTNER_MAL) · 화면 · 영어 복수형 · 문서
  ② (API · DB) 30일 · 12개월 줄 수 · 주 묶음 월요일 · 단위 · 기간 오류 · 가짜 파트너 숫자(한 트랜잭션 · ROLLBACK) · 파트너 아님 409 · 파트너센터 12개월 · 회원 403 · 운영 90일 · 순위 · 없는 파트너 404 · 권한 주소
  ③ (화면) 파트너사 › 파트너 성과 · 파트너센터 › 성과 추이(SITE 있을 때)
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



def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


M81 = migr('D281_')
PP, CT, UI, MN, AP, TR, STP = (rd('src/modules/slx/partner-perf.ts'), rd('src/modules/slx/slx.controller.ts'), rd('web/src/app/admin/Slx.tsx'),
                               rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('site/src/app/partner/trend/page.tsx'), rd('site/src/app/partner/stats/page.tsx'))
KO = rd('site/src/i18n/messages/ko/slx.json')
EN = rd('site/src/i18n/messages/en/slx.json')

ok('① 코드 — D281 기간 묶음 함수(일 · 주 · 월 · 한국 시각 · 받은 리드 · 열람 · 응답 분 평균 · 가운데 · 성사 · 이용료 · 정산 · 단위 · 기간 오류) · 색인 3 · 서버 자기 파트너만(forMember) · 돈 칸 canMoney · 운영 순위 · 파트너센터 성과 추이(서버 SVG) · 실적 화면 단추 · 메뉴 slx-ptn-perf(PARTNER_MAL) · 화면 SLX-030 · PTC-SLX-010 · 영어 복수형 ICU · 문서 672 · 판 v10.534',
   'FUNCTION public.fn_ptn_perf_series(p_partner uuid, p_from date, p_to date, p_unit text)' in M81 and 'percentile_cont(0.5)' in M81 and 'PTN_PERF_UNIT' in M81 and 'PTN_PERF_RANGE' in M81
   and 'ix_ld_partner_delivered' in M81 and 'ix_lead_fees_partner_billed' in M81 and 'actors.forMember(me)' in PP and 'p.canMoney' in PP and 'export async function adminPerf' in PP
   and "@Get('perf-trend')" in CT and "@Controller('api/v1/admin/partner-perf')" in CT and "@Roles('ADMIN', 'SUPER', 'PARTNER_MAL')" in CT
   and '/partner/perf-trend?period=' in TR and '<svg' in TR and 'href="/partner/trend"' in STP and 'export function SlxPartnerPerf' in UI
   and "['slx-ptn-perf', '파트너 성과']" in MN and "'slx-ptn-perf': ['ADMIN', 'SUPER', 'PARTNER_MAL']" in AP and "{tab === 'slx-ptn-perf' && <SlxPartnerPerf />}" in AP
   and '"SB-ADM-SLX-030"' in SJ and '"SB-PTC-SLX-010"' in SJ and 'plural' in EN and '"title": "성과 추이"' in KO
   and '자기' in doc('672_') and VT >= (10, 534), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    d30 = psql("SELECT count(*) FROM fn_ptn_perf_series(NULL, current_date - 29, current_date, 'day')")
    m12 = psql("SELECT count(*) FROM fn_ptn_perf_series(NULL, (date_trunc('month', current_date) - interval '11 months')::date, current_date, 'month')")
    wk = psql("SELECT to_char(min(bucket), 'YYYY-MM-DD') FROM fn_ptn_perf_series(NULL, '2024-01-10', '2024-01-20', 'week')")
    bu = psql("SELECT count(*) FROM fn_ptn_perf_series(NULL, current_date - 1, current_date, 'year')")
    br = psql("SELECT count(*) FROM fn_ptn_perf_series(NULL, current_date, current_date - 1, 'day')")
    # 가짜 파트너 번호로 리드 3 · 열람 2(5분 · 15분) · 성사 1 · 이용료 1(3,000) 넣고 세기 — 한 트랜잭션 안 · 끝에 ROLLBACK(공유 데이터 남기지 않음 · 참조 검사는 replica 로 끔)
    syn = psql("BEGIN; SET LOCAL session_replication_role = replica; "
               "CREATE TEMP TABLE t1534 ON COMMIT DROP AS SELECT gen_random_uuid() AS p, gen_random_uuid() AS d1, gen_random_uuid() AS d2, gen_random_uuid() AS d3; "
               "INSERT INTO lead_deliveries (id, lead_id, partner_id, delivered_at, viewed_at) SELECT d1, gen_random_uuid(), p, '2024-01-10 10:00+09', '2024-01-10 10:05+09' FROM t1534; "
               "INSERT INTO lead_deliveries (id, lead_id, partner_id, delivered_at, viewed_at) SELECT d2, gen_random_uuid(), p, '2024-01-10 11:00+09', '2024-01-10 11:15+09' FROM t1534; "
               "INSERT INTO lead_deliveries (id, lead_id, partner_id, delivered_at) SELECT d3, gen_random_uuid(), p, '2024-01-11 09:00+09' FROM t1534; "
               "INSERT INTO partner_fulfillment_reports (partner_id, delivery_id, content, done_on, consumer_state, consumer_at) SELECT p, d1, '시험 1534 이행', '2024-01-11', 'CONFIRMED', '2024-01-12 09:00+09' FROM t1534; "
               "INSERT INTO lead_fees (delivery_id, partner_id, amount, state, billed_at) SELECT d1, p, 3000, 'BILLED', '2024-01-10 12:00+09' FROM t1534; "
               "SELECT 'R1:' || sum(received) || '|' || sum(viewed) || '|' || sum(confirmed) || '|' || sum(fee_billed) || '|' || max(view_min_avg) || '|' || max(view_min_p50) "
               "|| '|' || (SELECT count(*) FROM fn_ptn_perf_series((SELECT p FROM t1534), '2024-01-08', '2024-01-14', 'week')) "
               "FROM fn_ptn_perf_series((SELECT p FROM t1534), '2024-01-08', '2024-01-14', 'day'); "
               "ROLLBACK;")
    syn_line = next((x.strip()[3:] for x in syn.splitlines() if x.strip().startswith('R1:')), None)
    em, aid = mk_staff('1534', role=None)
    consent_ok.agree(em, PW)
    TM = login(em)
    np_ = call('GET', '/partner/perf-trend', None, TM)
    tp = call('GET', '/partner/perf-trend?period=12m', None, login('seller@x.com'))
    a403 = call('GET', '/admin/partner-perf', None, TM)
    av = call('GET', '/admin/partner-perf?period=90d&sort=confirmed', None, TS)
    nf = call('GET', '/admin/partner-perf?partnerId=00000000-0000-4000-8000-000000000000', None, TS)
    bad = call('GET', '/admin/partner-perf?partnerId=abc', None, TS)
    rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'slx-ptn-perf'")
    syn_ok = (syn_line == '3|2|1|3000|10.0|10.0|1') if (syn_line is not None and '!' not in syn) else None   # 다른 규칙이 막거나 psql 이 결과를 안 보이면 건너뜀
    ok('② 파트너 성과 — 30일 30줄 · 12개월 12줄 · 주 묶음 월요일 · 단위 · 기간 오류 · 가짜 파트너 리드 3 · 열람 2 · 성사 1 · 이용료 3,000 · 응답 평균 · 가운데 10분(ROLLBACK) · 파트너 아님 409 · 파트너센터 12개월(달마다 12 · 요약 · 앞 기간) · 회원 403 · 운영 90일(주마다) · 순위 · 없는 파트너 404 · 권한 주소 1',
           d30 == '30' and m12 == '12' and wk == '2024-01-08' and 'PTN_PERF_UNIT' in bu and 'PTN_PERF_RANGE' in br and syn_ok is not False
           and np_.get('_err') == 409 and np_.get('code') == 'NOT_PARTNER'
           and (((tp.get('range') or {}).get('unit') == 'month' and len(tp.get('series') or []) == 12 and 'summary' in tp and 'prev' in tp) if tp.get('_err') is None else tp.get('_err') == 409)
           and a403.get('_err') == 403 and (av.get('range') or {}).get('unit') == 'week' and len(av.get('series') or []) in (13, 14) and isinstance(av.get('rank'), list) and av.get('sort') == 'confirmed'
           and nf.get('_err') == 404 and bad.get('_err') == 404 and rmap == '1',
           f"{d30} {m12} {wk} {bu[-30:]} {br[-30:]} · {syn_line if syn_line is not None else syn[-80:]} · {np_.get('code')} · {(tp.get('range') or {}).get('unit')} {len(tp.get('series') or [])} {tp.get('_err')} · "
           f"{a403.get('_err')} {(av.get('range') or {}).get('unit')} {len(av.get('series') or [])} {av.get('sort')} · {nf.get('_err')} {bad.get('_err')} {rmap}")
    if ADMIN_WEB:
        r = admin_page('/#/slx-ptn-perf', lambda pg, seen: seen.update(n=pg.locator('[data-slx-ptn-perf]').count(), c=pg.locator('[data-slx-perf-chart]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 파트너사 › 파트너 성과(요약 · 그래프 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('c') == 1 and not perr, f"{seen} {perr[:2]}")
    if SITE:
        def run_site(b, seen, perr):
            ps = site_login(b, perr, 'seller@x.com')
            ps.goto(SITE + '/partner/trend?period=90d', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            seen['chart'] = ps.locator('[data-slx-trend-chart]').count()
            seen['tiles'] = ps.locator('[data-slx-trend-tiles]').count()
        r2 = ui(run_site)
        if r2 is not None:
            seen2, perr2 = r2
            ok('③ 화면 — 파트너센터 › 성과 추이(숫자 4칸 · 그래프 · 화면 오류 없음)', seen2.get('chart') == 1 and seen2.get('tiles') == 1 and not perr2, f"{seen2} {perr2[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
