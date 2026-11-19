"""v10.390 (D244 · docs/527) 월 결산 요약 · 신고 기한 알림
  ① (코드) 설정 · 정기 작업 · 기한 셈 · 요약 · 화면 · 문서
  ② (API) 요약 — 할 일 4줄 · 매출 = 전표 합 · 기한(원천세 10일 · 부가세 25일 · 주말 · 공휴일이면 다음 영업일)
  ③ (정기 작업) 기한 N일 안이면 ACCT_DEADLINE 한 번(두 번 돌려도 하나) · 지난 기한 알림은 풀림 · 지난달 마감 안 함 ACCT_UNCLOSED 한 번
  ④ (화면) 회계 › 월 결산
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


M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
MO, SC, WK = rd('src/modules/acct/month.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — 설정 4 · 정기 작업 acct_deadline(09:15) · 기한 셈(영업일) · 알림 ACCT_DEADLINE · ACCT_UNCLOSED · 요약 · API 2 · 화면 · 메뉴 첫 탭 · 문서 527 · 판 v10.390',
   "'acct.deadline_alert'" in M44 and "'acct.deadline_days_before'" in M44 and "'acct.vat_months'" in M44 and "'acct.close_by_day'" in M44 and "('acct_deadline', 1440, 9, 15," in M44
   and 'fn_is_business_day' in MO and "'ACCT_DEADLINE'" in MO and "'ACCT_UNCLOSED'" in MO and 'export async function monthSummary' in MO
   and "case 'acct_deadline':" in SC and "'acct_deadline'," in WK and "@Get('month')" in AC and "@Get('deadlines')" in AC
   and 'export function AcctMonth' in UI and "'acct-month', 'acct-journal', 'acct-bank'" in MN
   and '"SB-ADM-ACC-050"' in SJ and '신고 기한' in doc('527_') and VT >= (10, 390), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1390', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, today = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    pm = (kst.replace(day=1) - datetime.timedelta(days=1)).strftime('%Y-%m')
    keep = {k: getset(k) for k in ('acct.vat_months', 'acct.deadline_days_before', 'acct.close_by_day', 'acct.start_on', 'acct.deadline_alert')}
    t0 = psql("SELECT now()")
    try:
        m = call('GET', f'/admin/acct/month?ym={ym}', None, TP)
        sq = psql(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role WHERE e.ym = '{ym}'")
        mb = call('GET', f'/admin/acct/month?ym={ym}', None, TB)
        # 이번 달 25일을 부가세 달로 · 알림 7일 전 — 기한 API 와 정기 작업이 같은 날을 봄
        setting('acct.vat_months', str(int(ym[5:7])), '1390'); setting('acct.deadline_days_before', '7', '1390'); setting('acct.deadline_alert', 'on', '1390')
        dl = call('GET', '/admin/acct/deadlines', None, TP)
        lst = dl.get('list') or []
        wht = next((x for x in lst if x.get('kind') == 'WHT'), {})
        vat = next((x for x in lst if x.get('kind') == 'VAT' and x.get('base') == f'{ym}-25'), None)
        biz = psql(f"SELECT fn_is_business_day('{wht.get('due') or today}'::date)") if wht else 'f'
        ok('② 요약 · 기한 — 할 일 4줄(전표 · 통장 · 세금계산서 · 마감) · 이번 달 매출 = 전표 매출 줄 합 · 회원 403 · 원천세 기한은 10일 이후 첫 영업일 · 부가세(이번 달 25일 · 지나지 않았으면) · 남은 날',
           [c.get('key') for c in m.get('checks') or []] == ['journal', 'bank', 'invoices', 'close'] and int((m.get('money') or {}).get('revenue', -1)) == int(sq or 0) and mb.get('_err') == 403
           and bool(wht) and wht.get('due') >= wht.get('base', '') and wht.get('base', '').endswith('-10') and biz == 't'
           and (vat is not None or today > f'{ym}-25') and all(isinstance(x.get('daysLeft'), int) and x['daysLeft'] >= 0 for x in lst),
           f"{[c.get('key') for c in m.get('checks') or []]} · 매출 {(m.get('money') or {}).get('revenue')} = {sq} · {mb.get('_err')} · 원천 {wht} {biz} · 부가 {vat}")

        # ③ 정기 작업 — 지난 기한 알림(시험이 넣은 것)은 풀리고 · N일 안 기한은 한 번만 · 지난달 마감 안 함
        fake = f'TEST:{today}:{int(time.time())}'
        psql(f"INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at) VALUES ('ACCT_DEADLINE', 'WARN', '시험 1390 지난 기한', '{{\"key\": \"{fake}\", \"due\": \"2000-01-10\"}}'::jsonb, clock_timestamp())")
        setting('acct.close_by_day', '1', '1390'); setting('acct.start_on', f'{pm}-01', '1390')
        j1 = call('POST', '/admin/jobs', {'job': 'acct_deadline'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'acct_deadline'}, TS)
        soon = [x for x in lst if x.get('daysLeft', 99) <= 7]
        nkeys = {x['key']: psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_DEADLINE' AND detail->>'key' = '{x['key']}'") for x in soon}
        fk = psql(f"SELECT (resolved_at IS NOT NULL)::text FROM ops_alerts WHERE alert_code = 'ACCT_DEADLINE' AND detail->>'key' = '{fake}'")
        closed = psql(f"SELECT count(*) FROM acct_closings WHERE ym = '{pm}'")
        nun = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_UNCLOSED' AND detail->>'ym' = '{pm}'")
        want_un = closed == '0' and int(today[8:10]) > 1
        ok('③ 정기 작업 — 지난 기한 알림 풀림 · 7일 안 기한마다 알림 하나(두 번 돌려도) · 지난달 마감 안 했으면 ACCT_UNCLOSED 하나(마감했으면 없음)',
           fk == 'true' and all(v == '1' for v in nkeys.values()) and (nun == '1' if want_un else nun in ('0', '1')) and not j1.get('_err') and not j2.get('_err'),
           f"지난 {fk} · 기한 {nkeys} · 마감 {closed} 알림 {nun}(기대 {want_un}) · {j1.get('_err') or ''}{j2.get('_err') or ''}")
    finally:
        for k, v in keep.items():
            if v: setting(k, v, '1390 되돌림')
        # 시험이 만든 알림은 확인함으로(다른 시험의 「안 본 알림」 셈에 끼지 않게)
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1390' WHERE alert_code IN ('ACCT_DEADLINE', 'ACCT_UNCLOSED') AND resolved_at IS NULL AND raised_at >= '{t0}'::timestamptz")
        rm_role(pid, '1390')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-month-sum]', timeout=30000)
            seen['sum'] = pg.locator('[data-acct-month-sum]').count()
            seen['checks'] = pg.locator('[data-acct-check]').count()
            seen['first'] = pg.locator('[data-group="admacc"]').count()
        res = admin_page('/#/acct-month', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 월 결산 · 할 일 4줄 · 화면 오류 없음',
               seen.get('sum') == 1 and seen.get('checks') == 4 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
