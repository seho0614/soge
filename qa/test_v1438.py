"""v10.438 (D257 · docs/575) 영수증 사진 자동 입력 — AI 통로 RECEIPT · 간주 · 칸 채움 제안(저장 안 함)
  ① (코드) AI 통로 RECEIPT(fn_agent_allowed · 사용 기록 CHECK) · 설정 2 · 읽은 기록 표(쌓기만) · 그림 조각 · readReceipt · parseGuess · API 2 · 화면 · 문서 575
  ② (API · DB) 꺼짐 422 · 간주 읽기(공급가 + 부가세 = 합계 · 기록 1줄) · 없는 파일 404 · 회원 403 · 되돌림
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

M57 = migr('D257_')
AX, AU, AM, AR, RA = rd('src/modules/acct/acct-extra.controller.ts'), rd('src/modules/acct/accountant.ts'), rd('src/modules/acct/accrual.ts'), rd('src/modules/acct/archive.ts'), rd('src/modules/acct/receipt-ai.ts')
UI, AP, MN, SC, WK, APM = rd('web/src/app/admin/AcctExtra.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('src/app.module.ts')
AUTH, PRN, MID, RPS, EXA, SRC = rd('src/core/auth.ts'), rd('src/modules/identity/principal.service.ts'), rd('src/modules/identity/auth.middleware.ts'), rd('src/modules/site/report.service.ts'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/acct/sources.ts')
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
stamp = int(time.time()) % 1000000

AS_, PV = rd('src/modules/agent/agent.service.ts'), rd('src/modules/agent/agent.provider.ts')
ok('① 코드 — D257 RECEIPT 통로 · acct.receipt_ai(off) · _mode(ASSUME) · acct_receipt_reads(쌓기만) · 그림 조각 · readReceipt · API 2 · 화면 · 메뉴 · 문서 575 · 판 v10.438',
   "WHEN 'RECEIPT' THEN 'acct.receipt_ai'" in M57 and "'TOWN_PICK','RECEIPT'" in M57 and "('acct.receipt_ai', 'off'" in M57 and 'CREATE TABLE IF NOT EXISTS public.acct_receipt_reads' in M57
   and "| 'RECEIPT'" in AS_ and "type: 'image'" in PV and 'export async function readReceipt' in RA and 'export function parseGuess' in RA
   and "@Post('receipt-ai/read')" in AX and 'export function ReceiptReader' in UI and "'acct-receipt'" in MN and '"SB-ADM-ACC-430"' in SJ and '영수증' in doc('575_') and VT >= (10, 438), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1438', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    s0, m0 = getset('acct.receipt_ai'), getset('acct.receipt_ai_mode')
    fid = None
    try:
        setting('acct.receipt_ai', 'off', '1438')
        png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b'\x00\x00\x00\rIHDR' + os.urandom(600)
        t = call('POST', '/files', {'purpose': 'ACCT_EVIDENCE', 'name': f'영수증1438-{stamp}.png', 'contentType': 'image/png', 'size': len(png)}, TP)
        fid = t.get('fileId')
        origin = API.rsplit('/api/v1', 1)[0]
        url = t.get('uploadUrl') or ''
        if url: raw(t.get('method') or 'PUT', (origin + url) if url.startswith('/') else url, png, (t.get('headers') or {}).get('Content-Type', 'image/png'))
        call('POST', f"/files/{fid}/complete", None, TP)
        off = call('POST', '/admin/acct/receipt-ai/read', {'fileId': fid}, TP)
        setting('acct.receipt_ai', 'on', '1438'); setting('acct.receipt_ai_mode', 'ASSUME', '1438')
        r1 = call('POST', '/admin/acct/receipt-ai/read', {'fileId': fid}, TP)
        g = r1.get('guess') or {}
        nf = call('POST', '/admin/acct/receipt-ai/read', {'fileId': '00000000-0000-4000-8000-000000000000'}, TP)
        mb = call('POST', '/admin/acct/receipt-ai/read', {'fileId': fid}, TB)
        rd_ = call('GET', f'/admin/acct/receipt-ai/reads?fileId={fid}', None, TP)
        n = psql(f"SELECT count(*) FROM acct_receipt_reads WHERE file_id = '{fid}'")
        ok('② 영수증 읽기 — 꺼짐 422 · 간주 읽기(간주 · 공급가 + 부가세 = 합계 · 카드) · 없는 파일 404 · 회원 403 · 기록(화면 · DB)',
           off.get('code') == 'RECEIPT_AI_OFF' and r1.get('ok') is True and r1.get('assumed') is True and g.get('supply', 0) + g.get('vat', 0) == g.get('total', -1) and g.get('kind') == 'CARD'
           and nf.get('_err') == 404 and mb.get('_err') == 403 and len(rd_.get('items') or []) >= 1 and int(n or 0) == 1,
           f"{off.get('code')} · {r1.get('ok')} {r1.get('assumed')} {g} · {nf.get('_err')} {mb.get('_err')} · {len(rd_.get('items') or [])} {n}")
    finally:
        setting('acct.receipt_ai', s0 or 'off', '1438'); setting('acct.receipt_ai_mode', m0 or 'ASSUME', '1438')
        if fid:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_receipt_reads WHERE file_id = '{fid}'; UPDATE files SET status = 'DELETED', deleted_at = now() WHERE id = '{fid}';")
        rm_role(pid, '1438')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
