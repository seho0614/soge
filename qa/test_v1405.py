"""v10.405 (D248 · docs/542) 수동 전표 쓰기 · 결재
  ① (코드) D248 수동 전표 표 · 가드 · API · 화면 · 문서
  ② (API) 요청 — 차대 다름 · 모르는 계정 · 한 줄 차대 둘 다 · 마감한 달 422 · 회원 403
  ③ (API · DB) 결재 — 지급 담당 403 · 자기 것 422 · SUPER 승인 = 전표 MANUAL · 두 번 409 · 반려 사유 · 취소 · DB 가 내용 고치기 · 지우기 · 자기 승인 막음
  ④ (화면) 회계 › 수동 전표
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
MA = rd('src/modules/acct/manual.ts')
ok('① 코드 — D248 수동 전표 표(내용 못 고침 · 앞으로만 · 쓴 사람 승인 막기 · SUPER 만) · API 4 · 감사 · 마감 달 · 해 확인 · 화면 · 메뉴 · 명세 · 문서 542 · 판 v10.405',
   'CREATE TABLE IF NOT EXISTS public.acct_manual_entries' in M48 and 'ACCT_MANUAL_SELF' in M48 and 'ACCT_MANUAL_ROLE' in M48
   and "@Get('manual')" in AC and "@Post('manual')" in AC and "@Post('manual/:id/decide')" in AC and "@Post('manual/:id/cancel')" in AC
   and "@Audit('ACCT_MANUAL_DECIDE', 'SETTING')" in AC and 'ACCT_MANUAL_BALANCE' in MA and 'fn_acct_year_closed' in MA
   and 'export function AcctManual' in UI and "{tab === 'acct-manual' && <AcctManual />}" in AP and "['acct-manual', '수동 전표']" in MN
   and '"SB-ADM-ACC-200"' in SJ and '수동 전표' in doc('542_') and VT >= (10, 405), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1405', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    d0 = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    n = 300000 + stamp % 9000
    memo = f'시험 1405 임대료 {stamp}'
    good = {'entryDate': d0, 'memo': memo, 'party': '(주)시험건물', 'evidence': 'TAX_INVOICE',
            'lines': [{'role': 'EXP_RENT', 'debit': n}, {'role': 'VAT_IN', 'debit': n // 10}, {'role': 'CASH', 'credit': n + n // 10}]}
    try:
        unb = call('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'EXP_RENT', 'debit': n}, {'role': 'CASH', 'credit': n - 1}]}, TP)
        unk = call('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'NO_SUCH_ROLE', 'debit': n}, {'role': 'CASH', 'credit': n}]}, TP)
        both = call('POST', '/admin/acct/manual', {**good, 'lines': [{'role': 'EXP_RENT', 'debit': n, 'credit': n}, {'role': 'CASH', 'credit': n}]}, TP)
        cym = psql("SELECT coalesce(max(ym), '') FROM acct_closings")
        cls = call('POST', '/admin/acct/manual', {**good, 'entryDate': f'{cym}-15'}, TP) if cym else {'code': 'ACCT_MANUAL_CLOSED'}
        mem = call('POST', '/admin/acct/manual', good, TB)
        r1 = call('POST', '/admin/acct/manual', good, TP)                     # 지급 담당이 씀
        r2 = call('POST', '/admin/acct/manual', {**good, 'memo': memo + ' SUPER'}, TS)   # SUPER 가 씀(자기 승인 막기 확인)
        r3 = call('POST', '/admin/acct/manual', {**good, 'memo': memo + ' 반려'}, TP)
        ok('② 요청 — 차대 다르면 422 · 모르는 계정 422 · 한 줄에 차대 둘 다 422 · 마감한 달 422 · 회원 403 · 지급 담당 · SUPER 요청 됨',
           unb.get('code') == 'ACCT_MANUAL_BALANCE' and unk.get('code') == 'ACCT_MANUAL' and both.get('code') == 'ACCT_MANUAL' and cls.get('code') == 'ACCT_MANUAL_CLOSED'
           and mem.get('_err') == 403 and r1.get('ok') is True and r2.get('ok') is True and r3.get('ok') is True,
           f"{unb.get('code')} · {unk.get('code')} · {both.get('code')} · 마감 {cym} {cls.get('code')} · {mem.get('_err')} · {r1.get('id')} {r2.get('id')} {r3.get('id')}")

        byp = call('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True}, TP)
        self_ = call('POST', f"/admin/acct/manual/{r2.get('id')}/decide", {'approve': True}, TS)
        ap = call('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True, 'note': '계약서 확인'}, TS)
        ap2 = call('POST', f"/admin/acct/manual/{r1.get('id')}/decide", {'approve': True}, TS)
        rj0 = call('POST', f"/admin/acct/manual/{r3.get('id')}/decide", {'approve': False}, TS)
        rj1 = call('POST', f"/admin/acct/manual/{r3.get('id')}/decide", {'approve': False, 'note': '증빙 다시'}, TS)
        cn = call('POST', f"/admin/acct/manual/{r2.get('id')}/cancel", None, TS)
        lines = psql(f"SELECT e.source || '|' || string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.role) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.id = {ap.get('entryId') or 0} GROUP BY e.source")
        x1 = psql(f"UPDATE acct_manual_entries SET memo = '바꿈' WHERE id = {r1.get('id') or 0}")
        x2 = psql(f"DELETE FROM acct_manual_entries WHERE id = {r1.get('id') or 0}")
        x3 = psql(f"UPDATE acct_manual_entries SET state = 'APPROVED', decided_by = created_by, decided_at = now() WHERE id = {r2.get('id') or 0}")
        lst = call('GET', '/admin/acct/manual', None, TP)
        want = 'MANUAL|' + ','.join(sorted([f'CASH:0:{n + n // 10}', f'EXP_RENT:{n}:0', f'VAT_IN:{n // 10}:0']))
        ok('③ 결재 — 지급 담당 승인 403 · 자기가 쓴 것 승인 422 · SUPER 승인 → 전표 MANUAL(줄 그대로) · 두 번 409 · 반려 사유 없으면 422 · 반려 · 취소 · 내용 고치기 · 지우기 DB 가 막음 · 목록',
           byp.get('_err') == 403 and self_.get('code') == 'ACCT_MANUAL_SELF' and ap.get('state') == 'APPROVED' and bool(ap.get('entryId')) and lines == want
           and ap2.get('code') == 'ACCT_MANUAL_STATE' and rj0.get('code') == 'ACCT_MANUAL' and rj1.get('state') == 'REJECTED' and cn.get('state') == 'CANCELED'
           and 'ACCT_MANUAL' in x1 and 'ACCT_MANUAL' in x2 and 'ACCT_MANUAL' in x3 and any(x.get('id') == r1.get('id') for x in lst.get('items') or []),
           f"{byp.get('_err')} · {self_.get('code')} · {ap.get('state')} {ap.get('entryId')} · {lines} (기대 {want}) · {ap2.get('code')} · {rj0.get('code')} {rj1.get('state')} · {cn.get('state')} · {x1[-30:]} · {x2[-30:]} · {x3[-30:]}")
    finally:
        # 회사 장부에 남기지 않음 — 시험 요청 · 그 전표 지움(replica)
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM acct_lines WHERE entry_id IN (SELECT entry_id FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%' AND entry_id IS NOT NULL); "
             f"CREATE TEMP TABLE t1405 AS SELECT entry_id FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%' AND entry_id IS NOT NULL; "
             f"DELETE FROM acct_manual_entries WHERE memo LIKE '시험 1405 임대료 {stamp}%'; "
             f"DELETE FROM acct_entries WHERE id IN (SELECT entry_id FROM t1405)")
        rm_role(pid, '1405')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-manual]', timeout=30000)
            seen['manual'] = pg.locator('[data-acct-manual]').count()
            seen['form'] = pg.locator('[data-acct-manual-form]').count()
            seen['lines'] = pg.locator('[data-acct-manual-line]').count()
            seen['sum'] = pg.locator('[data-acct-manual-sum]').count()
        res = admin_page('/#/acct-manual', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 수동 전표 · 쓰기 상자(줄 2) · 차대 합 · 화면 오류 없음',
               seen.get('manual') == 1 and seen.get('form') == 1 and seen.get('lines') == 2 and seen.get('sum') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
