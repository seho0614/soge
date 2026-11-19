"""v10.407 (D248 · docs/544) 법인세 추정 미리보기
  ① (코드) D248 설정 · 누진 셈 · 기한 · API · 화면 · 문서
  ② (API) 추정 — 세율 구간 설정 그대로 · 누진 세액 · 지방소득세 · 기한 · 회원 403 · 틀린 설정 DB 가 막음
  ③ (API · DB) 손익 — 시험 전표만큼 매출 · 비용 · 이익이 늘어남
  ④ (화면) 회계 › 법인세 추정
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


import glob
def mig(prefix):
    fs = sorted(glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(fs[0], encoding='utf-8').read() if fs else ''


M48 = mig('D248')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SRC = rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
CT = rd('src/modules/acct/corptax.ts')
ok('① 코드 — D248 설정(세율 구간 · 지방소득세 · 사업연도 끝 달) · 누진 셈 · 중간예납 · 확정 기한 · API · 화면 · 메뉴 · 명세 · 문서 544 · 판 v10.407',
   "'acct.corp_tax_brackets'" in M48 and "'acct.corp_local_rate'" in M48 and "'acct.corp_fiscal_end'" in M48
   and 'export function corpTax' in CT and 'export async function corpDeadlines' in CT and "'YEAR_CLOSE', 'YEAR_REOPEN'" in CT and "@Get('corptax')" in AC
   and 'export function AcctCorpTax' in UI and "{tab === 'acct-corptax' && <AcctCorpTax />}" in AP and "['acct-corptax', '법인세 추정']" in MN
   and '"SB-ADM-ACC-220"' in SJ and '법인세' in doc('544_') and VT >= (10, 407), VER)


def tax_of(base, br):
    if base <= 0:
        return 0
    t, prev = 0.0, 0
    for up, rate in br:
        top = float('inf') if up is None else up
        if base > prev:
            t += (min(base, top) - prev) * rate / 100
        prev = top
        if base <= top:
            break
    return int(t)


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1407', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    b0, l0 = getset('acct.corp_tax_brackets'), getset('acct.corp_local_rate')
    try:
        g0 = call('GET', '/admin/acct/corptax', None, TP)
        mem = call('GET', '/admin/acct/corptax', None, TB)
        badset = setting('acct.corp_tax_brackets', 'abc', '1407')
        setting('acct.corp_tax_brackets', '1000:10,5000:20,*:30', '1407'); setting('acct.corp_local_rate', '10', '1407')
        g1 = call('GET', '/admin/acct/corptax', None, TP)
        br = [(b.get('upTo'), b.get('rate')) for b in g1.get('brackets') or []]
        an = g1.get('annualized') or {}
        ytd = g1.get('ytd') or {}
        dl = g1.get('deadlines') or []
        fy = g1.get('fiscalYear') or {}
        today = kst.strftime('%Y-%m-%d')
        ok('② 추정 — 지급 담당 봄 · 회원 403 · 틀린 세율 설정은 DB 가 막음 · 바꾼 세율 구간 그대로 · 누진 세액 · 지방소득세 10% · 지금까지 이익 = 매출 − 비용 · 기한(중간예납 · 확정) 지나지 않은 것',
           not g0.get('_err') and mem.get('_err') == 403 and '!' in badset and br == [(1000, 10), (5000, 20), (None, 30)]
           and an.get('tax') == tax_of(an.get('profit') or 0, br) and an.get('local') == int((an.get('tax') or 0) * 10 / 100)
           and ytd.get('profit') == (ytd.get('revenue') or 0) - (ytd.get('expense') or 0) and ytd.get('tax') == tax_of(ytd.get('profit') or 0, br)
           and len(dl) >= 1 and all('법인세' in x.get('label', '') and x.get('due', '') >= today and x.get('daysLeft', -1) >= 0 for x in dl)
           and fy.get('start', '') <= today <= fy.get('end', ''),
           f"{g0.get('_err') or 'ok'} · {mem.get('_err')} · {badset[-40:]} · {br} · 1년 {an} · 지금 {ytd} · 기한 {[(x.get('label'), x.get('due')) for x in dl]} · {fy}")
        # 손익 계산 확인 — 시험 전표 한 장(매출 11,000 · 비용 3,000)을 넣고 차이만 봄
        stamp = int(time.time()) % 1000000
        before = (call('GET', '/admin/acct/corptax', None, TP).get('ytd') or {})
        psql(f"BEGIN; WITH e AS (INSERT INTO acct_entries (entry_date, source, source_key, memo) VALUES ('{today}', 'TEST_CT', 't1407-{stamp}', '시험 1407') RETURNING id) "
             f"INSERT INTO acct_lines (entry_id, role, debit, credit) SELECT id, 'CASH', 8000, 0 FROM e UNION ALL SELECT id, 'EXP_FEE', 3000, 0 FROM e UNION ALL SELECT id, 'REV_SUB', 0, 11000 FROM e; COMMIT;")
        after = (call('GET', '/admin/acct/corptax', None, TP).get('ytd') or {})
        ok('③ 손익 — 시험 전표(매출 11,000 · 비용 3,000)만큼 매출 +11,000 · 비용 +3,000 · 이익 +8,000',
           (after.get('revenue') or 0) - (before.get('revenue') or 0) == 11000 and (after.get('expense') or 0) - (before.get('expense') or 0) == 3000
           and (after.get('profit') or 0) - (before.get('profit') or 0) == 8000, f"{before} → {after}")
    finally:
        setting('acct.corp_tax_brackets', b0 or None, '1407 되돌림'); setting('acct.corp_local_rate', l0 or None, '1407 되돌림')
        psql("SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source = 'TEST_CT'); DELETE FROM acct_entries WHERE source = 'TEST_CT'")
        rm_role(pid, '1407')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-corptax]', timeout=30000)
            seen['ct'] = pg.locator('[data-acct-corptax]').count()
            seen['ytd'] = pg.locator('[data-acct-corptax-ytd]').count()
            seen['annual'] = pg.locator('[data-acct-corptax-annual]').count()
        res = admin_page('/#/acct-corptax', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 법인세 추정 · 지금까지 · 1년 줄 · 화면 오류 없음',
               seen.get('ct') == 1 and seen.get('ytd') == 1 and seen.get('annual') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
