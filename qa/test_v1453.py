"""v10.453 (D261 · docs/590) 법인카드 한도 · 사용자별 사용
  ① (코드) D261 한도 표 · 바꾼 기록(쌓기만) · 설정 · 정기 작업 acct_card_limit · FinController · 화면 · 문서 590
  ② (API · DB) 끝 4자리 아님 422 · 지급 담당 정하기 403 · SUPER 넣기 · 85% 기준 넘음 · 사람별 합 · 알림 → 한도 넘음 알림 · 기록 고치기 DB 막음
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


M61 = migr('D261_')
CL, FC, UI, AP, MN, SC, WK, AM = (rd('src/modules/acct/cardlimit.ts'), rd('src/modules/acct/fin.controller.ts'), rd('web/src/app/admin/Fin.tsx'), rd('web/src/App.tsx'),
                                  rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')

ok('① 코드 — D261 acct_card_limits · 바꾼 기록(쌓기만) · 설정 acct.card_alert · 80% · 정기 작업 acct_card_limit 09:40 · FinController · 화면 FinCardLimits · 메뉴 · 화면 목록 FIN-010 · 문서 590 · 판 v10.453',
   'CREATE TABLE IF NOT EXISTS public.acct_card_limits' in M61 and 'trg_acct_card_limit_changes_ro' in M61 and "('acct.card_alert_pct', '80'" in M61 and "('acct_card_limit', 1440, 9, 40" in M61
   and 'export async function acctCardLimitJob' in CL and "case 'acct_card_limit':" in SC and "'acct_card_limit'," in WK and 'FinController' in AM and "@Put('acct/card-limits/:tail')" in FC
   and 'export function FinCardLimits' in UI and "['acct-cardlimit', '법인카드 한도']" in MN and "{tab === 'acct-cardlimit' && <FinCardLimits />}" in AP and '"SB-ADM-FIN-010"' in SJ
   and '법인카드 한도' in doc('590_') and VT >= (10, 453), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1453', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    tail = str(9000 + stamp % 1000)
    s0 = {k: getset(k) for k in ('acct.card_alert', 'acct.card_alert_pct')}
    up = ''
    try:
        setting('acct.card_alert', 'on', '1453'); setting('acct.card_alert_pct', '80', '1453')
        up = psql("INSERT INTO acct_card_uploads (filename, card, rows_total, rows_added, rows_dup, rows_bad) VALUES ('t1453.csv', 't1453', 2, 2, 0, 0) RETURNING id").split('\n')[0]
        def txn(amt, n):
            return psql(f"INSERT INTO acct_card_txns (upload_id, used_on, merchant, amount, card_tail, row_hash) VALUES ({int(up)}, '{today}', '시험 1453 가맹점', {amt}, '{tail}', md5('t1453-{stamp}-{n}') || md5('x{n}'))")
        txn(600000, 1); txn(250000, 2)
        bad = call('PUT', '/admin/acct/card-limits/abcde', {'name': '시험', 'monthlyLimit': 1000, 'reason': '시험 1453'}, TS)
        byp = call('PUT', f'/admin/acct/card-limits/{tail}', {'name': f'시험카드{tail}', 'monthlyLimit': 1000000, 'reason': '시험 1453'}, TP)
        s1 = call('PUT', f'/admin/acct/card-limits/{tail}', {'name': f'시험카드{tail}', 'holderId': pid, 'monthlyLimit': 1000000, 'reason': '시험 1453 넣음'}, TS)
        v = call('GET', f'/admin/acct/card-limits?ym={ym}', None, TP)
        row = next((x for x in v.get('items') or [] if x.get('tail') == tail), {})
        hold = next((x for x in v.get('holders') or [] if x.get('holderId') == pid), {})
        jb = call('POST', '/admin/jobs', {'job': 'acct_card_limit'}, TS)
        al1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CARD_LIMIT' AND detail->>'tail' = '{tail}' AND detail->>'ym' = '{ym}'")
        txn(200000, 3)
        jb2 = call('POST', '/admin/jobs', {'job': 'acct_card_limit'}, TS)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'ACCT_CARD_LIMIT' AND detail->>'tail' = '{tail}' AND detail->>'ym' = '{ym}'")
        v2 = call('GET', f'/admin/acct/card-limits?ym={ym}', None, TS)
        row2 = next((x for x in v2.get('items') or [] if x.get('tail') == tail), {})
        ch = psql(f"SELECT count(*) FROM acct_card_limit_changes WHERE card_tail = '{tail}'")
        ro = psql(f"UPDATE acct_card_limit_changes SET reason = '바꿈' WHERE card_tail = '{tail}'")
        ok('② 한도 — 끝 4자리 아님 422 · 지급 담당 정하기 403 · SUPER 넣기 · 85% 기준 넘음 · 쓰는 사람별 합 · 알림 1 → 한도 넘음 알림 2 · 바꾼 기록 1 · 기록 고치기 DB 막음',
           bad.get('code') == 'CARD_TAIL' and byp.get('_err') == 403 and s1.get('ok') is True and s1.get('created') is True
           and row.get('used') == 850000 and row.get('pct') == 85.0 and row.get('level') == 'NEAR' and hold.get('used', 0) >= 850000 and v.get('canEdit') is False
           and jb.get('_err') is None and al1 == '1' and jb2.get('_err') is None and al2 == '2' and row2.get('level') == 'OVER' and v2.get('canEdit') is True and ch == '1' and '!' in ro,
           f"{bad.get('code')} {byp.get('_err')} {s1.get('created')} · {row.get('used')} {row.get('pct')} {row.get('level')} · {hold.get('used')} · {jb.get('_err')} {al1} {al2} {row2.get('level')} · {ch} {ro[-40:]}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'ACCT_CARD_LIMIT' AND detail->>'tail' = '{tail}'; "
             f"DELETE FROM acct_card_limit_changes WHERE card_tail = '{tail}'; DELETE FROM acct_card_limits WHERE card_tail = '{tail}'; "
             + (f"DELETE FROM acct_card_txns WHERE upload_id = {int(up)}; DELETE FROM acct_card_uploads WHERE id = {int(up)};" if up.isdigit() else ''))
        for k, x in s0.items():
            setting(k, x or None, '1453 되돌림')
        rm_role(pid, '1453')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
