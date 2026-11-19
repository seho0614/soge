"""v10.389 (D244 · docs/526) 전표 CSV 양식 맞춤
  ① (코드) D244 양식 표 · 칸 목록 · 검사 · API · 화면 · 문서
  ② (API) 처음 「일반 양식」 = 옛 머리줄 · 새 양식(구분 + 금액 · YYYYMMDD) 미리보기 · 저장 · 같은 이름 409 · 틀린 칸 422 · ADMIN 403 · 내려받기에 양식 · 기본은 하나
  ③ (화면) 회계 › 계정 · 규칙 › 전표 CSV 양식
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


M44 = rd('prisma/migrations/D244_acct_bank_format_deadline_etax/migration.sql')
AC, RP, UI, AP, MN = rd('src/modules/acct/acct.controller.ts'), rd('src/modules/acct/acct-reports.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts')
FM = rd('src/modules/acct/formats.ts')
OLD_HEAD = '일자,전표번호,줄,계정코드,계정명,차변,대변,거래처,적요,증빙,근거'
ok('① 코드 — D244 양식 표(기본 하나 · 일반 양식) · 칸 목록 · 검사(두 칸 · 구분 + 금액) · API 4 · 내려받기 format · 감사 · 화면 · 문서 526 · 판 v10.389',
   'CREATE TABLE IF NOT EXISTS public.acct_export_formats' in M44 and 'uq_aef_default' in M44 and "'일반 양식'" in M44
   and 'export const FIELDS' in FM and 'export function checkFormat' in FM and 'export function renderRows' in FM
   and "@Get('formats')" in AC and "@Post('formats')" in AC and "@Patch('formats/:id')" in AC and "@Post('formats/preview')" in AC and "@Audit('ACCT_FORMAT_SET', 'SETTING')" in AC
   and "@Query('format') format?: string" in AC and 'export function AcctFormats' in UI and '<AcctFormats />' in UI and 'data-acct-format=' in UI
   and '양식' in doc('526_') and VT >= (10, 389), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pe, pid = mk_staff('1389', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    ae, aid = mk_staff('1389a', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    ym, d0 = kst.strftime('%Y-%m'), kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    nm = f'시험양식1389-{stamp}'
    cols = [{'field': 'date', 'title': '전표일자'}, {'field': 'code', 'title': '계정'}, {'field': 'dc', 'title': '구분'}, {'field': 'amount', 'title': '금액'}, {'field': 'memo', 'title': '적요'}, {'field': 'blank', 'title': '비고'}]
    body = {'name': nm, 'columns': cols, 'dateStyle': 'YYYYMMDD', 'dcStyle': 'SIGN', 'dcDebit': '1', 'dcCredit': '2'}
    gen = psql("SELECT id FROM acct_export_formats WHERE name = '일반 양식'")
    try:
        f0 = call('GET', '/admin/acct/formats', None, TP)
        g = next((x for x in f0.get('items') or [] if x.get('name') == '일반 양식'), {})
        pv = call('POST', '/admin/acct/formats/preview', body, TP)
        new = call('POST', '/admin/acct/formats', body, TS)
        dup = call('POST', '/admin/acct/formats', body, TS)
        badf = call('POST', '/admin/acct/formats', {**body, 'name': nm + 'x', 'columns': [{'field': 'date'}, {'field': 'nope'}]}, TS)
        badd = call('POST', '/admin/acct/formats', {**body, 'name': nm + 'y', 'columns': [{'field': 'date'}, {'field': 'code'}, {'field': 'debit'}]}, TS)
        byadmin = call('POST', '/admin/acct/formats', {**body, 'name': nm + 'z'}, TA)
        # 내려받기 — 이번 달 전표가 하나는 있게
        adv = call('POST', '/admin/advertisers', {'code': f'ADV-1389-{stamp}', 'name': f'시험광고1389 {stamp}'}, TS)
        call('POST', '/admin/ad-invoices', {'advertiserId': adv.get('id'), 'periodFrom': d0, 'periodTo': d0, 'amount': 20000, 'dueDate': d0, 'memo': '시험 1389'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        tk = __import__('export_ticket').get(TP, 'ACCT_JOURNAL', TS)
        ex = call('GET', f"/admin/acct/journal/export?ym={ym}&ticket={tk}&format={new.get('id')}", None, TP) if tk and new.get('id') else {}
        tk2 = __import__('export_ticket').get(TP, 'ACCT_JOURNAL', TS)
        ex0 = call('GET', f"/admin/acct/journal/export?ym={ym}&ticket={tk2}", None, TP) if tk2 else {}
        lines = (ex.get('csv') or '').lstrip('﻿').split('\r\n')
        mk = call('PATCH', f"/admin/acct/formats/{new.get('id')}", {**body, 'isDefault': True}, TS)
        defs = psql("SELECT count(*) FILTER (WHERE is_default) || '|' || coalesce(max(name) FILTER (WHERE is_default), '') FROM acct_export_formats")
        ok('② 양식 — 일반 양식 = 옛 머리줄 · 미리보기(YYYYMMDD · 구분 1/2 · 금액) · 저장 · 같은 이름 409 · 모르는 칸 422 · 두 칸 방식인데 대변 없음 422 · ADMIN 403 · 고른 양식으로 내려받기 · 기본 양식(비움) = 옛 머리줄 · 기본으로 바꾸면 하나만',
           ','.join(c.get('title') for c in g.get('columns') or []) == OLD_HEAD and g.get('isDefault') is True
           and pv.get('head') == ['전표일자', '계정', '구분', '금액', '적요', '비고'] and (pv.get('rows') or [[None]])[0][:4] == ['20261105', '108', '1', 110000]
           and bool(new.get('id')) and dup.get('code') == 'ACCT_FORMAT_NAME' and badf.get('code') == 'ACCT_FORMAT' and badd.get('code') == 'ACCT_FORMAT' and byadmin.get('_err') == 403
           and lines[0] == '전표일자,계정,구분,금액,적요,비고' and len(lines) > 2 and re.match(r'^\d{8},', lines[1] or '') is not None
           and (ex0.get('csv') or '').lstrip('﻿').split('\r\n')[0] == OLD_HEAD and mk.get('ok') is True and defs == f'1|{nm}',
           f"일반 {g.get('isDefault')} · 미리 {pv.get('head')} {(pv.get('rows') or [[]])[0][:4]} · 새 {new.get('id')} · {dup.get('code')} {badf.get('code')} {badd.get('code')} {byadmin.get('_err')} · {lines[:2]} · 기본 {defs}")
    finally:
        # 기본 양식은 「일반 양식」으로 되돌림(옛 시험 · 다음 돌림이 그 머리줄을 봄) — 고유 색인 때문에 두 번에 나눔
        psql("UPDATE acct_export_formats SET is_default = false WHERE is_default AND name <> '일반 양식'")
        psql("UPDATE acct_export_formats SET is_default = true WHERE name = '일반 양식'")
        rm_role(pid, '1389'); rm_role(aid, '1389a')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-formats]', timeout=30000)
            seen['box'] = pg.locator('[data-acct-formats]').count()
            seen['def'] = pg.locator('[data-acct-format-row="default"]').count()
            pg.locator('[data-acct-format-new]').click(); pg.wait_for_timeout(500)
            pg.locator('[data-acct-format-preview]').click(); pg.wait_for_timeout(1500)
            seen['pv'] = pg.locator('[data-acct-format-pv]').count()
        res = admin_page('/#/acct-accounts', chk)
        if res is None: print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = res
            ok('③ 화면 — 계정 · 규칙 › 전표 CSV 양식 상자 · 기본 하나 · 새 양식 → 미리보기 표 · 화면 오류 없음',
               seen.get('box') == 1 and seen.get('def') == 1 and seen.get('pv') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
