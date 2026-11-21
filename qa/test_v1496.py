"""v10.496 (D271 · docs/634) 품질 클레임 · 불량 — 접수 → 확인 → 조치 → 끝냄(원인 · 조치) · 반려 · 상품 · 로트 · 공급사 · 주문 · 공급사 반품(수불부 SUP_RETURN · 로트 · 전표) · 재발 알림 · 집계
  ① (코드) D271 qlt_claims · 기록 · 수불부 SUP_RETURN · 설정 qlt.repeat_count · 전표 QLT_SUP_RETURN · 메뉴 qlt-claims · 화면 QLT-030 · 문서 634
  ② (API · DB) 로트로 접수 · 검사 422/400/404 · 고치기 · 공급사 반품(지급 담당) · 넘침 · DB 막음 · 끝냄 · 409 · 반려 · 재발 알림(한 번 · 풀림) · 집계 · 권한 주소 7
  ③ (화면) 소개몰 › 품질 클레임
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


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


M71 = migr('D271_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
d200 = (kst + datetime.timedelta(days=200)).strftime('%Y-%m-%d')

CL, QC, SRC, MN, AP, UI, AC = (rd('src/modules/qlt/claims.ts'), rd('src/modules/qlt/qlt.controller.ts'), rd('src/modules/acct/sources.ts'), rd('web/src/lib/adminMenu.ts'),
                              rd('web/src/App.tsx'), rd('web/src/app/admin/Quality.tsx'), rd('web/src/app/admin/Acct.tsx'))
ok('① 코드 — D271 qlt_claims(유형 7 · 끝냄 원인 · 조치 CHECK · 반려 사유 CHECK · 반품 ≤ 수량) · 기록(쌓기만) · 수불부 SUP_RETURN(CHECK 넓힘 · 모자라면 막음) · 설정 qlt.repeat_count · 전표 QLT_SUP_RETURN(외상매입금 / 상품 · sources 끝 push) · 재발 알림 QLT_CLAIM_REPEAT · 메뉴 qlt-claims · 화면 QLT-030 · 문서 634 · 판 v10.496',
   'CREATE TABLE IF NOT EXISTS public.qlt_claims' in M71 and 'ck_qlt_claim_done' in M71 and 'ck_qlt_claim_reject' in M71 and 'ck_qlt_claim_return' in M71 and 'trg_qlt_claim_logs_ro' in M71
   and "CHECK (kind IN ('IN', 'OUT_SALE', 'RETURN', 'ADJUST', 'SUP_RETURN'))" in M71 and 'trg_qlt_sup_return_guard' in M71 and "('qlt.repeat_count', '3'" in M71
   and "name: 'QLT_SUP_RETURN'" in CL and "role: 'AP', debit" in CL and "'QLT_CLAIM_REPEAT'" in CL and 'ALL_SOURCES.push(...QLT_SOURCES)' in SRC and "@Post('claims/:id/supplier-return')" in QC
   and "['qlt-claims', '품질 클레임']" in MN and "{tab === 'qlt-claims' && <QltClaims />}" in AP and 'export function QltClaims' in UI and "SUP_RETURN: '공급사 반품'" in AC
   and '"SB-ADM-QLT-030"' in SJ and '재발' in doc('634_') and VT >= (10, 496), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, paid = mk_staff('1496', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    rv = mk_staff('1496r', 'REVIEWER'); consent_ok.agree(rv[0], PW); TR = login(rv[0])
    opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.is_active ORDER BY o.created_at, o.id LIMIT 1")
    prod = psql(f"SELECT product_id FROM hlt_product_options WHERE id = '{opt}'") if opt else ''
    before = psql(f"SELECT coalesce((SELECT active::text FROM qlt_lot_products WHERE product_id = '{prod}'), 'none')") if prod else 'none'
    pid = ''; moves, claims = [], []
    try:
        pid = psql(f"INSERT INTO acct_parties (kind, name) VALUES ('SUPPLIER', '시험 1496 공급사-{stamp}') RETURNING id").split('\n')[0]
        call('PUT', f'/admin/qlt/lot-products/{prod}', {'on': True}, TS)
        inm = call('POST', '/admin/acct/stock/in', {'optionId': opt, 'qty': 5, 'unitCost': 1200, 'note': '시험 1496 입고'}, TS)
        mid = str(inm.get('id') or ''); moves.append(mid)
        lot = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1496A{stamp}', 'expiresOn': d200, 'qty': 5, 'moveId': mid, 'partyId': pid}, TS)
        lid = str(lot.get('id') or '')
        mb = call('GET', '/admin/qlt/claims', None, TB)
        rvw = call('GET', '/admin/qlt/claims', None, TR)
        c1 = call('POST', '/admin/qlt/claims', {'source': 'CUSTOMER', 'lotId': lid, 'qty': 3, 'defectType': 'DAMAGE', 'title': f'시험 1496 파손-{stamp}', 'detail': '상자 찢어짐'}, TS)
        cid = str(c1.get('id') or ''); claims.append(cid)
        party = psql(f"SELECT coalesce(party_id::text, '') || '|' || coalesce(option_id::text, '') || '|' || product_id FROM qlt_claims WHERE id = {int(cid or 0)}")
        noprod = call('POST', '/admin/qlt/claims', {'source': 'CUSTOMER', 'qty': 1, 'defectType': 'DAMAGE', 'title': '시험 1496 상품 없음'}, TS)
        badt = call('POST', '/admin/qlt/claims', {'source': 'CUSTOMER', 'productId': prod, 'qty': 1, 'defectType': 'NOPE', 'title': '시험 1496 유형'}, TS)
        noord = call('POST', '/admin/qlt/claims', {'source': 'CUSTOMER', 'productId': prod, 'qty': 1, 'defectType': 'DAMAGE', 'title': '시험 1496 주문', 'orderNo': f'NOPE-{stamp}'}, TS)
        cl0 = call('POST', f'/admin/qlt/claims/{cid}/close', {'result': 'CLOSED'}, TS)
        ed = call('PUT', f'/admin/qlt/claims/{cid}', {'state': 'CHECKING', 'cause': '시험 1496 포장 불량'}, TS)
        keep = psql(f"SELECT state || '|' || coalesce(cause, '') || '|' || coalesce(detail, '') FROM qlt_claims WHERE id = {int(cid or 0)}")
        srp = call('POST', f'/admin/qlt/claims/{cid}/supplier-return', {'qty': 2}, TR)
        sr = call('POST', f'/admin/qlt/claims/{cid}/supplier-return', {'qty': 2, 'note': '시험 1496'}, TP)
        if sr.get('moveId'): moves.append(str(sr.get('moveId')))
        srm = psql(f"SELECT kind || '|' || qty || '|' || (amount < 0)::text FROM acct_stock_moves WHERE id = {int(sr.get('moveId') or 0)}")
        lq = psql(f"SELECT qty FROM v_qlt_lot_qty WHERE lot_id = {int(lid or 0)}")
        sr2 = call('POST', f'/admin/qlt/claims/{cid}/supplier-return', {'qty': 2}, TS)
        big = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ('{opt}', '{today}', 'SUP_RETURN', -99999999, 'T1496:{stamp}:x')")
        ed2 = call('PUT', f'/admin/qlt/claims/{cid}', {'action': '시험 1496 공급사 반품 · 포장 기준 전달'}, TS)
        cl = call('POST', f'/admin/qlt/claims/{cid}/close', {'result': 'CLOSED'}, TS)
        ed3 = call('PUT', f'/admin/qlt/claims/{cid}', {'cause': '바꿈'}, TS)
        cl2 = call('POST', f'/admin/qlt/claims/{cid}/close', {'result': 'REJECTED', 'note': '다시'}, TS)
        dbu = psql(f"UPDATE qlt_claims SET title = '바꿈' WHERE id = {int(cid or 0)}")
        dbd = psql(f"DELETE FROM qlt_claims WHERE id = {int(cid or 0)}")
        lgro = psql(f"UPDATE qlt_claim_logs SET note = '바꿈' WHERE claim_id = {int(cid or 0)}")
        det = call('GET', f'/admin/qlt/claims/{cid}', None, TS)
        kinds = sorted({l.get('kind') for l in det.get('logs') or []})
        # 반려 · 재발(같은 상품 · 같은 불량 3건 → 알림 하나)
        c2 = call('POST', '/admin/qlt/claims', {'source': 'INSPECTION', 'productId': prod, 'qty': 1, 'defectType': 'LABEL', 'title': f'시험 1496 라벨1-{stamp}'}, TS)
        claims.append(str(c2.get('id') or ''))
        rj0 = call('POST', f"/admin/qlt/claims/{c2.get('id')}/close", {'result': 'REJECTED'}, TS)
        c3 = call('POST', '/admin/qlt/claims', {'source': 'INSPECTION', 'productId': prod, 'qty': 1, 'defectType': 'LABEL', 'title': f'시험 1496 라벨2-{stamp}'}, TS)
        c4 = call('POST', '/admin/qlt/claims', {'source': 'INTERNAL', 'optionId': opt, 'qty': 1, 'defectType': 'LABEL', 'title': f'시험 1496 라벨3-{stamp}'}, TS)
        claims += [str(c3.get('id') or ''), str(c4.get('id') or '')]
        call('POST', '/admin/jobs', {'job': 'qlt_daily'}, TS); call('POST', '/admin/jobs', {'job': 'qlt_daily'}, TS)
        rep = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'QLT_CLAIM_REPEAT' AND detail->>'product' = '{prod}' AND detail->>'defect' = 'LABEL' AND resolved_at IS NULL")
        rj = call('POST', f"/admin/qlt/claims/{c4.get('id')}/close", {'result': 'REJECTED', 'note': '시험 1496 중복 접수'}, TS)
        call('POST', '/admin/jobs', {'job': 'qlt_daily'}, TS)
        rep2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'QLT_CLAIM_REPEAT' AND detail->>'product' = '{prod}' AND detail->>'defect' = 'LABEL' AND resolved_at IS NULL")
        st = call('GET', '/admin/qlt/claims/stats?months=1', None, TS)
        lst = call('GET', '/admin/qlt/claims?state=OPENALL', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'qlt-claims'")
        ok('② 클레임 — 회원 403 · 검수 담당 403 · 로트로 접수(공급사 · 옵션 · 상품 따라옴) · 상품 없음 422 · 유형 400 · 없는 주문 404 · 원인 없이 끝냄 422 · 고치기(보낸 칸만) · 반품 검수 담당 403 · 지급 담당 반품 2(SUP_RETURN · 원가 · 로트 3) · 수량 넘침 422 · DB 재고 모자람 막음 · 끝냄 · 끝낸 뒤 409 · DB 고치기 · 지우기 막음 · 기록 쌓기만 · 반려 사유 422 · 재발 알림 1(두 번) → 반려로 줄면 풀림 · 집계 · 권한 주소 7',
           mb.get('_err') == 403 and rvw.get('_err') == 403 and c1.get('state') == 'OPEN' and party == f'{pid}|{opt}|{prod}' and noprod.get('code') == 'QLT_CLAIM' and badt.get('_err') == 400
           and noord.get('_err') == 404 and cl0.get('code') == 'QLT_CLAIM_DONE' and ed.get('ok') is True and keep == 'CHECKING|시험 1496 포장 불량|상자 찢어짐'
           and srp.get('_err') == 403 and sr.get('qty') == 2 and int(sr.get('amount') or 0) > 0 and srm == 'SUP_RETURN|-2|true' and lq == '3' and sr2.get('code') == 'QLT_RETURN'
           and 'QLT_RETURN' in big and ed2.get('ok') is True and cl.get('state') == 'CLOSED' and ed3.get('_err') == 409 and cl2.get('_err') == 409
           and 'QLT_CLAIM' in dbu and 'QLT_CLAIM' in dbd and '!' in lgro and {'CREATE', 'STATE', 'EDIT', 'RETURN', 'CLOSE'} <= set(kinds) and len(det.get('returns') or []) == 1
           and rj0.get('code') == 'QLT_REASON' and rep == '1' and rj.get('state') == 'REJECTED' and rep2 == '0'
           and any(x.get('key') == 'LABEL' for x in st.get('byDefect') or []) and any(x.get('id') == str(c3.get('id')) for x in lst.get('items') or []) and rmap == '7',
           f"{mb.get('_err')} {rvw.get('_err')} {c1.get('state') or c1} {party} · {noprod.get('code')} {badt.get('_err')} {noord.get('_err')} {cl0.get('code')} {ed.get('ok')} {keep} · "
           f"{srp.get('_err')} {sr.get('qty') or sr} {srm} 로트 {lq} {sr2.get('code')} {big[-30:]} · {ed2.get('ok')} {cl.get('state')} {ed3.get('_err')} {cl2.get('_err')} {dbu[-20:]} {dbd[-20:]} {kinds} · "
           f"{rj0.get('code')} 재발 {rep} → {rep2} · {rmap}")
    finally:
        cids = ','.join(x for x in claims if str(x).isdigit())
        ids = ','.join(x for x in moves if str(x).isdigit())
        if cids:
            psql(f"SET session_replication_role = replica; DELETE FROM qlt_claim_logs WHERE claim_id IN ({cids}); DELETE FROM qlt_lot_moves WHERE claim_id IN ({cids}); DELETE FROM qlt_claims WHERE id IN ({cids});")
        psql(f"SET session_replication_role = replica; DELETE FROM qlt_claim_logs WHERE claim_id IN (SELECT id FROM qlt_claims WHERE title LIKE '시험 1496 %'); DELETE FROM qlt_claims WHERE title LIKE '시험 1496 %';")
        if prod:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'QLT_CLAIM_REPEAT' AND detail->>'product' = '{prod}';")
        psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_moves WHERE lot_id IN (SELECT id FROM qlt_lots WHERE lot_no LIKE 'T1496%{stamp}'); DELETE FROM qlt_lots WHERE lot_no LIKE 'T1496%{stamp}';")
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM qlt_move_marks WHERE move_id IN ({ids}); "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('STOCK_IN', 'QLT_SUP_RETURN') AND source_key IN ({','.join(repr(x) for x in moves if str(x).isdigit())})); "
                 f"DELETE FROM acct_entries WHERE source IN ('STOCK_IN', 'QLT_SUP_RETURN') AND source_key IN ({','.join(repr(x) for x in moves if str(x).isdigit())}); "
                 f"DELETE FROM acct_stock_moves WHERE id IN ({ids});")
        if prod:
            if before == 'none':
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_products WHERE product_id = '{prod}';")
            else:
                psql(f"SET session_replication_role = replica; UPDATE qlt_lot_products SET active = {before} WHERE product_id = '{prod}';")
        if pid.isdigit():
            psql(f"SET session_replication_role = replica; DELETE FROM acct_parties WHERE id = {pid};")
        rm_role(paid, '1496'); rm_role(rv[1], '1496r')
    if ADMIN_WEB:
        r = admin_page('/#/qlt-claims', lambda pg, seen: seen.update(n=pg.locator('[data-qlt-claims]').count(), new=pg.locator('[data-qlt-claim-new]').count(), tabs=pg.locator('[data-qlt-claim-tab]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 품질 클레임(접수 칸 · 상태 단추 7 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('new') == 1 and seen.get('tabs') == 7 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
