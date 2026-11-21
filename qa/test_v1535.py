"""v10.535 (D282 · docs/673) 통계 내보내기 BI — 대표 11/20 「(52) ①」
  ① (코드) bi 스키마 · 일별 집계(숫자만) · fn_bi_daily_build · 보기 5 · v_bi_pii_columns · 설정 2 · 정기 작업 bi_daily · 내려받기 대상 BI_DAILY · ROLE · GRANT 없음 · 메뉴 · 화면 · 문서 673
  ② (API · DB) 회원 403 · 개인 식별 칸 0 · 다시 셈 422 · 가입 수 = 원본 · 작은 칸 가림 · CSV 승인(번호 한 번) · 권한 주소 5 — 공유 데이터 남기지 않음(시험 줄 · 승인 번호 지움)
  ③ (화면) 통합 현황 › 통계 내보내기(BI)
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


def kst(add=0):
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9) + datetime.timedelta(days=add)).strftime('%Y-%m-%d')


# ① 코드(API 없이도)
SQL = rd('prisma/migrations/D282_bi_export_dashboard_widgets_mobile_scan/migration.sql')
BI, CT, EA = rd('src/modules/dtx/bi.ts'), rd('src/modules/dtx/dtx.controller.ts'), rd('src/modules/admin/export-approval.ts')
MN, APP, W = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/BiExport.tsx')
SC, WK, AM = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
ok('① D282 — bi 스키마 · 일별 집계 표(숫자만) · 다시 셈 함수 · 보기 5 · 개인 식별 칸 감시 · 설정 2 · 정기 작업 bi_daily · 내려받기 대상 BI_DAILY · 역할 · 권한 만들지 않음',
   all(x in SQL for x in ('CREATE SCHEMA IF NOT EXISTS bi;', 'CREATE TABLE IF NOT EXISTS public.bi_daily_metrics', 'CREATE OR REPLACE FUNCTION public.fn_bi_daily_build(p_from date, p_to date)',
       'CREATE OR REPLACE VIEW bi.v_metrics_daily', 'CREATE OR REPLACE VIEW bi.v_metric_catalog', 'CREATE OR REPLACE VIEW bi.v_site_usage_daily', 'CREATE OR REPLACE VIEW bi.v_site_usage_goals',
       'CREATE OR REPLACE VIEW bi.v_build_state', 'CREATE OR REPLACE VIEW public.v_bi_pii_columns', "('bi.min_cell', '3'", "('bi.keep_days', '1100'", "('bi_daily', 1440, 4, 50,", "'''BI_DAILY'''"))
   and not re.search(r'(?im)^\s*(CREATE|ALTER)\s+ROLE\b', SQL) and not re.search(r'(?im)^\s*GRANT\s', SQL) and 'account_id' not in SQL.split('── ② 운영 대시보드')[0], '')
ok('① 서버 정규식 = DB CHECK(나눔 · 지표 · 작은 칸 가림) · 내려받기 승인 · 다시 셈 잠금 409 · 정기 작업 연결',
   "BI_DIM_RE = /^[A-Za-z0-9_.:/-]{0,40}$/" in BI and "dim ~ '^[A-Za-z0-9_.:/-]{0,40}$'" in SQL and "BI_METRIC_RE = /^[A-Z][A-Z0-9_]{1,31}$/" in BI and "metric ~ '^[A-Z][A-Z0-9_]{1,31}$'" in SQL
   and "BI_MIN_CELL_RE = /^([0-9]|1[0-9]|20)$/" in BI and "'^([0-9]|1[0-9]|20)$', '3'" in SQL and "@ExportGate('BI_DAILY')" in CT and re.search(r"'BI_DAILY',[^\]]*'ITS_SURVEY'\] as const", EA)
   and "BI_DAILY: ['ADMIN']" in EA and 'pg_try_advisory_xact_lock' in BI and "case 'bi_daily':" in SC and "'bi_daily'," in WK and 'BiExportController,' in AM, '')
ok('① 메뉴 · 화면 — 통합 현황 › 통계 내보내기(BI) · CSV 승인 단추 · BI 보기 목록',
   "['bi-export', '통계 내보내기(BI)']" in MN and "'site-usage', ['bi-export']" in MN and "{tab === 'bi-export' && <BiExport />}" in APP
   and 'data-bi-csv' in W and 'data-bi-views' in W and "exportTicket(('BI_DAILY' as string)" in W, '')
scr = {x['id']: x for x in json.loads(SJ or '{"screens":[]}')['screens']}
ok('① 화면 SB-ADM-DTX-010 — API 5', len(scr.get('SB-ADM-DTX-010', {}).get('apis', [])) == 5, '')
D673 = doc('673_')
ok('① 문서 673 — 읽기 전용 계정(사람이 운영 서버에서) · 작은 칸 가림 · 처리방침 고칠 곳', all(x in D673 for x in ('읽기 전용', 'GRANT', '작은 칸 가림', '처리방침 고칠 곳')), '')
ok('① 판 v10.535 이상', VT >= (10, 535), VER)

if API and DB:
    TAG = 'v1535-' + str(int(time.time()))
    admin_id = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    tickets = []
    try:
        TS, TB = login('admin@x.com'), login('buyer@x.com')
        mb = call('GET', '/admin/bi', None, TB)
        ov = call('GET', '/admin/bi', None, TS)
        pii = psql("SELECT count(*) FROM v_bi_pii_columns")
        cols = psql("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bi_daily_metrics' AND column_name ~* '(account|email|phone|ip|name)'")
        ok('② 회원 403 · 한눈에 — 보기 5 · 개인 식별처럼 보이는 칸 0(DB 감시 보기도 0) · 집계 표에 계정 · 이메일 칸 없음',
           mb.get('_err') == 403 and len(ov.get('views') or []) == 5 and ov.get('piiColumns') == [] and pii == '0' and cols == '0', f"{mb.get('_err')} {len(ov.get('views') or [])} {ov.get('piiColumns')} {pii} {cols}")
        bad1 = call('POST', '/admin/bi/run', {'from': kst(0), 'to': kst(-2)}, TS)
        bad2 = call('POST', '/admin/bi/run', {'from': kst(-40), 'to': kst(-1)}, TS)
        bad3 = call('POST', '/admin/bi/run', {'from': '2026-13-01', 'to': kst(-1)}, TS)
        run = call('POST', '/admin/bi/run', {'from': kst(-2), 'to': kst(0)}, TS)
        sig_db = psql(f"SELECT coalesce(sum(value), 0)::int FROM bi_daily_metrics WHERE metric = 'SIGNUP' AND day BETWEEN '{kst(-2)}' AND '{kst(0)}'")
        sig_src = psql(f"SELECT count(*) FROM accounts WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN '{kst(-2)}' AND '{kst(0)}'")
        ok('② 다시 셈 — 시작 > 끝 422 · 31일 넘음 422 · 날짜 모양 400/422 · 3일 다시 셈 ok · 가입 수 = 원본 계정 수',
           bad1.get('code') == 'BI_RANGE' and bad2.get('code') == 'BI_RANGE' and bad3.get('_err') in (400, 422) and run.get('ok') is True and sig_db == sig_src,
           f"{bad1.get('code')} {bad2.get('code')} {bad3.get('_err')} {run.get('ok')} {sig_db}/{sig_src}")
        dl = call('GET', f"/admin/bi/daily?from={kst(-2)}&to={kst(0)}&metrics=SIGNUP,ORDER_PAID", None, TS)
        badm = call('GET', '/admin/bi/daily?metrics=signup;drop', None, TS)
        ok('② 일별 보기 — 고른 지표만 · 합 · 지표 모양 아님 422', dl.get('from') == kst(-2) and all(x.get('metric') in ('SIGNUP', 'ORDER_PAID') for x in dl.get('items') or [])
           and int((dl.get('totals') or {}).get('SIGNUP') or 0) == int(sig_db or 0) and badm.get('code') == 'BI_METRIC', f"{dl.get('totals')} {badm.get('code')}")
        # 작은 칸 가림 — 먼 옛날 하루에 시험 줄 하나(다시 셈 범위 밖 · 끝에 지움)
        psql("DELETE FROM bi_daily_metrics WHERE day = '2001-01-01' AND dim = 'T1535X'")
        psql("INSERT INTO bi_daily_metrics (day, metric, dim, value) VALUES ('2001-01-01', 'POST_NEW', 'T1535X', 1)")
        mc = int(getset('bi.min_cell') or 3)
        vv = psql("SELECT coalesce(value::text, 'NULL') || '|' || suppressed FROM bi.v_metrics_daily WHERE day = '2001-01-01' AND dim = 'T1535X'")
        ok('② bi 보기 — 나눔 줄 숫자가 작은 칸 가림보다 작으면 비움(suppressed)', vv == ('NULL|true' if mc > 1 else '1.00|false'), f"{vv} min_cell={mc}")
        nt = call('GET', '/admin/bi/export?from=2001-01-01&to=2001-01-01', None, TS)
        tid = psql(f"INSERT INTO export_requests (target, reason, requested_by, state, decided_by, decided_at, solo, decide_note) VALUES ('BI_DAILY', '시험 {TAG}', '{admin_id}', 'APPROVED', '{admin_id}', now(), true, '시험') RETURNING id")
        if re.match(r'^\d+$', tid or ''):
            tickets.append(tid)
        ex = call('GET', f'/admin/bi/export?from=2001-01-01&to=2001-01-01&ticket={tid}', None, TS)
        ex2 = call('GET', f'/admin/bi/export?from=2001-01-01&to=2001-01-01&ticket={tid}', None, TS)
        csv = ex.get('csv') or ''
        row = next((l for l in csv.splitlines() if 'T1535X' in l), '')
        ok('② CSV — 승인 없으면 422 EXPORT_NEED_APPROVAL · 승인 번호로 한 번 · 머리줄 · 가린 줄은 값 비움 · 같은 번호 두 번째 422',
           nt.get('code') == 'EXPORT_NEED_APPROVAL' and csv.lstrip('﻿').startswith('day,metric,label,unit,dim,value,suppressed') and row != ''
           and (row.endswith(',,Y') if mc > 1 else row.endswith(',1.00,')) and ex2.get('code') == 'EXPORT_NEED_APPROVAL',
           f"{nt.get('code')} {csv[:60]!r} {row!r} {ex2.get('code')}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'bi-export'")
        ok('② 권한 주소 5 · 설정 바꾸기는 SUPER(사유 없으면 400)', rmap == '5' and call('PUT', '/admin/bi/settings', {'minCell': 3}, TS).get('_err') == 400, rmap)
    finally:
        psql("DELETE FROM bi_daily_metrics WHERE day = '2001-01-01' AND dim = 'T1535X'")
        for t in tickets:
            psql(f"SET session_replication_role = replica; DELETE FROM export_requests WHERE id = {int(t)};")
    if ADMIN_WEB:
        r = admin_page('/#/bi-export', lambda pg, seen: (pg.wait_for_timeout(1500), seen.update(n=pg.locator('[data-bi]').count(), csv=pg.locator('[data-bi-csv]').count(),
                                                                                           views=pg.locator('[data-bi-views]').count())))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 통합 현황 › 통계 내보내기(BI)(CSV 단추 · BI 보기 상자 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('csv') == 1 and seen.get('views') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
