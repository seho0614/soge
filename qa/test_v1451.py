"""v10.451 (D260 · docs/588) 승인된 수동 전표 반대 전표(역분개)
  ① (코드) acct_entry_reversals · 가드 · reverseManual · POST manual/{id}/reverse(SUPER · 감사) · 수동 전표 화면 단추 · 문서 588
  ② (API · DB) 요청 상태 409 · 지급 담당 403 · 짧은 사유 400/422 · 원래 날짜 앞 422 · 반대 전표(차대 바뀜) · 두 번 409 · 목록에 표시 · 기록 고치기 DB 막음
  ③ (화면) 회계 › 장부 › 수동 전표 — 반대 전표 표시
  시험 전표는 끝에 지움(replica).
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


def raw(m_, url, data, ct, t=None):
    hd = {'content-type': ct}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    try:
        return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hd, method=m_), timeout=60).status
    except urllib.error.HTTPError as e:
        return e.code


M60 = migr('D260_')
BK, BC = rd('src/modules/acct/books.ts'), rd('src/modules/acct/acct-books.controller.ts')
UI, AP, MN, AM, AT, MA = rd('web/src/app/admin/AcctBooks.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'), rd('web/src/app/admin/Acct.tsx'), rd('src/modules/acct/manual.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d'); ym = today[:7]; m1 = ym + '-01'
stamp = int(time.time()) % 1000000
ok('① 코드 — 반대 전표 표 · 가드 · 함수 · API(SUPER · 감사 ACCT_MANUAL_REVERSE) · 마감 확인 assertOpen 내보냄 · 목록 칸 · 화면 단추 · 화면 목록 · 권한 주소 · 문서 588 · 판 v10.451',
   'CREATE TABLE IF NOT EXISTS public.acct_entry_reversals' in M60 and 'fn_acct_entry_reversal_guard' in M60 and 'export async function reverseManual' in BK
   and "@Post('manual/:id/reverse')" in BC and "@Audit('ACCT_MANUAL_REVERSE', 'SETTING')" in BC and 'export async function assertOpen' in MA and '"reverseEntryId"' in MA
   and 'data-acct-manual-reverse' in AT and '"POST /admin/acct/manual/{id}/reverse"' in SJ and "'/admin/acct/manual/{id}/reverse', 'acct-manual', 'APPROVE'" in re.sub(r',\s+', ', ', M60)
   and '반대 전표' in doc('588_') and VT >= (10, 451), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1451', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    memo = f'시험 1451 반대 {stamp}'
    mid = None
    try:
        r = call('POST', '/admin/acct/manual', {'entryDate': today, 'memo': memo, 'evidence': 'NONE',
                 'lines': [{'role': 'EXP_SUPPLIES', 'debit': 1451}, {'role': 'CASH_HAND', 'credit': 1451}]}, TP)
        mid = r.get('id')
        early = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 요청 상태'}, TS)
        ap = call('POST', f'/admin/acct/manual/{mid}/decide', {'approve': True}, TS)
        byp = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 지급 담당'}, TP)
        short = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': 'x'}, TS)
        before = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 앞 날짜', 'reverseOn': '2026-01-01'}, TS)
        rv = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 되돌림', 'reverseOn': today}, TS)
        again = call('POST', f'/admin/acct/manual/{mid}/reverse', {'reason': '시험 1451 두 번째'}, TS)
        sw = psql(f"SELECT string_agg(role || ':' || debit || ':' || credit, ',' ORDER BY role) FROM acct_lines WHERE entry_id = {int(rv.get('reverseEntryId') or 0)}")
        src = psql(f"SELECT source || '|' || source_key FROM acct_entries WHERE id = {int(rv.get('reverseEntryId') or 0)}")
        lst = call('GET', '/admin/acct/manual?state=APPROVED', None, TP)
        mine = next((x for x in lst.get('items') or [] if x.get('id') == mid), {})
        up = psql(f"UPDATE acct_entry_reversals SET reason = '바꿈 시험 1451' WHERE manual_id = {int(mid or 0)}")
        ok('② 반대 전표 — 요청 상태 409 · 지급 담당 403 · 짧은 사유 400/422 · 원래 날짜 앞 422 · 반대 전표(차대 바뀜 · MANUAL_REVERSE) · 두 번 409 · 목록에 반대 전표 · 기록 고치기 DB 막음',
           r.get('ok') is True and early.get('code') == 'ACCT_REVERSE_STATE' and ap.get('state') == 'APPROVED' and byp.get('_err') == 403 and short.get('_err') in (400, 422)
           and before.get('code') == 'ACCT_REVERSE_DATE' and rv.get('ok') is True and sw == 'CASH_HAND:1451:0,EXP_SUPPLIES:0:1451' and src == f'MANUAL_REVERSE|{mid}'
           and again.get('code') == 'ACCT_REVERSE_DONE' and mine.get('reverseEntryId') == rv.get('reverseEntryId') and 'ACCT_REVERSE' in up,
           f"{r.get('ok')} · {early.get('code')} · {ap.get('state')} · {byp.get('_err')} · {short.get('_err')} · {before.get('code')} · {rv.get('ok')} {sw} {src} · {again.get('code')} · {mine.get('reverseEntryId')} · {up[-30:]}")
    finally:
        if mid:
            psql(f"SET session_replication_role = replica; "
                 f"CREATE TEMP TABLE t1451 AS SELECT entry_id AS id FROM acct_entry_reversals WHERE manual_id = {int(mid)} UNION SELECT reverse_entry_id FROM acct_entry_reversals WHERE manual_id = {int(mid)} "
                 f"UNION SELECT entry_id FROM acct_manual_entries WHERE id = {int(mid)} AND entry_id IS NOT NULL; "
                 f"DELETE FROM acct_entry_reversals WHERE manual_id = {int(mid)}; "
                 f"DELETE FROM acct_approval_steps WHERE doc_kind = 'MANUAL' AND doc_id = {int(mid)}; "
                 f"DELETE FROM acct_manual_entries WHERE id = {int(mid)}; "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM t1451); DELETE FROM acct_entries WHERE id IN (SELECT id FROM t1451)")
        rm_role(pid, '1451')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-manual]', timeout=30000)
            seen['n'] = pg.get_attribute('[data-acct-manual]', 'data-acct-manual')
        res = admin_page('/#/acct-manual', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 장부 › 수동 전표 열림 · 화면 오류 없음', seen.get('n') not in (None, '') and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
