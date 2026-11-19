"""v10.384 (D242 · docs/520) 경영 보고서
  ① (코드) API · 화면 · 첫 화면 카드
  ② (API) 매출 · 비용 · 이익 = 전표
  ③ (화면) 회계 메뉴 · 카드
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




AC, RP, UI, DB_, AP = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/app/admin/Dashboard.tsx'), rd('web/src/App.tsx')
ok('① 코드 — 경영 보고서 API · 화면 · 첫 화면 카드(SUPER) · 문서 520 · 판 v10.384',
   "@Get('report')" in AC and 'export async function acctReport' in RP and 'data-acct-report=' in UI and 'export function AcctCard' in UI
   and '{isSuperNow() && <AcctCard onGo={onGo} />}' in DB_ and "{tab === 'acct-report' && <AcctReport />}" in AP and '"SB-ADM-ACC-030"' in SJ and '경영 보고서' in doc('520_') and VT >= (10, 384), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1384', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    try:
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1384-{stamp}', 'name': f'시험광고주1384 {stamp}'}, TS)
        call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 30000, 'dueDate': d0, 'memo': '시험 1384'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        r = call('GET', '/admin/acct/report?months=12', None, TP)
        sq = psql(f"SELECT coalesce(sum(l.credit - l.debit) FILTER (WHERE a.kind = 'REVENUE'), 0) || '|' || coalesce(sum(l.debit - l.credit) FILTER (WHERE a.kind = 'EXPENSE'), 0) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id JOIN acct_accounts a ON a.role = l.role WHERE e.ym = '{ym}' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")   # v10.396 (D246) — 경영 보고서는 계정 종류로 셈(매출원가 · 처분 손익 포함)
        last = next((m for m in r.get('months') or [] if m.get('ym') == ym), {})
        rb = call('GET', '/admin/acct/report', None, TB)
        rv, ex = (sq.split('|') + ['0', '0'])[:2]
        ok('② API — 이번 달 매출 = 전표 매출 줄 합 · 비용 = 비용 줄 합 · 이익 = 매출 − 비용 · 최근 달 · 지급 담당 보기 · 회원 403',
           int(last.get('revenue') or -1) == int(rv) and int(last.get('expense') or 0) == int(ex) and last.get('profit') == int(rv) - int(ex) and int(rv) >= 30000
           and (r.get('latest') or {}).get('ym') == ym and rb.get('_err') == 403, f"{last} · {sq} · {rb.get('_err')}")
    finally:
        rm_role(pid, '1384')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-card]', timeout=30000)
            seen['card'] = pg.locator('[data-acct-card]').count()
            seen['menu'] = pg.locator('[data-group="admacc"]').count()
            for t in ('acct-journal', 'acct-tax', 'acct-report', 'acct-accounts'):
                pg.goto(ADMIN_WEB + '/#/' + t, wait_until='networkidle', timeout=120000)
                sel = {'acct-journal': '[data-acct-journal]', 'acct-tax': '[data-acct-vat]', 'acct-report': '[data-acct-report]', 'acct-accounts': '[data-acct-rules]'}[t]
                pg.wait_for_selector(sel, timeout=30000); seen[t] = pg.locator(sel).count()
        res = admin_page('/#/home', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 첫 화면 「이번 달 매출」 카드(SUPER) · 「회계」 메뉴 · 전표 · 신고 자료 · 경영 보고서 · 계정 · 규칙 탭이 열림 · 화면 오류 없음',
               seen.get('card') == 1 and seen.get('menu', 0) >= 1 and all(seen.get(t) == 1 for t in ('acct-journal', 'acct-tax', 'acct-report', 'acct-accounts')) and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
