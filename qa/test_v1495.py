"""v10.495 (D271 · docs/633) 재고 로트 · 유통기한 — 원가 수불부에 덧붙이는 로트(로트 관리 켠 직판 상품만) · 입고 줄 나누기 · FEFO 출고 · 반입 되돌림 · 임박 알림 · 회수 나간 곳 · 로트 조정
  ① (코드) D271 표 5 · 보기 · 가드 · 설정 · 정기 작업 qlt_lot_alloc · qlt_daily · QltController · 메뉴 qlt-lots · 화면 QLT-020 · 문서 633
  ② (API · DB) 켜기 · 로트 등록(입고 줄 합 · 같은 번호 · 무늬) · 출고 FEFO · SHORT · 반입 · 임박 알림(한 번) · 나간 곳(ADMIN · SUPER · 감사) · 회수 · 조정(SUPER) · DB 막음 · 끄면 그대로 · 권한 주소 9
  ③ (화면) 소개몰 › 로트 · 유통기한
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


def lotq(lid):
    return psql(f"SELECT coalesce((SELECT qty FROM v_qlt_lot_qty WHERE lot_id = {int(lid or 0)}), -1)")


M71 = migr('D271_')
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
d20 = (kst + datetime.timedelta(days=20)).strftime('%Y-%m-%d')
d200 = (kst + datetime.timedelta(days=200)).strftime('%Y-%m-%d')

LT, QC, AM, MN, AP, SCH, WK, UI = (rd('src/modules/qlt/lots.ts'), rd('src/modules/qlt/qlt.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'),
                                  rd('web/src/App.tsx'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/Quality.tsx'))
ok('① 코드 — D271 qlt_lot_products · qlt_lots(로트 번호 무늬 · 유통기한 · 입고 줄 합 가드) · qlt_lot_moves(쌓기만 · 0 아래 막음) · qlt_move_marks · qlt_lot_picks · v_qlt_lot_qty · 설정 qlt.expiry_alert · expiry_days 30 · 정기 작업 qlt_lot_alloc(매시간) · qlt_daily(07:20) · FEFO · 배송 뒤 · 나간 곳 감사 QLT_LOT_TRACE · 메뉴 qlt-lots · 화면 QLT-020 · 문서 633 · 판 v10.495',
   'CREATE TABLE IF NOT EXISTS public.qlt_lots' in M71 and "CHECK (lot_no ~ '^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$')" in M71 and 'LOT_NO_RE = /^[0-9A-Za-z][0-9A-Za-z._/-]{0,39}$/' in LT
   and 'trg_qlt_lot_guard' in M71 and 'trg_qlt_lot_moves_ro' in M71 and 'trg_qlt_move_marks_ro' in M71 and 'CREATE OR REPLACE VIEW public.v_qlt_lot_qty' in M71
   and "('qlt.expiry_days', '30'" in M71 and "('qlt_lot_alloc', 60" in M71 and "('qlt_daily', 1440, 7, 20" in M71
   and 'export async function qltLotAllocJob' in LT and 'ORDER BY l.expires_on, l.id' in LT and "'QLT_LOT_TRACE'" in LT and "'QLT_LOT_EXPIRY'" in LT
   and "@Roles('ADMIN', 'SUPER')" in QC and "case 'qlt_lot_alloc':" in SCH and "case 'qlt_daily':" in SCH and "'qlt_lot_alloc'," in WK and "'qlt_daily'," in WK
   and "['qlt-lots', '로트 · 유통기한']" in MN and "{tab === 'qlt-lots' && <QltLots />}" in AP and 'export function QltLots' in UI and '"SB-ADM-QLT-020"' in SJ and 'FEFO' in doc('633_') and VT >= (10, 495), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pe, paid = mk_staff('1495', 'PAYOUT'); consent_ok.agree(pe, PW); TP = login(pe)
    opt = psql("SELECT o.id FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' WHERE o.is_active ORDER BY o.created_at, o.id LIMIT 1")
    prod = psql(f"SELECT product_id FROM hlt_product_options WHERE id = '{opt}'") if opt else ''
    before = psql(f"SELECT coalesce((SELECT active::text FROM qlt_lot_products WHERE product_id = '{prod}'), 'none')") if prod else 'none'
    moves, lots = [], []
    t0 = psql("SELECT clock_timestamp()")
    try:
        mb = call('GET', '/admin/qlt/lots', None, TB)
        off = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1495X{stamp}', 'expiresOn': d200, 'qty': 1}, TS) if before != 'true' else {'code': 'QLT_LOT_OFF'}
        on = call('PUT', f'/admin/qlt/lot-products/{prod}', {'on': True}, TS)
        inm = call('POST', '/admin/acct/stock/in', {'optionId': opt, 'qty': 10, 'unitCost': 1000, 'note': '시험 1495 입고'}, TS)
        mid = str(inm.get('id') or ''); moves.append(mid)
        la = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1495A{stamp}', 'expiresOn': d20, 'qty': 6, 'moveId': mid}, TS)
        lb = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1495B{stamp}', 'madeOn': today, 'expiresOn': d200, 'qty': 4, 'moveId': mid}, TS)
        lots = [str(x.get('id')) for x in (la, lb) if x.get('id')]
        A, Bq = (lots + ['', ''])[:2]
        over = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1495C{stamp}', 'expiresOn': d200, 'qty': 1, 'moveId': mid}, TS)
        dup = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': f'T1495A{stamp}', 'expiresOn': d200, 'qty': 1}, TS)
        badno = call('POST', '/admin/qlt/lots', {'optionId': opt, 'lotNo': '-bad no', 'expiresOn': d200, 'qty': 1}, TS)
        dbsum = psql(f"INSERT INTO qlt_lots (option_id, lot_no, expires_on, in_kind, in_qty, in_move_id) VALUES ('{opt}', 'T1495D{stamp}', '{d200}', 'MOVE', 1, {int(mid or 0)}) RETURNING id")
        # 출고 7(수출 등 주문 아닌 줄 — 바로) → A 6 · B 1(FEFO)
        o1 = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ('{opt}', '{today}', 'OUT_SALE', -7, 'T1495:{stamp}:1') RETURNING id").split('\n')[0]; moves.append(o1)
        call('POST', '/admin/jobs', {'job': 'qlt_lot_alloc'}, TS); call('POST', '/admin/jobs', {'job': 'qlt_lot_alloc'}, TS)
        qa1, qb1 = lotq(A), lotq(Bq)
        mk1 = psql(f"SELECT mark FROM qlt_move_marks WHERE move_id = {int(o1 or 0)}")
        # 출고 5 → B 3 만 · 2 모자람(SHORT)
        o2 = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ('{opt}', '{today}', 'OUT_SALE', -5, 'T1495:{stamp}:2') RETURNING id").split('\n')[0]; moves.append(o2)
        call('POST', '/admin/jobs', {'job': 'qlt_lot_alloc'}, TS)
        mk2 = psql(f"SELECT mark || '|' || short_qty FROM qlt_move_marks WHERE move_id = {int(o2 or 0)}")
        qb2 = lotq(Bq)
        # 첫 출고 반입 7 → 나갔던 로트로(A +6 · B +1)
        amt = psql(f"SELECT -amount FROM acct_stock_moves WHERE id = {int(o1 or 0)}")
        r1 = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, amount, source_key) VALUES ('{opt}', '{today}', 'RETURN', 7, {int(amt or 0)}, 'T1495:{stamp}:1') RETURNING id").split('\n')[0]; moves.append(r1)
        call('POST', '/admin/jobs', {'job': 'qlt_lot_alloc'}, TS)
        qa3, qb3 = lotq(A), lotq(Bq)
        # 임박 알림(A 는 D-20 · 기준 30) — 두 번 돌려도 하나
        call('POST', '/admin/jobs', {'job': 'qlt_daily'}, TS); call('POST', '/admin/jobs', {'job': 'qlt_daily'}, TS)
        exa = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'QLT_LOT_EXPIRY' AND detail->>'lot' = '{A}' AND resolved_at IS NULL")
        exb = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'QLT_LOT_EXPIRY' AND detail->>'lot' = '{Bq}'")
        # 나간 곳(ADMIN · SUPER 만 · 감사)
        au0 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'QLT_LOT_TRACE'")
        tr = call('GET', f'/admin/qlt/lots/{Bq}/trace', None, TS)
        trp = call('GET', f'/admin/qlt/lots/{Bq}/trace', None, TP)
        au1 = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'QLT_LOT_TRACE'")
        srcs = sorted((x.get('sourceKey'), x.get('qty')) for x in tr.get('items') or [])
        # 상태 · 회수 · 조정
        rc0 = call('POST', f'/admin/qlt/lots/{Bq}/state', {'state': 'RECALL'}, TS)
        rc = call('POST', f'/admin/qlt/lots/{Bq}/state', {'state': 'RECALL', 'reason': '시험 1495 회수'}, TS)
        rca = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'QLT_LOT_RECALL' AND detail->>'lot' = '{Bq}' AND resolved_at IS NULL")
        back = call('POST', f'/admin/qlt/lots/{Bq}/state', {'state': 'OK'}, TS)
        adjp = call('POST', f'/admin/qlt/lots/{A}/adjust', {'qty': -1, 'reason': '시험 1495 폐기'}, TP)
        adj = call('POST', f'/admin/qlt/lots/{A}/adjust', {'qty': -1, 'reason': '시험 1495 폐기'}, TS)
        if adj.get('moveId'): moves.append(str(adj.get('moveId')))
        adjm = psql(f"SELECT kind || '|' || qty FROM acct_stock_moves WHERE id = {int(adj.get('moveId') or 0)}")
        qa4 = lotq(A)
        dbmv = psql(f"UPDATE qlt_lot_moves SET qty = qty WHERE lot_id = {int(A or 0)}")
        dbdl = psql(f"DELETE FROM qlt_lots WHERE id = {int(A or 0)}")
        dbno = psql(f"UPDATE qlt_lots SET lot_no = 'X{stamp}' WHERE id = {int(A or 0)}")
        dbneg = psql(f"INSERT INTO qlt_lot_moves (lot_id, kind, qty) VALUES ({int(A or 0)}, 'OUT', -999999)")
        sq = call('GET', '/admin/qlt/ship-queue', None, TS)
        pk = call('POST', '/admin/qlt/picks', {'orderId': '00000000-0000-0000-0000-000000000000', 'picks': []}, TS)
        lst = call('GET', '/admin/qlt/lots?soon=1', None, TS)
        det = call('GET', f'/admin/qlt/lots/{A}', None, TS)
        # 끄면 지금과 같음 — 새 출고에 로트를 붙이지 않음
        off2 = call('PUT', f'/admin/qlt/lot-products/{prod}', {'on': False}, TS)
        o3 = psql(f"INSERT INTO acct_stock_moves (option_id, moved_on, kind, qty, source_key) VALUES ('{opt}', '{today}', 'OUT_SALE', -1, 'T1495:{stamp}:3') RETURNING id").split('\n')[0]; moves.append(o3)
        call('POST', '/admin/jobs', {'job': 'qlt_lot_alloc'}, TS)
        mk3 = psql(f"SELECT count(*) FROM qlt_move_marks WHERE move_id = {int(o3 or 0)}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'qlt-lots'")
        ok('② 로트 — 회원 403 · 꺼진 상품 422 · 켜기 · 입고 10 → 로트 A 6(D-20) · B 4 · 입고 줄 넘침 422 · 같은 번호 409 · 번호 무늬 400 · DB 합 가드 · 출고 7 → A 0 · B 3(FEFO · DONE) · 출고 5 → SHORT 2 · B 0 · 반입 7 → A 6 · B 1 · 임박 알림 A 1(두 번) · B 없음 · 나간 곳(ADMIN 됨 · PAYOUT 403 · 감사 +1) · 회수 사유 422 · 회수 · 알림 · 회수 → 정상 409 · 조정 PAYOUT 403 · SUPER ADJUST −1 · DB 고치기 · 지우기 · 번호 · 0 아래 막음 · FEFO 제안 · 없는 주문 404 · 끄면 새 출고 그대로 · 권한 주소 9',
           mb.get('_err') == 403 and off.get('code') == 'QLT_LOT_OFF' and on.get('on') is True and bool(mid) and la.get('ok') is True and lb.get('ok') is True
           and over.get('_err') == 422 and dup.get('_err') == 409 and badno.get('_err') == 400 and 'QLT_LOT' in dbsum
           and (qa1, qb1, mk1) == ('0', '3', 'DONE') and mk2 == 'SHORT|2' and qb2 == '0' and (qa3, qb3) == ('6', '1')
           and exa == '1' and exb == '0' and tr.get('lot', {}).get('lotNo') == f'T1495B{stamp}' and trp.get('_err') == 403 and int(au1 or 0) == int(au0 or 0) + 1
           and (f'T1495:{stamp}:2', 3) in srcs and rc0.get('code') == 'QLT_REASON' and rc.get('state') == 'RECALL' and rca == '1' and back.get('_err') == 409
           and adjp.get('_err') == 403 and adjm == 'ADJUST|-1' and qa4 == '5' and '!' in dbmv and 'QLT_LOT' in dbdl and 'QLT_LOT' in dbno and 'QLT_LOT' in dbneg
           and isinstance(sq.get('items'), list) and pk.get('_err') == 404 and any(x.get('id') == A for x in lst.get('items') or []) and len(det.get('moves') or []) >= 4
           and off2.get('on') is False and mk3 == '0' and rmap == '9',
           f"{mb.get('_err')} {off.get('code')} {on.get('on')} mid {mid} {la.get('ok') or la} {lb.get('ok') or lb} · {over.get('_err')} {dup.get('_err')} {badno.get('_err')} {dbsum[-30:]} · "
           f"{qa1} {qb1} {mk1} · {mk2} {qb2} · {qa3} {qb3} · 임박 {exa} {exb} · 나간 곳 {tr.get('count')} {trp.get('_err')} 감사 {au0}→{au1} {srcs} · {rc0.get('code')} {rc.get('state')} {rca} {back.get('_err')} · "
           f"{adjp.get('_err')} {adjm} {qa4} · {dbmv[-15:]} {dbdl[-15:]} {dbno[-15:]} {dbneg[-15:]} · {pk.get('_err')} · {off2.get('on')} {mk3} · {rmap}")
    finally:
        ids = ','.join(x for x in moves if str(x).isdigit())
        lids = ','.join(x for x in lots if str(x).isdigit())
        psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_moves WHERE lot_id IN (SELECT id FROM qlt_lots WHERE lot_no LIKE 'T1495%{stamp}'); "
             f"DELETE FROM qlt_lot_picks WHERE lot_id IN (SELECT id FROM qlt_lots WHERE lot_no LIKE 'T1495%{stamp}'); DELETE FROM qlt_lots WHERE lot_no LIKE 'T1495%{stamp}';")
        if lids:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code IN ('QLT_LOT_EXPIRY', 'QLT_LOT_RECALL') AND detail->>'lot' IN ({','.join(repr(x) for x in lots if str(x).isdigit())});")
        psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code = 'QLT_LOT_SHORT' AND raised_at >= '{t0}';")
        if ids:
            psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_moves WHERE move_id IN ({ids}); DELETE FROM qlt_move_marks WHERE move_id IN ({ids}); "
                 f"DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source IN ('STOCK_IN', 'STOCK_ADJUST', 'COGS', 'COGS_RETURN') AND source_key IN ({','.join(repr(x) for x in moves if str(x).isdigit())})); "
                 f"DELETE FROM acct_entries WHERE source IN ('STOCK_IN', 'STOCK_ADJUST', 'COGS', 'COGS_RETURN') AND source_key IN ({','.join(repr(x) for x in moves if str(x).isdigit())}); "
                 f"DELETE FROM acct_stock_moves WHERE id IN ({ids});")
        if prod:
            if before == 'none':
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_lot_products WHERE product_id = '{prod}';")
            else:
                psql(f"SET session_replication_role = replica; UPDATE qlt_lot_products SET active = {before} WHERE product_id = '{prod}';")
        rm_role(paid, '1495')
    if ADMIN_WEB:
        r = admin_page('/#/qlt-lots', lambda pg, seen: seen.update(n=pg.locator('[data-qlt-lots]').count(), new=pg.locator('[data-qlt-lot-new]').count(), cnt=pg.locator('[data-qlt-lot-counts]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 로트 · 유통기한(셈 줄 · 로트 등록 칸 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('new') == 1 and seen.get('cnt') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
