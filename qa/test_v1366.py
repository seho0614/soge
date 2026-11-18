"""v10.366 (D238 · docs/501) 개인정보 대량 내려받기 승인
  ① (코드) D238 · 4곳 @ExportGate · API · 화면 · 월간 보고 · 문서 501 · 판 v10.366
  ② (SUPER 혼자) 번호 없이 422 · 스스로 승인 · 받음 · 다시 422
  ③ (승인 흐름) 지급 담당 요청 → SUPER 승인 → 받음 · 403 · 409 · 422 · 둘째 SUPER 자기 결정 422 · 거절
  ④ (한도 · DB) 하루 10건 · 자기 승인 · 지우기 · 결정 뒤 바꾸기 막힘 · 감사
  ⑤ (화면) 위험감지 › 감사 › 「내려받기 승인」
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


M38, EA, OSC = rd('prisma/migrations/D238_export_requests_restore_drills/migration.sql'), rd('src/modules/admin/export-approval.ts'), rd('src/modules/admin/ops-safety.controller.ts')
GATES = [("src/modules/settlement/payout.controller.ts", "POINT_REPORT"), ("src/modules/govern/audit.controller.ts", "AUDIT_EXPORT"), ("src/modules/site/site.controller.ts", "NOTICE_READS"), ("src/modules/health/health-seller.controller.ts", "RATE_READS")]
TSX = ['Payouts.tsx', 'Audit.tsx', 'MainOps.tsx', 'HealthTypeRates.tsx']
AU, SR, AM = rd('web/src/app/admin/Audit.tsx'), rd('src/modules/admin/security-report.ts'), rd('src/app.module.ts')
ok('① 코드 — D238 export_requests(결정 한 번 · 쓰기 한 번 · 지우기 막음 · 자기 승인은 solo 만) · 4곳 @ExportGate · 가로채기 등록 · API · 감사 · 화면 4곳 승인 번호 · 「내려받기 승인」 상자 · 월간 보고 · 지우는 문장 없음 · 문서 501 · 판 v10.366',
   'CREATE TABLE IF NOT EXISTS public.export_requests' in M38 and 'trg_export_requests_guard' in M38 and "자기 요청은 다른 SUPER 가 승인합니다." in M38
   and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M38) and all(f"@ExportGate('{t}')" in rd(p) for p, t in GATES)
   and '{ provide: APP_INTERCEPTOR, useClass: ExportGateInterceptor }' in AM and "@Audit('EXPORT_REQUEST', 'SETTING')" in OSC and "@Audit('EXPORT_DECIDE', 'SETTING')" in OSC
   and all('exportTicket(' in rd('web/src/app/admin/' + f) and 'ticket' in rd('web/src/app/admin/' + f) for f in TSX) and '<ExportApprovalBox />' in AU
   and 'EXPORT_DAILY_MAX = 10' in EA and '개인정보 내려받기 ${s.exports}' in SR and '"POST /admin/export-requests/{id}/decide"' in SJ and '내려받기 승인' in doc('501_') and VT >= (10, 366), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    adm = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    others = int(psql(f"SELECT count(DISTINCT r.account_id) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE r.role = 'SUPER' AND a.status = 'ACTIVE' AND r.account_id <> '{adm}'") or 0)
    today = datetime.date.today().isoformat()
    e0 = call('GET', f'/admin/audit/export?from={today}&to={today}', None, TS)
    r1 = call('POST', '/admin/export-requests', {'target': 'AUDIT_EXPORT', 'reason': '시험 1366 감사 내려받기'}, TS)
    e1 = call('GET', f"/admin/audit/export?from={today}&to={today}&ticket={r1.get('id')}", None, TS) if r1.get('state') == 'APPROVED' else {}
    e2 = call('GET', f"/admin/audit/export?from={today}&to={today}&ticket={r1.get('id')}", None, TS)
    ok('② SUPER 혼자 — 번호 없이 422 EXPORT_NEED_APPROVAL · 요청하면 바로 승인(solo) · 받음(exportTicket) · 같은 번호 다시 422',
       e0.get('code') == 'EXPORT_NEED_APPROVAL' and (others > 0 or (r1.get('state') == 'APPROVED' and r1.get('solo') is True and (e1.get('csv') or '').startswith('﻿')
       and e1.get('exportTicket') == r1.get('id') and e2.get('code') == 'EXPORT_NEED_APPROVAL')),
       f"다른 SUPER {others} · {e0.get('code')} · {r1.get('state')} {r1.get('solo')} · {bool(e1.get('csv'))} {e1.get('exportTicket')} · {e2.get('code')}")
    emp, pid = mk_staff('1366p', 'PAYOUT'); ems, sid = mk_staff('1366s', 'SUPER')
    try:
        consent_ok.agree(emp, PW); consent_ok.agree(ems, PW)
        TP, T2 = login(emp), login(ems)
        mon = datetime.date.today().strftime('%Y-%m')
        q1 = call('POST', '/admin/export-requests', {'target': 'POINT_REPORT', 'reason': '시험 1366 신고 자료'}, TP)
        rdy = call('GET', '/admin/export-requests/ready?target=POINT_REPORT', None, TP)
        pd = call('POST', f"/admin/export-requests/{q1.get('id')}/decide", {'approve': True}, TP)
        ap = call('POST', f"/admin/export-requests/{q1.get('id')}/decide", {'approve': True}, TS)
        ag = call('POST', f"/admin/export-requests/{q1.get('id')}/decide", {'approve': True}, TS)
        x1 = call('GET', f"/admin/payouts/point-report?month={mon}&ticket={q1.get('id')}", None, TP)
        x2 = call('GET', f"/admin/payouts/point-report?month={mon}&ticket={q1.get('id')}", None, TP)
        pa = call('POST', '/admin/export-requests', {'target': 'AUDIT_EXPORT', 'reason': '시험 1366 권한 밖'}, TP)
        sh = call('POST', '/admin/export-requests', {'target': 'NOTICE_READS', 'reason': ' a '}, TS)
        s1 = call('POST', '/admin/export-requests', {'target': 'RATE_READS', 'reason': '시험 1366 둘째 SUPER'}, T2)
        sself = call('POST', f"/admin/export-requests/{s1.get('id')}/decide", {'approve': True}, T2)
        srej = call('POST', f"/admin/export-requests/{s1.get('id')}/decide", {'approve': False, 'note': '시험 거절'}, TS)
        lst = call('GET', '/admin/export-requests', None, TS)
        ok('③ 승인 흐름 — 지급 담당 요청 기다림 · ready 기다림 번호 · 지급 담당 결정 403 · SUPER 승인 · 두 번 409 · 신고 자료 받음 · 다시 422 · 권한 밖 대상 403 · 사유 1자 422 · 둘째 SUPER 요청 기다림 · 자기 결정 422 · 거절 · 목록',
           q1.get('state') == 'PENDING' and rdy.get('pendingId') == q1.get('id') and rdy.get('id') is None and pd.get('_err') == 403 and ap.get('state') == 'APPROVED'
           and ag.get('code') == 'EXPORT_DECIDED' and x1.get('filename') == f'point-withholding-{mon}.csv' and x2.get('code') == 'EXPORT_NEED_APPROVAL'
           and pa.get('_err') == 403 and sh.get('code') == 'EXPORT_REASON' and s1.get('state') == 'PENDING' and sself.get('code') == 'EXPORT_SELF_APPROVE'
           and srej.get('state') == 'REJECTED' and lst.get('canDecide') is True and any(r.get('id') == s1.get('id') and r.get('state') == 'REJECTED' for r in lst.get('recent') or []),
           f"{q1.get('state')} · {rdy} · {pd.get('_err')} · {ap.get('state')} {ag.get('code')} · {x1.get('filename')} {x2.get('code')} · {pa.get('_err')} {sh.get('code')} · {s1.get('state')} {sself.get('code')} {srej.get('state')}")
        psql(f"INSERT INTO export_requests (target, reason, requested_by, state, decided_by, decided_at) SELECT 'POINT_REPORT', '시험 1366 한도 ' || g, '{pid}', 'REJECTED', '{adm}', now() FROM generate_series(1, 10) g")
        lim = call('POST', '/admin/export-requests', {'target': 'POINT_REPORT', 'reason': '시험 1366 한도 넘음'}, TP)
        nid = psql(f"INSERT INTO export_requests (target, reason, requested_by) VALUES ('POINT_REPORT', '시험 1366 DB', '{pid}') RETURNING id").splitlines()[0]
        self_up = psql(f"UPDATE export_requests SET state = 'APPROVED', decided_by = requested_by, decided_at = now() WHERE id = {nid}")
        dl = psql(f"DELETE FROM export_requests WHERE id = {nid}")
        rj = psql(f"UPDATE export_requests SET state = 'REJECTED', decided_by = '{adm}', decided_at = now() WHERE id = {nid}")
        re2 = psql(f"UPDATE export_requests SET state = 'APPROVED' WHERE id = {nid}")
        fb = call('GET', '/admin/export-requests', None, TB)
        aud = psql("SELECT count(*) FILTER (WHERE action = 'EXPORT_REQUEST') || '|' || count(*) FILTER (WHERE action = 'EXPORT_DECIDE') FROM audit.audit_logs WHERE occurred_at > now() - interval '10 minutes'")
        a_, d_ = (aud.split('|') + ['0', '0'])[:2]
        ok('④ 한도 · DB — 하루 10건 넘으면 422 · DB 자기 승인 막힘 · 지우기 막힘 · 거절 한 번 됨 · 결정 뒤 바꾸기 막힘 · 감사 요청 · 결정 · 회원 403',
           lim.get('code') == 'EXPORT_DAILY_LIMIT' and 'EXPORT_REQUEST' in self_up and '!' in self_up and '!' in dl and '!' not in rj and '!' in re2
           and int(a_ or 0) >= 3 and int(d_ or 0) >= 2 and fb.get('_err') == 403,
           f"{lim.get('code')} · {self_up[-50:]} · {dl[-30:]} · {rj[-20:]} · {re2[-30:]} · 감사 {aud} · {fb.get('_err')}")
    finally:
        rm_role(pid, '1366p'); rm_role(sid, '1366s')
    if ADMIN_WEB:
        r = admin_page('/#/gov-audit', lambda pg, seen: seen.update(box=pg.locator('[data-export-approval]').count()))
        if r is None:
            print('  (playwright 없음 — ⑤ 건너뜀)')
        else:
            seen, perr = r
            ok('⑤ 화면 — 위험감지 › 감사 › 「내려받기 승인」 상자 · 화면 오류 없음', seen.get('box') == 1 and not perr, f'{seen} · {perr[:2]}')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
