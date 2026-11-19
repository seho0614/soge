"""v10.432 (D255 · docs/569) 홈택스 매입 세금계산서 가져오기 — 연동 업체 어댑터(처음 간주) · acct_tax_inbox · 매입으로 넘기기
  ① (코드) D255 acct_tax_inbox(승인번호 UNIQUE · 쌓기만 · 상태 앞으로만) · 가져오기 기록 · 설정 3 · 정기 작업 · 외부 연동 TAXINBOX(키 · 목록 · .env 예시) · API 4 · 감사 · 화면 · 문서 569 · 판 v10.432
  ② (API · DB) 꺼짐 422 · 켜고 간주 가져오기(2번 돌려도 같은 줄) · 기간 31일 넘음 422 · 매입으로(면세는 불공제) · 같은 매입 409 · force · 넘기지 않음(사유) · 처리한 줄 409 · 내용 고치기 · 지우기 DB 막음 · 회원 403 · LIVE 인데 키 없음 422
  이카운트 연동은 보류(대표 11/19) — 이 시험에 없음.
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


M50 = migr('D250_')
RC, RD, RP, WL, RS = rd('src/modules/admin/report.controller.ts'), rd('src/modules/admin/report-day.ts'), rd('src/modules/admin/report-period.ts'), rd('src/modules/admin/worklog.ts'), rd('src/modules/admin/report-send.ts')
UI, AP, MN, SC, WK, AM = rd('web/src/app/admin/Report.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')

ok('① 코드 — D250 report_sends · report.send off · send_kinds · sendSnapshot(텔레그램 · 슬랙 · 메일) · sendAfterJob · API · 감사 · 화면 · 문서 552 · 판 v10.415',
   'CREATE TABLE IF NOT EXISTS public.report_sends' in M50 and "('report.send', 'off'" in M50 and "'report.send_kinds'" in M50
   and 'export async function sendSnapshot' in RS and 'export async function sendAfterJob' in RS and 'telegram.send' in RS and 'slack.send' in RS and 'mail.send' in RS
   and "@Audit('REPORT_SEND', 'SETTING')" in RC and "@Audit('REPORT_SETTING', 'SETTING')" in RC and 'data-rpt-settings=' in UI and 'data-rpt-send=' in UI
   and '보내기' in doc('552_') and VT >= (10, 415), VER)


M55 = migr('D255_')
TI, AC, MN, AP, UI = rd('src/modules/acct/taxinbox.ts'), rd('src/modules/acct/acct.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Acct.tsx')
RG, SS, EV, SC, WK = rd('src/common/integration/registry.ts'), rd('src/common/integration/secret.service.ts'), rd('deploy/aws/env.production.example'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 코드 — D255 acct_tax_inbox(UNIQUE · 가드) · 기록 · 설정 3 · 정기 작업 · 외부 연동 TAXINBOX(목록 · 키 · .env 예시) · 어댑터(간주 · 업체) · API 4 · 감사 · 화면 · 메뉴 · 명세 · 문서 569 · 판 v10.432',
   'CREATE TABLE IF NOT EXISTS public.acct_tax_inbox' in M55 and 'approval_no      text NOT NULL UNIQUE' in M55 and 'TAXINBOX_LOCKED' in M55 and 'acct_tax_inbox_fetches' in M55
   and "('acct.taxinbox', 'off'" in M55 and "'acct.taxinbox_mode', 'ASSUME'" in M55 and "'acct_taxinbox'" in M55 and "('TAXINBOX','TAXINBOX_API_KEY')" in M55
   and 'class AssumeTaxInbox' in TI and 'class HttpTaxInbox' in TI and 'export async function bookInbox' in TI and "code: 'TAXINBOX'" in RG and "name: 'TAXINBOX_API_KEY'" in SS
   and 'TAXINBOX_API_KEY=' in EV and "@Audit('ACCT_TAXINBOX_BOOK', 'SETTING')" in AC and "@Post('tax-inbox/fetch')" in AC and "case 'acct_taxinbox':" in SC and "'acct_taxinbox'," in WK
   and 'export function AcctTaxInbox' in UI and "'acct-taxinbox'" in MN and "'acct-taxinbox'" in AP and '"SB-ADM-ACC-350"' in SJ and '연동 업체' in doc('569_') and VT >= (10, 432), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    s0 = {k: getset(k) for k in ('acct.taxinbox', 'acct.taxinbox_mode')}
    t0 = psql("SELECT coalesce(max(id), 0) FROM acct_tax_inbox")
    p0 = psql("SELECT coalesce(max(id), 0) FROM acct_purchases")
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    to = kst.strftime('%Y-%m-%d'); fr = (kst - datetime.timedelta(days=12)).strftime('%Y-%m-%d'); far = (kst - datetime.timedelta(days=60)).strftime('%Y-%m-%d')
    try:
        setting('acct.taxinbox', 'off', '1432')
        off = call('POST', '/admin/acct/tax-inbox/fetch', {}, TS)
        setting('acct.taxinbox', 'on', '1432'); setting('acct.taxinbox_mode', 'ASSUME', '1432')
        f1 = call('POST', '/admin/acct/tax-inbox/fetch', {'from': fr, 'to': to}, TS)
        f2 = call('POST', '/admin/acct/tax-inbox/fetch', {'from': fr, 'to': to}, TS)
        long_ = call('POST', '/admin/acct/tax-inbox/fetch', {'from': far, 'to': to}, TS)
        byb = call('GET', '/admin/acct/tax-inbox', None, TB)
        rows = psql(f"SELECT id || '|' || exempt || '|' || state FROM acct_tax_inbox WHERE id > {int(t0 or 0)} AND source = 'ASSUME' ORDER BY id")
        ids = [r.split('|') for r in rows.split('\n') if r and '|' in r]
        tax = next((x[0] for x in ids if x[1] == 'f' and x[2] == 'NEW'), None); ex = next((x[0] for x in ids if x[1] == 't' and x[2] == 'NEW'), None)
        bk = call('POST', f'/admin/acct/tax-inbox/{tax}/book', {'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}, TS) if tax else {}
        again = call('POST', f'/admin/acct/tax-inbox/{tax}/book', {'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}, TS) if tax else {}
        pur = psql(f"SELECT deductible || '|' || kind || '|' || total FROM acct_purchases WHERE id = {int(bk.get('purchaseId') or 0)}")
        bx = call('POST', f'/admin/acct/tax-inbox/{ex}/book', {'accountRole': 'EXP_SUPPLIES', 'payRole': 'CASH'}, TS) if ex else {}
        pex = psql(f"SELECT deductible FROM acct_purchases WHERE id = {int(bx.get('purchaseId') or 0)}")
        # 같은 매입 409 — 이미 넘긴 줄과 같은 공급자 · 날짜 · 합계의 다른 줄을 하나 만들어 봄(승인번호만 다름)
        dupid = psql(f"INSERT INTO acct_tax_inbox (approval_no, issued_on, supplier_biz_no, supplier_name, item, supply, vat, exempt, source, provider, row_hash) "
                     f"SELECT lpad((99000000000000000000000 + {int(time.time()) % 1000000})::text, 24, '9'), issued_on, supplier_biz_no, supplier_name, item, supply, vat, exempt, 'ASSUME', 'GENERIC', repeat('a', 64) "
                     f"FROM acct_tax_inbox WHERE id = {int(tax or 0)} RETURNING id").split('\n')[0]
        d409 = call('POST', f'/admin/acct/tax-inbox/{dupid}/book', {'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}, TS) if dupid.isdigit() else {}
        ig = call('POST', f'/admin/acct/tax-inbox/{dupid}/ignore', {'note': '시험 1432 같은 건'}, TS) if dupid.isdigit() else {}
        ig0 = call('POST', f'/admin/acct/tax-inbox/{dupid}/ignore', {'note': '시험 1432 두 번'}, TS) if dupid.isdigit() else {}
        upd = psql(f"UPDATE acct_tax_inbox SET supply = supply + 1 WHERE id = {int(tax or 0)}")
        dele = psql(f"DELETE FROM acct_tax_inbox WHERE id = {int(tax or 0)}")
        setting('acct.taxinbox_mode', 'LIVE', '1432')
        live = call('POST', '/admin/acct/tax-inbox/fetch', {}, TS)
        lst = call('GET', f"/admin/acct/tax-inbox?ym={to[:7]}", None, TS)
        ok('② 가져오기 — 꺼짐 422 · 간주 가져오기 · 두 번째는 새로 0 · 31일 넘음 422 · 회원 403 · 매입으로(세금계산서 · 공제) · 두 번 409 · 면세는 불공제 · 같은 매입 409 · 넘기지 않음 · 처리한 줄 409 · 내용 고치기 · 지우기 DB 막음 · LIVE 키 없음 422 · 목록 상태',
           off.get('code') == 'TAXINBOX_OFF' and f1.get('ok') is True and int(f1.get('got') or 0) >= 2 and f2.get('ok') is True and int(f2.get('added') or 0) == 0 and int(f2.get('dup') or 0) == int(f1.get('got') or -1)
           and long_.get('code') == 'TAXINBOX_PERIOD' and byb.get('_err') == 403 and bk.get('ok') is True and again.get('code') == 'TAXINBOX_STATE'
           and pur.startswith('true|TAX_INVOICE|') and bx.get('ok') is True and pex == 'f' and d409.get('code') == 'TAXINBOX_DUP' and ig.get('ok') is True and ig0.get('code') == 'TAXINBOX_STATE'
           and 'TAXINBOX_LOCKED' in upd and 'TAXINBOX_LOCKED' in dele and live.get('code') == 'TAXINBOX_NOT_READY' and lst.get('status', {}).get('mode') == 'LIVE' and isinstance(lst.get('items'), list),
           f"{off.get('code')} · {f1.get('got')} {f1.get('added')} · {f2.get('added')} {f2.get('dup')} · {long_.get('code')} {byb.get('_err')} · {bk.get('ok') or bk.get('code')} {again.get('code')} · {pur} · {bx.get('ok') or bx.get('code')} {pex} · {d409.get('code')} {ig.get('ok')} {ig0.get('code')} · {upd[-25:]} {dele[-25:]} · {live.get('code')}")
    finally:
        for k, v in s0.items(): setting(k, v or None, '1432 되돌림')
        # 시험 줄 · 넘긴 매입 정리(회사 장부에 간주 매입이 남지 않게) — 쌓기만 표라 replica 로
        psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('PURCHASE', 'PURCHASE_CANCEL') AND source_key IN (SELECT id::text FROM acct_purchases WHERE id > {int(p0 or 0)} AND memo LIKE '전자세금계산서 %')); "
             f"DELETE FROM acct_entries WHERE source IN ('PURCHASE', 'PURCHASE_CANCEL') AND source_key IN (SELECT id::text FROM acct_purchases WHERE id > {int(p0 or 0)} AND memo LIKE '전자세금계산서 %'); "
             f"DELETE FROM acct_tax_inbox WHERE id > {int(t0 or 0)}; DELETE FROM acct_purchases WHERE id > {int(p0 or 0)} AND memo LIKE '전자세금계산서 %'; "
             f"DELETE FROM acct_tax_inbox_fetches WHERE created_at >= now() - interval '1 hour' AND created_by = (SELECT id FROM accounts WHERE email = 'admin@x.com');")
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-taxinbox]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-taxinbox]').count(); seen['fetch'] = pg.locator('[data-acct-taxinbox-fetch]').count()
            seen['status'] = pg.locator('[data-acct-taxinbox-status]').count()
        res = admin_page('/#/acct-taxinbox', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 회계 › 세금계산서 받기 · 가져오기 단추 · 상태 줄 · 화면 오류 없음',
               seen.get('sec') == 1 and seen.get('fetch') == 1 and seen.get('status') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
