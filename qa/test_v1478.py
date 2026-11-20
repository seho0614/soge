"""v10.478 (D266 · docs/616) 안전 재고 · 재주문 — 직판 옵션 최소 재고 · 판매용 + 발주 중 < 최소면 운영 알림 · 매입처별 재주문 초안 → 사람이 「발주로 넣기」(자동 발주 없음)
  ① (코드) D266 규칙 · 초안 · 줄 · 가드 · 설정 · 정기 작업 acct_reorder · addPo 는 convert 에서만 · 메뉴 · 화면 FIN2-040 · 문서 616
  ② (API · DB) 회원 403 · 400 · 404 · 규칙 · 점검 두 번 알림 1 · 초안 줄 · 고치기 · 발주로 넣기 · 409 · DB 막음 · 알림 풀림 · 버림 · 규칙 끔 · 권한 주소 6
  ③ (화면) 회계 › 안전 재고 · 재주문
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


M66 = migr('D266_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
AM, MN, AP, SCH, WK = rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
OC, UI = rd('src/modules/acct/acct-ops.controller.ts'), rd('web/src/app/admin/AcctOps.tsx')

RO = rd('src/modules/acct/reorder.ts')
ok('① 코드 — D266 acct_stock_rules(직판만 · 지우지 않음) · 재주문 초안(매입처마다 열린 초안 하나 · 끝나면 못 고침) · 초안 줄 · 설정 acct.reorder · 정기 작업 acct_reorder 매시간 · 위치 = 판매용 + 발주 중 · STOCK_REORDER · 「발주로 넣기」만 addPo(자동 발주 없음) · API 6 · 메뉴 acct-reorder · 화면 FIN2-040 · 문서 616 · 판 v10.478',
   'CREATE TABLE IF NOT EXISTS public.acct_stock_rules' in M66 and 'uq_ard_open_party' in M66 and 'trg_acct_stock_rule_guard' in M66 and 'trg_acct_reorder_draft_guard' in M66 and 'trg_acct_reorder_line_guard' in M66
   and "('acct.reorder', 'on'" in M66 and "('acct_reorder', 60, NULL, NULL" in M66
   and "po.state = 'ORDERED'" in RO and "'STOCK_REORDER'" in RO and 'export async function acctReorderJob' in RO and 'await addPo(db' in RO and RO.count('addPo(') == 1
   and "@Post('acct/reorder/drafts/:id/convert')" in OC and "case 'acct_reorder':" in SCH and "'acct_reorder'," in WK
   and "['acct-reorder', '안전 재고 · 재주문']" in MN and "{tab === 'acct-reorder' && <AcctReorder />}" in AP and 'export function AcctReorder' in UI
   and '"SB-ADM-FIN2-040"' in SJ and '재주문' in doc('616_') and VT >= (10, 478), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    sw0 = getset('acct.reorder')
    opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' "
               "WHERE NOT EXISTS (SELECT 1 FROM acct_stock_rules r WHERE r.option_id = o.id AND coalesce(r.memo, '') NOT LIKE '시험 1478%') ORDER BY o.created_at NULLS LAST, o.id LIMIT 1").split('\n')[0]
    pid = po = ''
    if not re.match(r'^[0-9a-f-]{36}$', opt or ''):
        print('  (직판 옵션 없음 — ② 건너뜀)')
    else:
        try:
            psql(f"SET session_replication_role = replica; DELETE FROM acct_stock_rules WHERE option_id = '{opt}' AND memo LIKE '시험 1478%'; "
                 f"DELETE FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND detail->>'option' = '{opt}' AND resolved_at IS NULL;")
            setting('acct.reorder', 'on', '1478')
            pid = psql(f"INSERT INTO acct_parties (kind, name) VALUES ('SUPPLIER', '시험 1478 매입처-{stamp}') RETURNING id").split('\n')[0]
            def pos():
                return int(psql(f"SELECT o.stock + coalesce((SELECT sum(l.qty) FROM acct_po_lines l JOIN acct_pos x ON x.id = l.po_id WHERE x.state = 'ORDERED' AND l.option_id = o.id), 0) FROM hlt_product_options o WHERE o.id = '{opt}'") or 0)
            p0 = pos()
            mb = call('GET', '/admin/acct/reorder', None, TB)
            bad = call('PUT', f'/admin/acct/reorder/rules/{opt}', {'minQty': 1, 'reorderQty': 0}, TS)
            nf = call('PUT', '/admin/acct/reorder/rules/00000000-0000-4000-8000-000000000000', {'minQty': 1, 'reorderQty': 1}, TS)
            rule = call('PUT', f'/admin/acct/reorder/rules/{opt}', {'minQty': p0 + 10, 'reorderQty': 5, 'partyId': pid, 'unitPrice': 1000, 'memo': '시험 1478'}, TS)
            call('POST', '/admin/acct/reorder/run', {}, TS); run = call('POST', '/admin/acct/reorder/run', {}, TS)
            al1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND detail->>'option' = '{opt}' AND resolved_at IS NULL")
            did = psql(f"SELECT id FROM acct_reorder_drafts WHERE party_id = {int(pid or 0)} AND state = 'DRAFT'")
            line1 = psql(f"SELECT qty || '|' || unit_price FROM acct_reorder_draft_lines WHERE draft_id = {int(did or 0)} AND option_id = '{opt}'")
            view = call('GET', '/admin/acct/reorder', None, TS)
            me = next((x for x in view.get('items') or [] if x.get('optionId') == opt), {})
            ed = call('PUT', f'/admin/acct/reorder/drafts/{did}/lines', {'lines': [{'optionId': opt, 'qty': 12}]}, TS)
            line2 = psql(f"SELECT qty FROM acct_reorder_draft_lines WHERE draft_id = {int(did or 0)} AND option_id = '{opt}'")
            rdel = psql(f"DELETE FROM acct_stock_rules WHERE option_id = '{opt}'")
            cv = call('POST', f'/admin/acct/reorder/drafts/{did}/convert', {'title': f'시험 1478 발주-{stamp}'}, TS); po = str(cv.get('poId') or '')
            porow = psql(f"SELECT o.state || '|' || o.party_id || '|' || l.qty || '|' || l.unit_price FROM acct_pos o JOIN acct_po_lines l ON l.po_id = o.id WHERE o.id = {int(po or 0)} AND l.option_id = '{opt}'")
            dst = psql(f"SELECT state || '|' || coalesce(po_id::text, '') FROM acct_reorder_drafts WHERE id = {int(did or 0)}")
            cv2 = call('POST', f'/admin/acct/reorder/drafts/{did}/convert', {}, TS)
            dbu = psql(f"UPDATE acct_reorder_drafts SET party_id = NULL WHERE id = {int(did or 0)}")
            call('POST', '/admin/acct/reorder/run', {}, TS)
            al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND detail->>'option' = '{opt}' AND resolved_at IS NULL")
            call('PUT', f'/admin/acct/reorder/rules/{opt}', {'minQty': pos() + 5, 'reorderQty': 5, 'partyId': pid, 'unitPrice': 1000, 'memo': '시험 1478 둘째'}, TS)
            call('POST', '/admin/acct/reorder/run', {}, TS)
            did2 = psql(f"SELECT id FROM acct_reorder_drafts WHERE party_id = {int(pid or 0)} AND state = 'DRAFT'")
            dm = call('POST', f'/admin/acct/reorder/drafts/{did2}/dismiss', {'reason': '시험 1478 버림'}, TS)
            dm2 = call('POST', f'/admin/acct/reorder/drafts/{did2}/dismiss', {'reason': '시험 1478 두 번'}, TS)
            call('PUT', f'/admin/acct/reorder/rules/{opt}', {'minQty': 0, 'reorderQty': 1, 'active': False, 'memo': '시험 1478 끔'}, TS)
            call('POST', '/admin/acct/reorder/run', {}, TS)
            al3 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND detail->>'option' = '{opt}' AND resolved_at IS NULL")
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'acct-reorder'")
            need = max(5, p0 + 10 - p0)
            ok('② 안전 재고 · 재주문 — 회원 403 · 재주문 0 은 400 · 직판 아닌 옵션 404 · 규칙 · 지금 점검 두 번 → 알림 1 · 초안 줄(수량 max(재주문, 최소 − 위치) · 단가) · 목록 모자람 · 초안 고치기 · 규칙 지우기 DB 막음 · 발주로 넣기(ORDERED · 매입처 · 수량 12) · 초안 CONVERTED · 두 번 409 · 끝난 초안 DB 고치기 막음 · 발주 중이 들어가 알림 풀림 · 새 초안 버림 · 두 번 409 · 규칙 끄면 알림 풀림 · 권한 주소 6',
                   mb.get('_err') == 403 and bad.get('_err') == 400 and nf.get('_err') == 404 and rule.get('ok') is True and al1 == '1' and did.isdigit() and line1 == f'{need}|1000'
                   and me.get('below') is True and ed.get('ok') is True and line2 == '12' and 'ACCT_STOCK_RULE' in rdel
                   and po.isdigit() and porow == f'ORDERED|{pid}|12|1000' and dst == f'CONVERTED|{po}' and cv2.get('_err') == 409 and 'ACCT_REORDER' in dbu
                   and al2 == '0' and did2.isdigit() and did2 != did and dm.get('ok') is True and dm2.get('_err') == 409 and al3 == '0' and rmap == '6',
                   f"{mb.get('_err')} {bad.get('_err')} {nf.get('_err')} {rule.get('ok') or rule} · {run} · 알림 {al1} 초안 {did} {line1} 기대 {need}|1000 · {me.get('below')} {ed.get('ok')} {line2} {rdel[-30:]} · "
                   f"{po} {porow} {dst} {cv2.get('_err')} {dbu[-30:]} · {al2} · {did2} {dm.get('ok')} {dm2.get('_err')} · {al3} · {rmap}")
        finally:
            setting('acct.reorder', sw0 or 'on', '1478')
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'STOCK_REORDER' AND detail->>'option' = '{opt}' AND raised_at > now() - interval '1 hour'; "
                 f"DELETE FROM acct_stock_rules WHERE option_id = '{opt}' AND memo LIKE '시험 1478%';")
            if pid.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM acct_reorder_draft_lines WHERE draft_id IN (SELECT id FROM acct_reorder_drafts WHERE party_id = {pid}); "
                     f"DELETE FROM acct_reorder_drafts WHERE party_id = {pid}; DELETE FROM acct_po_lines WHERE po_id IN (SELECT id FROM acct_pos WHERE party_id = {pid}); "
                     f"DELETE FROM acct_pos WHERE party_id = {pid}; DELETE FROM acct_parties WHERE id = {pid};")
    if ADMIN_WEB:
        r = admin_page('/#/acct-reorder', lambda pg, seen: seen.update(n=pg.locator('[data-reorder]').count(), run=pg.locator('[data-reorder-run]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회계 › 안전 재고 · 재주문(지금 점검 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('run') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
