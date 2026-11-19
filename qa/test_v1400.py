"""v10.400 (D247 · docs/537) 부가세 신고서 미리보기
  ① (코드) 신고서 칸 · 설정 · API 2 · 화면 · 문서
  ② (API) 칸 15줄 · 매출세액 = 전표 VAT_OUT · 매입세액 = 전표 VAT_IN · 납부 · 차가감 · 틀린 분기 422 · 회원 403
  ③ (CSV) 승인 없이 422 · 승인 뒤 머리줄 · 16줄
  ④ (화면) 회계 › 부가세 신고서
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


import glob as _glob
def mig(prefix):
    xs = sorted(_glob.glob(os.path.join(K, 'prisma/migrations', prefix + '_*', 'migration.sql')))
    return open(xs[0], encoding='utf-8').read() if xs else ''


M47 = mig('D247')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
SR = rd('src/modules/acct/sources.ts')
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')


VF = rd('src/modules/acct/vatform.ts')
ok('① 코드 — 신고서 미리보기(매출 1 · 3 · 4 · 매입 10 · 11 · 14 · 불공제 16 · 납부세액 · 전자신고 공제) · 설정 acct.vat_efile_credit · API 2(CSV 승인 ACCT_TAX) · 화면 · 메뉴 · 문서 537 · 판 v10.400',
   'export async function vatForm' in VF and "'VAT_IN'" in VF and "'FIXED_ASSET'" in VF and 'acct.vat_efile_credit' in VF and "'acct.vat_efile_credit'" in M47
   and "@Get('tax/vat-form')" in AC and "@Get('tax/vat-form/export')" in AC and 'export function AcctVatForm' in UI and "'acct-vatform'" in MN and "acct-vatform" in AP
   and '"SB-ADM-ACC-150"' in SJ and '부가세 신고서' in doc('537_') and VT >= (10, 400), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1400', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    q = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    k = (kst.month - 1) // 3 + 1
    fr = f"{kst.year}-{k * 3 - 2:02d}-01"
    to = f"{kst.year + 1}-01-01" if k == 4 else f"{kst.year}-{k * 3 + 1:02d}-01"
    try:
        f = call('GET', f'/admin/acct/tax/vat-form?q={q}', None, TP)
        L = {x['no']: x for x in f.get('lines') or []}
        out_sql = psql(f"SELECT coalesce(sum(l.credit - l.debit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = 'VAT_OUT' AND e.entry_date >= '{fr}' AND e.entry_date < '{to}' AND e.source NOT IN ('YEAR_CLOSE', 'YEAR_REOPEN')")
        in_sql = psql(f"SELECT coalesce(sum(l.debit - l.credit), 0) FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE l.role = 'VAT_IN' AND e.entry_date >= '{fr}' AND e.entry_date < '{to}'")
        s9 = sum(int(L[n]['vat']) for n in ('1', '2', '3', '4', '5', '6') if n in L)
        s15 = sum(int(L[n]['vat']) for n in ('10', '11', '14') if n in L)
        bad = call('GET', '/admin/acct/tax/vat-form?q=2026-9', None, TP)
        mb = call('GET', f'/admin/acct/tax/vat-form?q={q}', None, TB)
        ok('② 신고서 — 칸 15줄 · 매출세액(9) = 1 ~ 6 합 = 전표 VAT_OUT · 매입세액(15) = 10 + 11 + 14 = 전표 VAT_IN · 납부(다) = 9 − 15 · 차가감(마) = 다 − 전자신고 공제 · 틀린 분기 422 · 회원 403',
           len(L) == 15 and int(L['9']['vat']) == s9 == int(out_sql or 0) and int(L['15']['vat']) == s15 == int(in_sql or 0)
           and int(L['다']['vat']) == s9 - s15 and int(L['마']['vat']) == int(L['다']['vat']) + int(L['라']['vat']) == int(f.get('due', -1))
           and bad.get('code') == 'ACCT_PERIOD' and mb.get('_err') == 403,
           f"{len(L)} · 9 {L.get('9', {}).get('vat')} = {s9} = {out_sql} · 15 {L.get('15', {}).get('vat')} = {s15} = {in_sql} · 다 {L.get('다', {}).get('vat')} 마 {L.get('마', {}).get('vat')} · {bad.get('code')} {mb.get('_err')}")
        nt = call('GET', f'/admin/acct/tax/vat-form/export?q={q}', None, TP)
        tk = __import__('export_ticket').get(TP, 'ACCT_TAX', TS)
        cv = call('GET', f'/admin/acct/tax/vat-form/export?q={q}&ticket={tk}', None, TP) if tk else {}
        head = (cv.get('csv') or '').lstrip('﻿').split('\r\n')[0]
        ok('③ CSV — 승인 없이 422 · 승인 뒤 머리줄(칸 · 나눔 · 항목 · 금액 · 세액) · 16줄(면세 한 줄 더)',
           nt.get('code') == 'EXPORT_NEED_APPROVAL' and bool(tk) and head == '칸,나눔,항목,금액(공급가),세액' and int(cv.get('rows') or 0) == 16,
           f"{nt.get('code')} · {bool(tk)} · {head} · {cv.get('rows')}")
    finally:
        rm_role(pid, '1400')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-vatform]', timeout=30000); pg.wait_for_timeout(1500)
            seen['lines'] = pg.locator('[data-vatform-line]').count()
            seen['due'] = pg.locator('[data-acct-vat-due]').count()
        res = admin_page('/#/acct-vatform', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 부가세 신고서 · 15줄 · 납부할 세액 · 화면 오류 없음', seen.get('lines') == 15 and seen.get('due') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
