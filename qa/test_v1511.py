"""v10.511 (D275 · docs/649) 운영 화면 일괄 처리 — 대표 11/20 「㊺ ③」
  ① (코드) 검수 · 신고 · 1:1 문의 · 회원 — 기존 한 건 함수(decide · resolve · patch · setAccountStatus)를 줄마다 거래 안에서 · 감사 한 줄씩 · 최대 100 · 사유 · 실행 기록(쌓기만) · 화면 OPX-030 · 문서 649
  ② (API · DB) 회원 둘 일괄 정지(없는 번호 한 줄은 실패 · 다른 줄은 됨) · 감사 ACCOUNT_STATUS 줄마다(일괄 번호) · 상태 바뀐 기록 · 다시 정상 · 사유 없음 400 · 101줄 400 · 검수 담당은 회원 403 · 검수는 됨(없는 건 줄 실패) · 실행 기록 고치기 막음 · 회원 403
  ③ (화면) 회원 › 일괄 처리
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


M75 = migr('D275_')
stamp = int(time.time()) % 1000000
BK, OC, MN, AP, UI = (rd('src/modules/opx/bulk.ts'), rd('src/modules/opx/opx.controller.ts'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Opx.tsx'))
ok('① 코드 — 기존 한 건 함수 4개 · 줄마다 거래 · 감사 이름 같음(REVIEW_DECIDE · REPORT_RESOLVE · INQUIRY_UPDATE · ACCOUNT_STATUS) · BULK_MAX 100 · 사유 2 ~ 300(DB 와 같음) · opx_bulk_runs 쌓기만 · DTO ArrayMaxSize · 메뉴 회원 › 일괄 처리 · 화면 OPX-030 · 문서 649 · 판 v10.511',
   'd.review.decide(' in BK and 'd.abuse.resolve(' in BK and 'd.inquiry.patch(' in BK and 'd.member.setAccountStatus(' in BK and 'await d.db.transaction(async () =>' in BK
   and all(x in BK for x in ("'REVIEW_DECIDE'", "'REPORT_RESOLVE'", "'INQUIRY_UPDATE'", "'ACCOUNT_STATUS'")) and 'export const BULK_MAX = 100' in BK
   and 'CREATE TABLE IF NOT EXISTS public.opx_bulk_runs' in M75 and 'BETWEEN 2 AND 300' in M75 and 'trg_opx_bulk_runs_ro' in M75 and '@ArrayMaxSize(BULK_MAX)' in OC
   and "['opx-bulk', '일괄 처리']" in MN and "hrxAddTabs(GROUPS.find((g) => g.key === 'admusr')?.tabs, 'inquiries', ['opx-bulk'])" in MN and '<OpxBulk roles={roles} />' in AP
   and 'export function OpxBulk' in UI and '"SB-ADM-OPX-030"' in SJ and '100' in doc('649_') and VT >= (10, 511), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    a1 = a2 = rv = ''
    runs = []
    try:
        _, a1 = mk_staff(f'1511a{stamp % 97}', role=None)
        _, a2 = mk_staff(f'1511b{stamp % 89}', role=None)
        er, rv = mk_staff(f'1511r{stamp % 83}', 'REVIEWER')
        consent_ok.agree(er, PW)
        TR = login(er)
        ghost = '00000000-0000-4000-8000-0000000' + f'{stamp:05d}'[-5:]
        mb = call('POST', '/admin/opx/bulk/members', {'ids': [a1], 'action': 'SUSPEND', 'reason': '시험'}, TB)
        nor = call('POST', '/admin/opx/bulk/members', {'ids': [a1], 'action': 'SUSPEND', 'reason': ''}, TS)
        many = call('POST', '/admin/opx/bulk/members', {'ids': [ghost] * 101, 'action': 'SUSPEND', 'reason': '시험 1511'}, TS)
        b1 = call('POST', '/admin/opx/bulk/members', {'ids': [a1, a2, ghost], 'action': 'SUSPEND', 'reason': f'시험 1511 {stamp}'}, TS)
        run1 = str(b1.get('runId') or ''); runs.append(run1)
        st = psql(f"SELECT string_agg(status, ',' ORDER BY status) FROM accounts WHERE id IN ('{a1}', '{a2}')")
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'ACCOUNT_STATUS' AND after_data->>'bulkRun' = '{run1 or 0}'")
        chg = psql(f"SELECT count(*) FROM account_status_changes WHERE account_id IN ('{a1}', '{a2}') AND to_status = 'SUSPENDED' AND reason = '시험 1511 {stamp}'")
        fail = next((x for x in b1.get('results') or [] if x.get('id') == ghost), {})
        b2 = call('POST', '/admin/opx/bulk/members', {'ids': [a1, a2], 'action': 'ACTIVATE', 'reason': f'시험 1511 되돌림 {stamp}'}, TS)
        runs.append(str(b2.get('runId') or ''))
        st2 = psql(f"SELECT string_agg(status, ',') FROM accounts WHERE id IN ('{a1}', '{a2}')")
        rvm = call('POST', '/admin/opx/bulk/members', {'ids': [a1], 'action': 'SUSPEND', 'reason': '시험 1511'}, TR)
        rvr = call('POST', '/admin/opx/bulk/reviews', {'ids': [ghost], 'action': 'APPROVE', 'reason': '시험 1511 검수'}, TR)
        runs.append(str(rvr.get('runId') or ''))
        rej = call('POST', '/admin/opx/bulk/reviews', {'ids': [ghost], 'action': 'REJECT', 'reason': '시험 1511 반려'}, TS)
        lst = call('GET', '/admin/opx/bulk/runs', None, TS)
        upd = psql(f"UPDATE opx_bulk_runs SET reason = '바꿈' WHERE id = {int(run1 or 0)}")
        ok('② 일괄 처리 — 회원 403 · 사유 없음 400 · 101줄 400 · 셋 중 둘 정지(없는 번호 줄 실패) · 감사 줄마다 2 · 상태 바뀐 기록 2 · 다시 정상 · 검수 담당 회원 403 · 검수 담당 검수 됨(없는 건 줄 실패) · 반려 코드 없음 422 · 기록 목록 · 고치기 막음',
           mb.get('_err') == 403 and nor.get('_err') == 400 and many.get('_err') == 400
           and b1.get('total') == 3 and b1.get('ok') == 2 and b1.get('failed') == 1 and fail.get('ok') is False and st == 'SUSPENDED,SUSPENDED' and aud == '2' and chg == '2'
           and b2.get('ok') == 2 and st2 == 'ACTIVE,ACTIVE' and rvm.get('_err') == 403 and rvr.get('total') == 1 and rvr.get('failed') == 1
           and rej.get('_err') == 422 and rej.get('code') == 'OPX_BULK_REASON_CODE' and any(str(x.get('id')) == run1 for x in lst.get('items') or []) and 'append-only' in upd,
           f"{mb.get('_err')} {nor.get('_err')} {many.get('_err')} · {b1.get('total')} {b1.get('ok')} {b1.get('failed')} {fail} {st} {aud} {chg} · {b2.get('ok')} {st2} · {rvm.get('_err')} {rvr.get('total')} {rvr.get('failed')} · {rej.get('_err')} {rej.get('code')} · {upd[-30:]}")
    finally:
        for a in (a1, a2):
            if a:
                psql(f"UPDATE accounts SET status = 'ACTIVE' WHERE id = '{a}' AND status = 'SUSPENDED'")
        for r in runs:
            if r.isdigit():
                psql(f"SET session_replication_role = replica; DELETE FROM opx_bulk_runs WHERE id = {r};")
        if rv:
            rm_role(rv, '1511')
    if ADMIN_WEB:
        r = admin_page('/#/opx-bulk', lambda pg, seen: seen.update(n=pg.locator('[data-opx-bulk]').count(), kinds=pg.locator('[data-opx-bulk-kind]').count(), form=pg.locator('[data-opx-bulk-form]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 일괄 처리(종류 4 · 고르기 상자 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('kinds') == 4 and seen.get('form') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
