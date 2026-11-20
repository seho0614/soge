"""v10.494 (D271 · docs/632) 협력사(공급사) 평가 — 매입처 분기 평가 · 납기(국내 발주 입고일 ≤ 납기일) 자동 · 품질(클레임) · 가격 · 대응 · 가중 합 · 등급 · 확정 · 발주 납기일
  ① (코드) D271 qlt_po_due · qlt_sup_evals · 가드 · 설정 3 · QltController · 메뉴 qlt-supeval · 화면 QLT-010 · 문서 632
  ② (API · DB) 회원 403 · 납기 넣기(발주일 앞 422 · 입고 뒤 409 · DB 막음) · 입고 2(제때 1 · 늦음 1) → 납기 50 · 분기 무늬 400 · 매출처 422 · 저장 · 덮어쓰기 · 확정 · 확정 뒤 409 · DB 막음 · 권한 주소 5
  ③ (화면) 소개몰 › 협력사 평가
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
d3 = (kst - datetime.timedelta(days=3)).strftime('%Y-%m-%d')
period = f"{kst.year}-Q{(kst.month - 1) // 3 + 1}"

SV, QC, AM, MN, AP, UI = (rd('src/modules/qlt/supeval.ts'), rd('src/modules/qlt/qlt.controller.ts'), rd('src/app.module.ts'), rd('web/src/lib/adminMenu.ts'),
                         rd('web/src/App.tsx'), rd('web/src/app/admin/Quality.tsx'))
ok('① 코드 — D271 qlt_po_due(발주 상태만 · 지우지 않음) · qlt_sup_evals(분기 무늬 · 점수 0 ~ 100 · 등급 A ~ D · 확정 뒤 막음) · 설정 qlt.po_lead_days · eval_weights · eval_grades · 납기 자동(입고일 ≤ 납기) · QltController(/admin/qlt) · 메뉴 qlt-supeval(소개몰) · 화면 QLT-010 · 문서 632 · 판 v10.494',
   'CREATE TABLE IF NOT EXISTS public.qlt_po_due' in M71 and 'CREATE TABLE IF NOT EXISTS public.qlt_sup_evals' in M71 and "CHECK (period ~ '^[0-9]{4}-Q[1-4]$')" in M71
   and 'trg_qlt_po_due_guard' in M71 and 'trg_qlt_sup_eval_guard' in M71 and "('qlt.po_lead_days', '7'" in M71 and "('qlt.eval_weights', '30,40,15,15'" in M71 and "('qlt.eval_grades', '90,80,70'" in M71
   and "PERIOD_RE = /^[0-9]{4}-Q[1-4]$/" in SV and 'po.received_on <= po.due' in SV and 'export async function saveEval' in SV and "@Post('suppliers/evals/:id/confirm')" in QC
   and 'QltController' in AM and "['qlt-supeval', '협력사 평가']" in MN and "'hlt-open', 'qlt-lots', 'qlt-claims', 'qlt-supeval'" in MN and "{tab === 'qlt-supeval' && <QltSupEval />}" in AP
   and 'export function QltSupEval' in UI and '"SB-ADM-QLT-010"' in SJ and '납기' in doc('632_') and VT >= (10, 494), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    pid = cid = ''
    pos, purs, eids = [], [], []
    try:
        pid = psql(f"INSERT INTO acct_parties (kind, name) VALUES ('SUPPLIER', '시험 1494 공급사-{stamp}') RETURNING id").split('\n')[0]
        cid = psql(f"INSERT INTO acct_parties (kind, name) VALUES ('CUSTOMER', '시험 1494 매출처-{stamp}') RETURNING id").split('\n')[0]
        mb = call('GET', f'/admin/qlt/suppliers?period={period}', None, TB)
        p1 = call('POST', '/admin/acct/pos', {'partyId': pid, 'title': f'시험1494 발주A {stamp}', 'orderedOn': d3, 'lines': [{'item': '시험 원료 A', 'qty': 10, 'unitPrice': 1000 + stamp % 97}]}, TS)
        p2 = call('POST', '/admin/acct/pos', {'partyId': pid, 'title': f'시험1494 발주B {stamp}', 'orderedOn': d3, 'lines': [{'item': '시험 원료 B', 'qty': 5, 'unitPrice': 2000 + stamp % 89}]}, TS)
        pos = [str(p.get('id') or '') for p in (p1, p2) if p.get('id')]
        bad_due = call('PUT', f"/admin/qlt/pos/{p1.get('id')}/due", {'dueOn': '2000-01-01'}, TS)
        due1 = call('PUT', f"/admin/qlt/pos/{p1.get('id')}/due", {'dueOn': today}, TS)
        due2 = call('PUT', f"/admin/qlt/pos/{p2.get('id')}/due", {'dueOn': d3}, TS)
        r1 = call('POST', f"/admin/acct/pos/{p1.get('id')}/receive", {'date': today, 'kind': 'SIMPLE'}, TS)
        r2 = call('POST', f"/admin/acct/pos/{p2.get('id')}/receive", {'date': today, 'kind': 'SIMPLE'}, TS)
        purs = [str(r.get('purchaseId') or '') for r in (r1, r2) if r.get('purchaseId')]
        after = call('PUT', f"/admin/qlt/pos/{p1.get('id')}/due", {'dueOn': today}, TS)
        dbdue = psql(f"UPDATE qlt_po_due SET due_on = due_on + 1 WHERE po_id = {int(p1.get('id') or 0)}")
        lst = call('GET', f'/admin/qlt/suppliers?period={period}', None, TS)
        row = next((x for x in lst.get('items') or [] if x.get('id') == pid), {})
        m = row.get('metrics') or {}
        late = (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(d3)).days
        badp = call('POST', '/admin/qlt/suppliers/evals', {'partyId': pid, 'period': '2026-Q5', 'priceScore': 80, 'responseScore': 90}, TS)
        cust = call('POST', '/admin/qlt/suppliers/evals', {'partyId': cid, 'period': period, 'priceScore': 80, 'responseScore': 90}, TS)
        ev = call('POST', '/admin/qlt/suppliers/evals', {'partyId': pid, 'period': period, 'priceScore': 80, 'responseScore': 90}, TS)
        exp_total = round((50 * 30 + 100 * 40 + 80 * 15 + 90 * 15) / 100, 1)
        ev2 = call('POST', '/admin/qlt/suppliers/evals', {'partyId': pid, 'period': period, 'priceScore': 70, 'responseScore': 90, 'memo': '시험 1494'}, TS)
        eid = str(ev.get('id') or ''); eids = [eid] if eid else []
        cf = call('POST', f'/admin/qlt/suppliers/evals/{eid}/confirm', {}, TS)
        ev3 = call('POST', '/admin/qlt/suppliers/evals', {'partyId': pid, 'period': period, 'priceScore': 10, 'responseScore': 10}, TS)
        cf2 = call('POST', f'/admin/qlt/suppliers/evals/{eid}/confirm', {}, TS)
        dbev = psql(f"UPDATE qlt_sup_evals SET memo = '바꿈' WHERE id = {int(eid or 0)}")
        dbdel = psql(f"DELETE FROM qlt_sup_evals WHERE id = {int(eid or 0)}")
        det = call('GET', f'/admin/qlt/suppliers/{pid}', None, TS)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'qlt-supeval'")
        ok('② 협력사 평가 — 회원 403 · 발주일 앞 납기 422 · 납기 넣기 2 · 입고 뒤 납기 409 · DB 도 막음 · 입고 2(제때 1 · 늦음 1) → 납기 50 · 늦은 날 · 품질 100(클레임 0) · 분기 무늬 400 · 매출처 422 · 저장(가중 합 · 등급) · 덮어쓰기 · 확정 · 확정 뒤 저장 409 · 다시 확정 409 · DB 고치기 · 지우기 막음 · 매입처 자세히 · 권한 주소 5',
           mb.get('_err') == 403 and bad_due.get('_err') == 422 and due1.get('ok') is True and due2.get('ok') is True and r1.get('ok') is True and r2.get('ok') is True
           and after.get('_err') == 409 and 'QLT_PO_DUE' in dbdue
           and m.get('poCount') == 2 and m.get('onTime') == 1 and m.get('delivery') == 50 and float(m.get('lateAvg') or 0) == float(late) and m.get('quality') == 100
           and badp.get('_err') == 400 and cust.get('code') == 'QLT_PARTY' and float(ev.get('total') or 0) == exp_total and ev.get('grade') == ('B' if exp_total >= 80 else 'C')
           and ev2.get('id') == eid and ev2.get('price') == 70 and cf.get('state') == 'FINAL' and ev3.get('_err') == 409 and cf2.get('_err') == 409
           and 'QLT_EVAL' in dbev and 'QLT_EVAL' in dbdel and any(x.get('period') == period and x.get('state') == 'FINAL' for x in det.get('evals') or [])
           and sum(1 for x in det.get('pos') or [] if x.get('id') in pos) == 2 and rmap == '5',
           f"{mb.get('_err')} {bad_due.get('_err')} {due1.get('ok')} {due2.get('ok')} {r1.get('ok')} {r2.get('ok')} · {after.get('_err')} {dbdue[-30:]} · {m} late {late} · {badp.get('_err')} {cust.get('code')} "
           f"{ev.get('total')}={exp_total} {ev.get('grade')} · {ev2.get('id')}={eid} {ev2.get('price')} {cf.get('state')} {ev3.get('_err')} {cf2.get('_err')} {dbev[-20:]} {dbdel[-20:]} · {rmap}")
    finally:
        for e in eids:
            psql(f"SET session_replication_role = replica; DELETE FROM qlt_sup_evals WHERE id = {int(e)};")
        for p in pos:
            if p.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_po_due WHERE po_id = {p}; DELETE FROM acct_po_lines WHERE po_id = {p}; DELETE FROM acct_pos WHERE id = {p};")
        for u in purs:
            if u.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM acct_lines WHERE entry_id IN (SELECT id FROM acct_entries WHERE source LIKE 'PURCHASE%' AND source_key = '{u}'); "
                     f"DELETE FROM acct_entries WHERE source LIKE 'PURCHASE%' AND source_key = '{u}'; DELETE FROM acct_purchases WHERE id = {u};")
        for x in (pid, cid):
            if x.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM qlt_sup_evals WHERE party_id = {x}; DELETE FROM acct_parties WHERE id = {x};")
    if ADMIN_WEB:
        r = admin_page('/#/qlt-supeval', lambda pg, seen: seen.update(n=pg.locator('[data-qlt-supeval]').count(), per=pg.locator('[data-qlt-period]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 협력사 평가(분기 고르기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('per') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
