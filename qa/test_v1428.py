"""v10.428 (D254 · docs/565) 무역 2단계 — 수출(수주 → 선적 → 수출신고 수리 → 대금 회수) · 국내 구매 발주(입고 = 매입 + 재고)
  ① (코드) D254 수출 · 발주 표 · 가드 · 계정 3 · 전표 EXPORT_SALE · EXPORT_PAID · 부가세 신고서 영세율 · API 8 · 화면 · 메뉴 · 문서
  ② (API) 수주 → 선적(환율 · 매출) → 전표 AR / REV_EXPORT → 수출신고 → 대금 회수(환율 차이 외환차익) · 뒤로 422 · 선적 뒤 취소 409 · 부가세 신고서 6번
  ③ (API) 발주 → 입고(매입 한 건 · 합계 = 공급가 + 10%) · 입고 뒤 취소 409 · 매입처 없음 422
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
M54 = migr('D254_')
TR, SR, VF, UI, MN, AP, AC = rd('src/modules/acct/trade.ts'), rd('src/modules/acct/sources.ts'), rd('src/modules/acct/vatform.ts'), rd('web/src/app/admin/Acct.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/modules/acct/acct.controller.ts')
ok('① 코드 — D254 acct_exports · acct_pos · 가드 · 계정(REV_EXPORT · FX_GAIN · FX_LOSS) · 전표 2 · 영세율 칸 · API · 화면 · 메뉴 · 문서 565 · 판 v10.428',
   'CREATE TABLE IF NOT EXISTS public.acct_exports' in M54 and 'CREATE TABLE IF NOT EXISTS public.acct_pos' in M54 and 'fn_acct_export_guard' in M54 and "('REV_EXPORT'" in M54 and "('FX_GAIN'" in M54
   and "name: 'EXPORT_SALE'" in TR and "name: 'EXPORT_PAID'" in TR and 'EXPORT_SOURCES' in SR and "l.role = 'REV_EXPORT'" in VF
   and "@Get('exports')" in AC and "@Post('pos/:id/receive')" in AC and 'export function AcctExports' in UI and 'export function AcctPos' in UI
   and "['acct-exports', '수출']" in MN and "{tab === 'acct-exports' && <AcctExports />}" in AP and '"SB-ADM-ACC-310"' in SJ and '영세율' in doc('565_') and VT >= (10, 428), VER)

if API and DB:
    import consent_ok, random
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); q = f"{kst.year}-{(kst.month - 1) // 3 + 1}"
    stamp = random.randint(100000000, 999999999)
    pt = call('POST', '/admin/acct/parties', {'kind': 'BOTH', 'name': f'시험1428 상사 {stamp}', 'bizNo': f'8{stamp}'}, TS)
    pid = str(pt.get('id') or '')
    exids = []
    try:
        vf0 = call('GET', f'/admin/acct/tax/vat-form?q={q}', None, TS)
        six0 = next((l.get('supply') for l in vf0.get('lines') or [] if l.get('no') == '6'), 0) or 0
        ex = call('POST', '/admin/acct/exports', {'partyId': pid, 'title': f'시험1428 수출 {stamp}', 'currency': 'USD', 'incoterms': 'FOB', 'orderedOn': d0,
                                                   'lines': [{'item': '시험 품목', 'qty': 3, 'foreignAmount': 1000.5}]}, TS)
        eid = str(ex.get('id') or ''); exids.append(eid)
        back = call('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'ORDERED', 'date': d0}, TS)
        sh = call('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'SHIPPED', 'date': d0, 'fxRate': 1300, 'blNo': 'BL1428'}, TS)
        cx = call('POST', f'/admin/acct/exports/{eid}/cancel', {'reason': '시험 1428'}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        sale_lines = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = 'EXPORT_SALE' AND e.source_key = '{eid}'")
        cl = call('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'CLEARED', 'date': d0, 'declNo': f'1428-{stamp}'}, TS)
        want = round(1000.5 * 1300)
        pd = call('POST', f'/admin/acct/exports/{eid}/advance', {'to': 'PAID', 'date': d0, 'paidKrw': want + 5000 + stamp % 97}, TS)
        call('POST', '/admin/acct/journal/run', None, TS)
        paid_lines = psql(f"SELECT string_agg(l.role || ':' || l.debit || ':' || l.credit, ',' ORDER BY l.id) FROM acct_entries e JOIN acct_lines l ON l.entry_id = e.id WHERE e.source = 'EXPORT_PAID' AND e.source_key = '{eid}'")
        vf1 = call('GET', f'/admin/acct/tax/vat-form?q={q}', None, TS)
        six1 = next((l.get('supply') for l in vf1.get('lines') or [] if l.get('no') == '6'), 0) or 0
        ok('② 수출 — 수주 · 뒤로 422 · 선적(매출 = 외화 × 환율) · 선적 뒤 취소 409 · 전표 AR / REV_EXPORT · 수출신고 · 대금 회수 외환차익 · 부가세 신고서 6번 늘어남',
           ex.get('ok') is True and back.get('_err') in (400, 422) and sh.get('saleKrw') == want and cx.get('_err') == 409
           and sale_lines == f'AR:{want}:0,REV_EXPORT:0:{want}' and cl.get('ok') is True and pd.get('fxDiff') == 5000 + stamp % 97
           and paid_lines.startswith(f'CASH:{want + 5000 + stamp % 97}:0,AR:0:{want},FX_GAIN:0:{5000 + stamp % 97}') and six1 - six0 == want,
           f"{ex.get('ok')} {back.get('_err')} {sh.get('saleKrw')} {cx.get('_err')} · {sale_lines} · {cl.get('ok')} {pd.get('fxDiff')} · {paid_lines} · {six0} → {six1}")
        po = call('POST', '/admin/acct/pos', {'partyId': pid, 'title': f'시험1428 발주 {stamp}', 'orderedOn': d0, 'lines': [{'item': '시험 포장재', 'qty': 10, 'unitPrice': 1234}]}, TS)
        nop = call('POST', '/admin/acct/pos', {'title': 'x 발주', 'orderedOn': d0, 'lines': [{'item': '시험', 'qty': 1, 'unitPrice': 1}]}, TS)
        rc = call('POST', f"/admin/acct/pos/{po.get('id')}/receive", {'date': d0, 'kind': 'TAX_INVOICE'}, TS)
        tot = psql(f"SELECT total || '|' || account_role FROM acct_purchases WHERE id = {int(rc.get('purchaseId') or 0)}")
        pc = call('POST', f"/admin/acct/pos/{po.get('id')}/cancel", {'reason': '시험 1428'}, TS)
        ok('③ 발주 — 넣기 · 매입처 없음 400/422 · 입고 = 매입 한 건(공급가 12,340 + 부가세 1,234 · 소모품비) · 입고 뒤 취소 409',
           po.get('ok') is True and nop.get('_err') in (400, 422) and rc.get('ok') is True and tot == '13574|EXP_SUPPLIES' and pc.get('_err') == 409,
           f"{po.get('ok')} {nop.get('_err')} {rc.get('ok')} {tot} {pc.get('_err')}")
    finally:
        # 회사 장부 시험 줄 — 수출 전표(보통예금 줄이 은행 맞추기 시험에 섞이지 않게)는 지움 · 매입은 1392 처럼 남김
        for e in exids:
            if e:
                psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{e}'); "
                     f"DELETE FROM acct_entries WHERE source IN ('EXPORT_SALE', 'EXPORT_PAID') AND source_key = '{e}'; DELETE FROM acct_export_lines WHERE export_id = {int(e)}; DELETE FROM acct_exports WHERE id = {int(e)};")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
