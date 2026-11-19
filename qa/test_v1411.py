"""v10.411 (D249 · docs/548) 무역 1단계 · 수입 건 관리
  ① (코드) D249 수입 건 · 품목 표 · 가드 · 전표 IMPORT_VAT · 재고 수불부 IN · API 5 · 화면 · 문서 548
  ② (API · DB) 발주 · 선적 · 통관 · 입력 검사 · 단계 건너뛰기 · 뒤로 · 통관 뒤 취소 · 품목 잠금
  ③ (API · DB) 입고 원가(물품 + 관세 + 운임 + 기타) · 재고 수불부 IN · 수입 부가세 전표 · STOCK_IN 전표
  ④ (화면) 회계 › 수입
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
IM, SR = rd('src/modules/acct/imports.ts'), rd('src/modules/acct/sources.ts')
ok('① 코드 — D249 수입 건 · 품목 표 · 가드(앞으로만 · 통관 전 취소 · 통관 뒤 품목 잠금) · 입고 → 재고 수불부 IN · 전표 IMPORT_VAT · API 5 · 감사 · 화면 · 메뉴 · 문서 548 · 판 v10.411',
   'CREATE TABLE IF NOT EXISTS public.acct_imports' in M49 and 'CREATE TABLE IF NOT EXISTS public.acct_import_lines' in M49 and 'fn_acct_import_guard' in M49 and 'fn_acct_import_line_guard' in M49
   and 'export const IMPORT_SOURCES' in IM and "name: 'IMPORT_VAT'" in IM and 'INSERT INTO acct_stock_moves' in IM and 'IMPORT_SOURCES' in SR
   and "@Get('imports')" in AC and "@Get('imports/:id')" in AC and "@Post('imports')" in AC and "@Post('imports/:id/advance')" in AC and "@Post('imports/:id/cancel')" in AC
   and "@Audit('ACCT_IMPORT_ADVANCE', 'SETTING')" in AC and 'export function AcctImports' in UI and "{tab === 'acct-imports' && <AcctImports />}" in AP
   and "['acct-imports', '수입']" in MN and 'GET /admin/acct/imports' in SJ and '수입' in doc('548_') and VT >= (10, 411), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, pid = mk_staff('1411', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d'); tomorrow = (kst + datetime.timedelta(days=1)).strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    opts = [x for x in psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' ORDER BY o.id LIMIT 2").split('\n') if len(x) == 36]
    notdirect = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type <> 'DIRECT' LIMIT 1")
    imp = None
    if len(opts) < 1:
        print('  (직판 상품 옵션 없음 — ② ③ 건너뜀)')
    else:
        lines = [{'optionId': o, 'qty': 10 * (i + 1), 'foreignAmount': 100.5 * (i + 1)} for i, o in enumerate(opts)]
        try:
            i1 = call('POST', '/admin/acct/imports', {'title': f'시험 수입 1411-{stamp}', 'currency': 'usd', 'orderedOn': d0, 'lines': lines}, TP); imp = i1.get('id')
            fut = call('POST', '/admin/acct/imports', {'title': f'시험 수입 1411 앞날', 'orderedOn': tomorrow, 'lines': lines}, TP)
            nd = call('POST', '/admin/acct/imports', {'title': f'시험 수입 1411 입점', 'orderedOn': d0, 'lines': [{'optionId': notdirect, 'qty': 1, 'foreignAmount': 1}]}, TP) if len(notdirect) == 36 else {'code': 'IMPORT_LINES'}
            mem = call('POST', '/admin/acct/imports', {'title': '회원 1411', 'orderedOn': d0, 'lines': lines}, TB)
            skip = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0}, TP)
            s1 = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'SHIPPED', 'date': d0, 'blNo': f'BL1411{stamp}'}, TP)
            back = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'ORDERED', 'date': d0}, TP)
            nofx = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'CUSTOMS', 'date': d0}, TP)
            s2 = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'CUSTOMS', 'date': d0, 'fxRate': 1300, 'duty': 10000, 'importVat': 50000, 'brokerName': '시험관세사', 'declNo': f'D{stamp}'}, TP)
            cx = call('POST', f'/admin/acct/imports/{imp}/cancel', {'reason': '시험 1411 통관 뒤 취소'}, TP)
            lk = psql(f"UPDATE acct_import_lines SET qty = qty + 1 WHERE import_id = {imp or 0}")
            ok('② 발주 · 선적 · 통관 — 통화 대문자 · 앞날 422 · 입점 상품 422 · 회원 403 · 통관 없이 입고 422 · 뒤로 422 · 환율 없음 422 · 통관 뒤 취소 409 · 통관 뒤 품목 DB 가 막음',
               i1.get('ok') is True and psql(f"SELECT currency FROM acct_imports WHERE id = {imp or 0}") == 'USD' and fut.get('code') == 'IMPORT_DATE' and nd.get('code') == 'IMPORT_LINES'
               and mem.get('_err') == 403 and skip.get('code') == 'IMPORT_STATE' and s1.get('state') == 'SHIPPED' and back.get('code') in ('IMPORT_STATE', 'VALIDATION_ERROR')
               and nofx.get('code') == 'IMPORT_FX' and s2.get('state') == 'CUSTOMS' and cx.get('code') == 'IMPORT_STATE' and 'ACCT_IMPORT' in lk,
               f"{i1} · {fut.get('code')} · {nd.get('code')} · {mem.get('_err')} · {skip.get('code')} · {s1.get('state')} · {back.get('code')} · {nofx.get('code')} · {s2.get('state')} · {cx.get('code')} · {lk[-40:]}")
            s3 = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0, 'freight': 20000, 'otherCost': 5001}, TP)
            goods = sum(round(l['foreignAmount'] * 1300) for l in lines)
            landed = psql(f"SELECT coalesce(sum(landed_cost), 0) FROM acct_import_lines WHERE import_id = {imp or 0}")
            mv = psql(f"SELECT count(*) || '|' || coalesce(sum(qty), 0) FROM acct_stock_moves WHERE kind = 'IN' AND source_key LIKE 'IMP-{imp}-%'")
            call('POST', '/admin/acct/journal/run', None, TS)
            vl = lines_of('IMPORT_VAT', imp)
            si = psql(f"SELECT count(*) FROM acct_entries e JOIN acct_stock_moves m ON e.source = 'STOCK_IN' AND e.source_key = m.id::text WHERE m.source_key LIKE 'IMP-{imp}-%'")
            again = call('POST', f'/admin/acct/imports/{imp}/advance', {'to': 'RECEIVED', 'date': d0}, TP)
            dt = call('GET', f'/admin/acct/imports/{imp}', None, TP)
            ok('③ 입고 — 원가 = 물품(외화 × 환율) + 관세 + 운임 + 기타 · 품목마다 재고 수불부 IN · 수입 부가세 전표(부가세대급금 / 미지급금) · 재고 전표 STOCK_IN · 입고 뒤 다시 409 · 한 건 보기',
               s3.get('state') == 'RECEIVED' and s3.get('goodsKrw') == goods and landed == str(goods + 10000 + 20000 + 5001)
               and mv == f"{len(lines)}|{sum(l['qty'] for l in lines)}" and vl == ['AP:0:50000', 'VAT_IN:50000:0'] and si == str(len(lines))
               and again.get('code') == 'IMPORT_STATE' and len(dt.get('lines') or []) == len(lines) and all(x.get('moveId') for x in dt.get('lines') or []),
               f"{s3} · 물품 {goods} · 원가 {landed} · {mv} · {vl} · {si} · {again.get('code')} · {len(dt.get('lines') or [])}")
        finally:
            if imp:   # 시험 수불 · 전표 · 수입 건은 지움(같은 옵션 재고 시험 · 다시 돌림에 영향 없게)
                psql(f"""BEGIN; SET LOCAL session_replication_role = replica;
                  DELETE FROM acct_lines WHERE entry_id IN (SELECT e.id FROM acct_entries e WHERE (e.source = 'IMPORT_VAT' AND e.source_key = '{imp}')
                     OR (e.source = 'STOCK_IN' AND e.source_key IN (SELECT m.id::text FROM acct_stock_moves m WHERE m.source_key LIKE 'IMP-{imp}-%')));
                  DELETE FROM acct_entries e WHERE (e.source = 'IMPORT_VAT' AND e.source_key = '{imp}')
                     OR (e.source = 'STOCK_IN' AND e.source_key IN (SELECT m.id::text FROM acct_stock_moves m WHERE m.source_key LIKE 'IMP-{imp}-%'));
                  DELETE FROM acct_stock_moves WHERE source_key LIKE 'IMP-{imp}-%';
                  DELETE FROM acct_import_lines WHERE import_id = {imp}; DELETE FROM acct_imports WHERE id = {imp}; COMMIT;""")
    rm_role(pid, '1411')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-imports]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-imports]').count()
            seen['form'] = pg.locator('[data-acct-import-form]').count()
            seen['line'] = pg.locator('[data-acct-import-line]').count()
        res = admin_page('/#/acct-imports', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 수입 · 발주 칸 · 품목 줄 · 화면 오류 없음', seen.get('sec') == 1 and seen.get('form') == 1 and seen.get('line', 0) >= 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
