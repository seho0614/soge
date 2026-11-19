"""v10.410 (D249 · docs/547) 품의 · 전자결재
  ① (코드) D249 품의 표 · 결재 가드 · 연결 고유 · 허용 % · API 5 · 화면 · 문서 547
  ② (API · DB) 운영자 올리기 · 자기 것만 · SUPER 결재 · 본인 품의 결재 막음(API · DB) · 반려 사유
  ③ (API · DB) 매입에 연결 · 허용 % 넘으면 422 · 같은 매입 409 · 뒤로 · 지우기 막음 · 취소
  ④ (화면) 회계 › 품의
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
RQ = rd('src/modules/acct/requisitions.ts')
ok('① 코드 — D249 품의 표 · 결재 가드(SUPER · 본인 불가 · 앞으로만) · 연결 고유 · 허용 % 설정 · API 5 · 감사 · 화면 · 메뉴(운영자 누구나) · 문서 547 · 판 v10.410',
   'CREATE TABLE IF NOT EXISTS public.acct_requisitions' in M49 and 'fn_acct_requisition_guard' in M49 and 'ACCT_REQ_SELF' in M49 and 'uq_acct_req_used' in M49 and "'acct.req_tolerance_pct'" in M49
   and 'export async function useRequisition' in RQ and "'REQ_OVER'" in RQ
   and "@Get('requisitions')" in AC and "@Post('requisitions')" in AC and "@Post('requisitions/:id/decide')" in AC and "@Post('requisitions/:id/use')" in AC and "@Post('requisitions/:id/cancel')" in AC
   and "@Audit('ACCT_REQ_DECIDE', 'SETTING')" in AC and 'export function AcctRequisitions' in UI and "{tab === 'acct-requisitions' && <AcctRequisitions />}" in AP
   and "['acct-requisitions', '품의']" in MN and 'GET /admin/acct/requisitions' in SJ and '품의' in doc('547_') and VT >= (10, 410), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    ae, aid = mk_staff('1410', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
    kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
    d0 = kst.strftime('%Y-%m-%d')
    stamp = int(time.time()) % 1000000
    amt = 100000 + stamp % 9000
    mine = None
    try:
        r1 = call('POST', '/admin/acct/requisitions', {'title': f'시험 품의 1410-{stamp}', 'amount': amt, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1410 사무용품'}, TA)
        r2 = call('POST', '/admin/acct/requisitions', {'title': f'시험 품의 1410 넘음-{stamp}', 'amount': amt, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1410 넘음'}, TA)
        bad = call('POST', '/admin/acct/requisitions', {'title': f'시험 1410 계정', 'amount': amt, 'accountRole': 'CASH', 'reason': '시험 1410'}, TA)
        mem = call('POST', '/admin/acct/requisitions', {'title': '회원 1410', 'amount': 1000, 'accountRole': 'EXP_SUPPLIES', 'reason': '회원 1410'}, TB)
        la = call('GET', '/admin/acct/requisitions', None, TA)
        sm = call('POST', '/admin/acct/requisitions', {'title': f'시험 SUPER 본인 1410-{stamp}', 'amount': 5000, 'accountRole': 'EXP_SUPPLIES', 'reason': '시험 1410 본인'}, TS); mine = sm.get('id')
        self_ = call('POST', f'/admin/acct/requisitions/{mine}/decide', {'approve': True}, TS)
        bya = call('POST', f"/admin/acct/requisitions/{r1.get('id')}/decide", {'approve': True}, TA)
        rj0 = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/decide", {'approve': False}, TS)
        ap1 = call('POST', f"/admin/acct/requisitions/{r1.get('id')}/decide", {'approve': True, 'note': '시험 승인'}, TS)
        ap2 = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/decide", {'approve': True}, TS)
        ap1b = call('POST', f"/admin/acct/requisitions/{r1.get('id')}/decide", {'approve': True}, TS)
        dbself = psql(f"UPDATE acct_requisitions SET state = 'APPROVED', decided_by = requester, decided_at = now() WHERE id = {mine or 0}")
        own = la.get('items') or []
        ok('② 품의 · 결재 — 운영자 올리기 · 돈 계정 422 · 회원 403 · 운영자는 자기 것만 · SUPER 본인 품의 결재 422 · ADMIN 결재 403 · 반려 사유 없음 422 · 승인 · 두 번 409 · DB 도 본인 결재 막음',
           r1.get('ok') is True and bad.get('code') == 'REQ_ACCOUNT' and mem.get('_err') == 403 and la.get('all') is False and own and all(x.get('requester') == ae for x in own)
           and self_.get('code') == 'REQ_SELF' and bya.get('_err') == 403 and rj0.get('code') == 'REQ_REASON' and ap1.get('state') == 'APPROVED' and ap2.get('ok') is True
           and ap1b.get('code') == 'REQ_STATE' and 'ACCT_REQ' in dbself,
           f"{r1} · {bad.get('code')} · {mem.get('_err')} · {la.get('all')} {len(own)} · {self_.get('code')} · {bya.get('_err')} · {rj0.get('code')} · {ap1.get('state')} {ap2.get('ok')} · {ap1b.get('code')} · {dbself[-40:]}")
        biz = '7' + str(stamp).zfill(9)
        pb = {'kind': 'TAX_INVOICE', 'issuedOn': d0, 'supplierName': f'(주)시험품의1410-{stamp}', 'supplierBizNo': biz, 'item': f'품의 1410 {stamp}', 'accountRole': 'EXP_SUPPLIES', 'payRole': 'AP'}
        sup_ok = amt * 100 // 110            # 합계(공급가 + 10%)가 품의 금액 안
        p_ok = call('POST', '/admin/acct/purchases', dict(pb, supply=sup_ok, vat=sup_ok // 10), TS)
        p_big = call('POST', '/admin/acct/purchases', dict(pb, item=f'품의 1410 큰 {stamp}', supply=amt * 2, vat=amt // 5), TS)
        u1 = call('POST', f"/admin/acct/requisitions/{r1.get('id')}/use", {'kind': 'PURCHASE', 'refId': str(p_ok.get('id'))}, TS)
        u2 = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/use", {'kind': 'PURCHASE', 'refId': str(p_big.get('id'))}, TS)
        u3 = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/use", {'kind': 'PURCHASE', 'refId': str(p_ok.get('id'))}, TS)
        ua = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/use", {'kind': 'PURCHASE', 'refId': str(p_ok.get('id'))}, TA)
        st = psql(f"SELECT state || '|' || coalesce(used_kind, '') || '|' || coalesce(used_ref::text, '') FROM acct_requisitions WHERE id = {r1.get('id') or 0}")
        bk = psql(f"UPDATE acct_requisitions SET state = 'APPROVED' WHERE id = {r1.get('id') or 0}")
        dl = psql(f"DELETE FROM acct_requisitions WHERE id = {r1.get('id') or 0}")
        cx = call('POST', f"/admin/acct/requisitions/{r2.get('id')}/cancel", None, TA)
        ok('③ 연결 — 품의 안 금액 매입 연결 → 씀 · 품의보다 큰 매입 422(다시 품의) · 같은 매입 두 품의 409 · ADMIN 연결 403 · 뒤로 · 지우기 DB 가 막음 · 올린 사람 취소',
           u1.get('ok') is True and st == f"USED|PURCHASE|{p_ok.get('id')}" and u2.get('code') == 'REQ_OVER' and u3.get('code') == 'REQ_USED' and ua.get('_err') == 403
           and 'ACCT_REQ' in bk and 'ACCT_REQ' in dl and cx.get('ok') is True,
           f"{p_ok.get('id')} {p_big.get('id')} · {u1.get('ok')} {st} · {u2.get('code')} · {u3.get('code')} · {ua.get('_err')} · {bk[-30:]} · {dl[-30:]} · {cx.get('ok')}")
    finally:
        if mine:   # SUPER 본인 품의는 취소해 둠(공유 계정에 기다리는 품의가 남지 않게)
            call('POST', f'/admin/acct/requisitions/{mine}/cancel', None, TS)
        rm_role(aid, '1410')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-acct-requisitions]', timeout=30000)
            seen['sec'] = pg.locator('[data-acct-requisitions]').count()
            seen['form'] = pg.locator('[data-acct-req-form]').count()
            seen['wait'] = pg.locator('[data-acct-req-waiting]').count()
        res = admin_page('/#/acct-requisitions', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 회계 › 품의 · 올리기 칸 · 결재 기다림 수 · 화면 오류 없음', seen.get('sec') == 1 and seen.get('form') == 1 and seen.get('wait') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
