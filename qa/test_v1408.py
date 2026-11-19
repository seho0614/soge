"""v10.408 (D249 · docs/545) 거래처 대장
  ① (코드) D249 거래처 표 · 가드 · API 5 · 화면 · 메뉴 · 문서 545
  ② (API · DB) 넣기 · 같은 사업자번호 409 · 계좌 끝 4자리 · 회원 403 · 찾기 · 한 곳 보기 · 닫기 · 지우기 막음
  ③ (API) 가져오기(SUPER · 다시 눌러도 같음)
  ④ (화면) 회계 › 거래처
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


def lines_of(source, key):
    """전표 줄 → 'ROLE:차변:대변' 정렬 목록"""
    out = psql(f"SELECT l.role || ':' || l.debit || ':' || l.credit FROM acct_lines l JOIN acct_entries e ON e.id = l.entry_id WHERE e.source = '{source}' AND e.source_key = '{key}' ORDER BY 1")
    return sorted(x for x in out.split('\n') if x and not x.startswith('!'))


M49 = migr('D249_')
AC, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
PT = rd('src/modules/acct/parties.ts')
ok('① 코드 — D249 거래처 표 · 사업자번호 하나 · 계좌 끝 4자리 · 지우기 막음 · API 5 · 감사 · 화면 · 메뉴 · 명세 · 문서 545 · 판 v10.408',
   'CREATE TABLE IF NOT EXISTS public.acct_parties' in M49 and 'uq_acct_parties_biz' in M49 and "account_last4 ~ '^[0-9]{4}$'" in M49 and 'fn_acct_party_guard' in M49
   and 'export async function importParties' in PT and 'export async function partyDetail' in PT
   and "@Get('parties')" in AC and "@Get('parties/:id')" in AC and "@Post('parties')" in AC and "@Patch('parties/:id')" in AC and "@Post('parties/import')" in AC
   and "@Audit('ACCT_PARTY_ADD', 'SETTING')" in AC and "@Audit('ACCT_PARTY_IMPORT', 'SETTING')" in AC
   and 'export function AcctParties' in UI and "{tab === 'acct-parties' && <AcctParties />}" in AP and "['acct-parties', '거래처']" in MN
   and 'GET /admin/acct/parties' in SJ and '거래처' in doc('545_') and VT >= (10, 408), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1408', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    stamp = int(time.time()) % 1000000
    biz = '8' + str(stamp).zfill(9)
    body = {'kind': 'SUPPLIER', 'name': f'(주)시험거래처1408-{stamp}', 'bizNo': biz[:3] + '-' + biz[3:5] + '-' + biz[5:], 'contactName': '김담당',
            'contactPhone': '02-123-4567', 'bankName': '국민은행', 'accountLast4': '1234'}
    try:
        p1 = call('POST', '/admin/acct/parties', body, TP)
        dup = call('POST', '/admin/acct/parties', dict(body, name=f'겹침1408-{stamp}'), TP)
        b4 = call('POST', '/admin/acct/parties', dict(body, bizNo='', accountLast4='12345'), TP)
        bb = call('POST', '/admin/acct/parties', dict(body, bizNo='123'), TP)
        mem = call('POST', '/admin/acct/parties', dict(body, bizNo=''), TB)
        row = psql(f"SELECT biz_no || '|' || coalesce(account_last4, '') FROM acct_parties WHERE id = {p1.get('id') or 0}")
        lst = call('GET', f"/admin/acct/parties?q={urllib.parse.quote(biz)}", None, TP)
        dt = call('GET', f"/admin/acct/parties/{p1.get('id')}", None, TP)
        cl = call('PATCH', f"/admin/acct/parties/{p1.get('id')}", dict(body, state='CLOSED'), TP)
        st = psql(f"SELECT state FROM acct_parties WHERE id = {p1.get('id') or 0}")
        delp = psql(f"DELETE FROM acct_parties WHERE id = {p1.get('id') or 0}")
        ok('② 거래처 — 넣기(사업자번호 - 빼고 10자리 · 끝 4자리) · 같은 번호 409 · 계좌 5자리 422 · 번호 3자리 422 · 회원 403 · 찾기 · 한 곳 보기 · 닫기 · 지우기 DB 가 막음 · 감사',
           p1.get('ok') is True and dup.get('code') == 'PARTY_DUP' and b4.get('code') in ('PARTY_ACCOUNT', 'VALIDATION_ERROR') and bb.get('code') == 'PARTY_BIZNO' and mem.get('_err') == 403
           and row == f'{biz}|1234' and any(x.get('id') == p1.get('id') for x in lst.get('items') or []) and (dt.get('party') or {}).get('id') == p1.get('id')
           and cl.get('ok') is True and st == 'CLOSED' and 'ACCT_PARTY' in delp,
           f"{p1} · {dup.get('code')} · {b4.get('code')} · {bb.get('code')} · {mem.get('_err')} · {row} · {len(lst.get('items') or [])} · {(dt.get('party') or {}).get('id')} · {cl.get('ok')} {st} · {delp[-40:]}")
        i1 = call('POST', '/admin/acct/parties/import', None, TS)
        i2 = call('POST', '/admin/acct/parties/import', None, TS)
        ip = call('POST', '/admin/acct/parties/import', None, TP)
        dupadv = psql("SELECT count(*) FROM (SELECT advertiser_id FROM acct_parties WHERE advertiser_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x")
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'ACCT_PARTY_IMPORT' AND occurred_at > now() - interval '10 minutes'")
        ok('③ 가져오기 — SUPER 만(지급 담당 403) · 두 번째는 0곳(다시 눌러도 같음) · 광고주 겹침 없음 · 감사',
           i1.get('ok') is True and i2.get('made') == 0 and ip.get('_err') == 403 and dupadv == '0' and int(aud or 0) >= 1,
           f"{i1.get('made')} · {i2.get('made')} · {ip.get('_err')} · {dupadv} · {aud}")
    finally:
        rm_role(pid, '1408')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-parties]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-parties]').count()
            pg.click('[data-acct-party-new]'); pg.wait_for_timeout(500)
            seen['form'] = pg.locator('[data-acct-party-form]').count()
            seen['imp'] = pg.locator('[data-acct-party-import]').count()
        res = admin_page('/#/acct-parties', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 거래처 · 넣기 칸 · 가져오기 단추(SUPER) · 화면 오류 없음', seen.get('sec') == 1 and seen.get('form') == 1 and seen.get('imp') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
