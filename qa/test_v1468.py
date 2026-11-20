"""v10.468 (D264 · docs/606) 문서 PDF(인쇄) — 견적서 · 거래명세서 · 발주서 · 급여명세서 인쇄용 화면 + @media print · 「PDF 로 저장」 안내 · 서버 PDF 라이브러리 없음
  ① (코드) web/src/lib/printDoc.ts(A4 · 단추 숨김 · 안내) · Erp printHtml · Hr printSlip 이 공용 창을 씀 · 디자인 기준 · 화면 SAL-030 · 문서 606
  ② (API · DB) 견적서 자세히(회사 정보 · 줄 · 합계) · 급여명세서 목록
  ③ (화면) 견적 · 명세서 › 열기 › 인쇄 → 새 창 「PDF 로 저장」 · 인쇄 모양에서 단추 숨김
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

PD, ER, HR = rd('web/src/lib/printDoc.ts'), rd('web/src/app/admin/Erp.tsx'), rd('web/src/app/admin/Hr.tsx')
sizes = set(re.findall(r'font-size:\s*(\d+)px', PD))
radii = set(re.findall(r'border-radius:\s*(\d+)px', PD))
medias = set(re.findall(r'@media \(max-width:\s*(\d+)px\)', PD))
ok('① 코드 — 공용 인쇄 창 printDoc(A4 @page · @media print 로 단추 숨김 · 머리줄 반복 · 「PDF 로 저장」 · 안내 · 파일 이름 = 창 제목 · 팝업 막힘 false) · 견적서 · 주문서 · 거래명세서 · 발주서(Erp printHtml) · 급여명세서(Hr printSlip) 모두 이 창 · 서버 PDF 라이브러리 없음 · 글자 · 모서리 · 폭 기준 · # 색 없음 · 화면 SAL-030 · 문서 606 · 판 v10.468',
   'export function openPrint' in PD and '@page { size: A4' in PD and '@media print { .bar { display: none !important; }' in PD and 'thead { display: table-header-group; }' in PD
   and 'PDF 로 저장' in PD and 'data-print-pdf' in PD and 'data-print-guide' in PD and 'if (!w) return false;' in PD
   and "import { openPrint } from '../../lib/printDoc';" in ER and 'openPrint({ title, body' in ER and "w.document.write(`<!doctype html>" not in ER
   and "import { openPrint } from '../../lib/printDoc';" in HR and "kind: 'PAYSLIP'" in HR and "w.document.write(`<!doctype html>" not in HR
   and sizes <= {'12', '13', '14', '16', '18', '20', '24', '30'} and radii <= {'7', '11', '999'} and medias <= {'640', '900', '1240'} and not re.search(r'#[0-9a-fA-F]{3,6}\b', PD)
   and not any(x in rd('package.json') for x in ('"pdfkit"', '"puppeteer"', '"jspdf"', '"pdfmake"')) and '"SB-ADM-SAL-030"' in SJ and 'PDF로 저장' in doc('606_') and VT >= (10, 468),
   f"{VER} {sorted(sizes)} {sorted(radii)} {sorted(medias)}")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    pid = did = ''
    try:
        pid = psql(f"INSERT INTO acct_parties (kind, name, biz_no, contact_name) VALUES ('CUSTOMER', '시험 1468 거래처-{stamp}', NULL, '담당 1468') RETURNING id").split('\n')[0]
        c = call('POST', '/admin/acct/sales-docs', {'kind': 'QUOTE', 'partyId': pid, 'title': f'시험 1468 견적-{stamp}', 'lines': [{'item': '시험 품목 1468', 'qty': 2, 'unitPrice': 15000, 'taxType': 'TAXABLE'}]}, TS)
        did = str(c.get('id') or '')
        dt = call('GET', f'/admin/acct/sales-docs/{did}', None, TS)
        ps = call('GET', '/admin/acct/payslips', None, TS)
        ok('② 인쇄에 쓰는 자료 — 견적서 자세히(번호 · 줄 · 합계 33,000 · 회사 정보 칸 5) · 급여명세서 목록 응답',
           bool(did) and str(dt.get('doc', {}).get('docNo', '')).startswith('Q-') and len(dt.get('lines') or []) == 1 and int(dt.get('doc', {}).get('total') or 0) == 33000
           and set((dt.get('company') or {}).keys()) >= {'name', 'bizNo', 'ceo', 'address', 'phone'} and 'items' in ps,
           f"{c.get('docNo') or c} {dt.get('doc', {}).get('total')} {list((dt.get('company') or {}).keys())} {list(ps.keys())[:4]}")
        if ADMIN_WEB:
            def chk(pg, seen):
                row = pg.locator('[data-erp-doc-row="QUOTE"]', has_text=f'시험 1468 견적-{stamp}')
                seen['row'] = row.count()
                if row.count():
                    row.first.locator('button', has_text='열기').click(); pg.wait_for_timeout(2000)
                    with pg.expect_popup() as pop:
                        pg.locator('[data-erp-doc-print]').first.click()
                    w = pop.value; w.wait_for_load_state(); w.wait_for_timeout(800)
                    seen['bar'] = w.locator('[data-print-bar="SALES"]').count(); seen['pdf'] = w.locator('[data-print-pdf]').count()
                    seen['sheet'] = w.locator('[data-print-sheet]').count(); seen['title'] = w.title(); seen['h1'] = w.locator('h1').inner_text() if w.locator('h1').count() else ''
                    w.emulate_media(media='print'); seen['hidden'] = w.locator('[data-print-bar]').is_hidden()
                    w.screenshot(path=os.path.join(HERE, 'v1468_print_quote.png'), full_page=True); w.close()
            r = admin_page('/#/acct-docs', chk)
            if r is not None:
                seen, perr = r
                ok('③ 화면 — 견적 · 명세서 › 열기 › 인쇄 → 새 창(「PDF 로 저장」 · 인쇄 · 안내 · 문서 · 제목 = 번호 · 인쇄 모양에서는 단추 숨김) · 화면 오류 없음',
                   seen.get('row', 0) >= 1 and seen.get('bar') == 1 and seen.get('pdf') == 1 and seen.get('sheet') == 1 and str(seen.get('title', '')).startswith('Q-')
                   and '견' in str(seen.get('h1', '')) and seen.get('hidden') is True and not perr, f"{seen} {perr[:2]}")
    finally:
        if did:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_sales_doc_lines WHERE doc_id::text = '{did}'; DELETE FROM acct_sales_docs WHERE id::text = '{did}';")
        if pid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM acct_parties WHERE id = {pid};")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
