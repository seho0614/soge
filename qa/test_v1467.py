"""v10.467 (D264 · docs/605) 은행 거래내역 자동 조회 — 금융결제원 어댑터(FIRMBANK) 재사용 · 처음 꺼짐 · 간주 · 은행 맞추기로 들여옴
  ① (코드) D264 계좌(암호문 · 지문) · 기록 · 설정 · 정기 작업 acct_bank_feed · 사용자 토큰 키 · 어댑터(간주 · KFTC 거래내역조회) · 외부 연동 15종 그대로 · 화면 SAL-020 · 문서 605
  ② (API · DB) 회원 403 · 등록 · 겹침 422 · 은행 코드 400 · 꺼짐 422 · 간주 2줄 · 다시 조회 이미 있음 2 · 기간 422 · LIVE 키 없음 422 · 정기 작업 · DB 막음 · 끄기 · 권한 주소 4
  ③ (화면) 회계 › 은행 자동 조회
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


M64 = migr('D264_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')

BF, SC_, RG, SS, EV, VI, SCH, WK, UI, MN = (rd('src/modules/acct/bankfeed.ts'), rd('src/modules/acct/sales.controller.ts'), rd('src/common/integration/registry.ts'), rd('src/common/integration/secret.service.ts'),
                                           rd('deploy/aws/env.production.example'), rd('scripts/verify-invariants.sh'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'),
                                           rd('web/src/app/admin/Sales.tsx'), rd('web/src/lib/adminMenu.ts'))
ok('① 코드 — D264 자동 조회 계좌(핀테크이용번호 암호문 · 지문 UNIQUE · 끝 4자리) · 기록(쌓기만) · 설정 acct.bank_feed off · ASSUME · 정기 작업 06:40 · 받는 키 FIRMBANK_USER_TOKEN(CHECK · 함수) · 어댑터 간주 · KFTC 거래내역조회 · 은행 맞추기에 들여옴(같은 줄 · CSV 줄 건너뜀) · 외부 연동 FIRMBANK 재사용(15종 그대로) · 화면 SAL-020 · 문서 605 · 판 v10.467',
   'CREATE TABLE IF NOT EXISTS public.acct_bank_feed_accounts' in M64 and 'fintech_enc   bytea NOT NULL' in M64 and 'trg_acct_bank_feed_runs_ro' in M64 and "('acct.bank_feed', 'off'" in M64
   and "('acct.bank_feed_mode', 'ASSUME'" in M64 and "('acct_bank_feed', 1440, 6, 40" in M64 and "('FIRMBANK','FIRMBANK_USER_TOKEN')" in M64 and "'FIRMBANK_CLIENT_SECRET', 'FIRMBANK_USER_TOKEN') THEN" in M64
   and 'export class AssumeBankFeed' in BF and 'export class KftcBankFeed' in BF and "'/v2.0/account/transaction_list/fin_num'" in BF and 'INSERT INTO acct_bank_txns' in BF and "hashtext('acct_bank_upload')" in BF
   and "'src/modules/acct/bankfeed.ts'" in RG and "'FIRMBANK_USER_TOKEN'" in RG and "name: 'FIRMBANK_USER_TOKEN'" in SS and 'FIRMBANK_USER_TOKEN=' in EV and bool(re.search(r'if \[ "\$n" = "1[5-9]" \]', VI))   # v10.483 GEOIP · v10.498 SOCIAL 로 늘어도 받음
   and "case 'acct_bank_feed':" in SCH and "'acct_bank_feed'," in WK and "@Post('acct/bank-feed/run')" in SC_ and 'export function AcctBankFeed' in UI and "['acct-bankfeed', '은행 자동 조회']" in MN
   and '"SB-ADM-SAL-020"' in SJ and '금융결제원' in doc('605_') and VT >= (10, 467), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    s0 = {k: getset(k) for k in ('acct.bank_feed', 'acct.bank_feed_mode')}
    aid = ''
    fin = ('19' + f'{stamp:06d}' + str(int(time.time() * 1000))[-16:]).ljust(24, '7')[:24]
    try:
        setting('acct.bank_feed', 'off', '1467'); setting('acct.bank_feed_mode', 'ASSUME', '1467')
        mb = call('GET', '/admin/acct/bank-feed', None, TB)
        ad = call('POST', '/admin/acct/bank-feed/accounts', {'label': f'시험 1467-{stamp}', 'bankStd': '003', 'fintechNum': fin, 'last4': '1467'}, TS); aid = str(ad.get('id') or '')
        dup = call('POST', '/admin/acct/bank-feed/accounts', {'label': f'시험 1467 겹침-{stamp}', 'bankStd': '003', 'fintechNum': fin, 'last4': '1467'}, TS)
        badb = call('POST', '/admin/acct/bank-feed/accounts', {'label': '시험 1467 은행', 'bankStd': '03', 'fintechNum': fin, 'last4': '1467'}, TS)
        enc = psql(f"SELECT (position(convert_to('{fin}', 'UTF8') in fintech_enc) = 0)::text || '|' || acct_last4 FROM acct_bank_feed_accounts WHERE id = {int(aid or 0)}")
        off = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid}, TS)
        setting('acct.bank_feed', 'on', '1467')
        r1 = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid}, TS)
        r2 = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid}, TS)
        rng = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid, 'from': '2026-01-01', 'to': today}, TS)
        ups = psql(f"SELECT coalesce(string_agg(upload_id::text, ','), '') FROM acct_bank_feed_runs WHERE account_id = {int(aid or 0)} AND upload_id IS NOT NULL")
        tx = psql(f"SELECT count(*) || '|' || count(DISTINCT row_hash) || '|' || coalesce(sum(deposit), 0) || '|' || coalesce(sum(withdraw), 0) FROM acct_bank_txns WHERE upload_id IN ({ups or '0'})")
        setting('acct.bank_feed_mode', 'LIVE', '1467')
        live = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid}, TS)
        setting('acct.bank_feed_mode', 'ASSUME', '1467')
        jb = call('POST', '/admin/jobs', {'job': 'acct_bank_feed'}, TS)
        runs = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE run_by IS NULL) FROM acct_bank_feed_runs WHERE account_id = {int(aid or 0)}")
        dbu = psql(f"UPDATE acct_bank_feed_accounts SET bank_std = '004' WHERE id = {int(aid or 0)}")
        dbr = psql(f"UPDATE acct_bank_feed_runs SET rows_added = 9 WHERE account_id = {int(aid or 0)}")
        offa = call('PUT', f'/admin/acct/bank-feed/accounts/{aid}', {'active': False}, TS)
        r3 = call('POST', '/admin/acct/bank-feed/run', {'accountId': aid}, TS)
        vw = call('GET', '/admin/acct/bank-feed', None, TS)
        acc = next((x for x in vw.get('accounts') or [] if x.get('id') == aid), {})
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'acct-bankfeed'")
        ok('② 자동 조회 — 회원 403 · 계좌 등록(암호문 · 끝 4자리) · 같은 번호 422 · 은행 코드 400 · 꺼짐 422 · 간주 2줄 들여옴(새로 2) · 다시 조회 = 이미 있음 2 · 기간 31일 넘음 422 · 들여온 줄 2(지문 겹침 없음 · 입금 1 · 출금 3,000) · LIVE 키 없음 422 · 정기 작업 기록(누가 비움) · DB 가 은행 바꾸기 · 기록 고치기 막음 · 끄면 422 · 화면은 끝 4자리 · 권한 주소 4',
           mb.get('_err') == 403 and ad.get('ok') is True and dup.get('code') == 'BANK_FEED_DUP' and badb.get('_err') == 400 and enc == 'true|1467' and off.get('code') == 'BANK_FEED_OFF'
           and r1.get('added') == 2 and r1.get('dup') == 0 and r2.get('added') == 0 and r2.get('dup') == 2 and rng.get('code') == 'BANK_FEED_RANGE'
           and tx.split('|')[:2] == ['2', '2'] and tx.split('|')[3] == '3000' and live.get('code') == 'BANK_FEED_NOT_READY'
           and runs.split('|')[0] == '3' and runs.split('|')[1] == '1' and 'ACCT_BANK_FEED' in dbu and '!' in dbr and offa.get('active') is False
           and r3.get('code') == 'BANK_FEED_NO_ACCOUNT' and acc.get('account') == '****1467' and 'fintech' not in json.dumps(acc) and rmap == '4',
           f"{mb.get('_err')} {ad.get('ok') or ad} {dup.get('code')} {badb.get('_err')} {enc} {off.get('code')} · {r1.get('added')}/{r1.get('dup')} {r2.get('added')}/{r2.get('dup')} {rng.get('code')} · {tx} · {live.get('code')} · {jb.get('affected')} {runs} · {dbu[-30:]} {dbr[-20:]} · {offa.get('active')} {r3.get('code')} {acc.get('account')} · {rmap}")
    finally:
        if aid.isdigit():
            ups = psql(f"SELECT coalesce(string_agg(upload_id::text, ','), '') FROM acct_bank_feed_runs WHERE account_id = {aid} AND upload_id IS NOT NULL")
            psql(f"SET session_replication_role = replica; DELETE FROM acct_bank_txns WHERE upload_id IN ({ups or '0'}); DELETE FROM acct_bank_feed_runs WHERE account_id = {aid}; "
                 f"DELETE FROM acct_bank_uploads WHERE id IN ({ups or '0'}); DELETE FROM ops_alerts WHERE alert_code = 'ACCT_BANK_FEED_FAIL' AND detail->>'account' = '{aid}'; DELETE FROM acct_bank_feed_accounts WHERE id = {aid};")
        for k, x in s0.items():
            setting(k, x or None, '1467 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/acct-bankfeed', lambda pg, seen: seen.update(n=pg.locator('[data-acct-bankfeed]').count(), on=pg.locator('[data-acct-bankfeed-on]').get_attribute('data-acct-bankfeed-on') if pg.locator('[data-acct-bankfeed-on]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 은행 자동 조회(켜짐 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('on') in ('on', 'off') and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
