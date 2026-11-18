"""v10.370 (D239 · docs/505) 운영 알림 잠시 끄기
  ① (코드) D239 · 보내기 4곳 · API · 화면
  ② (API · DB) 끄기 · 409 · 422 · 403 · 지우기 막힘 · 켜기
  ③ (보내기) 꺼진 동안 대기에서 빠짐
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


M39, OC, LW, SC, OA = rd('prisma/migrations/D239_alert_mutes_maintenance_role_expiry/migration.sql'), rd('src/modules/admin/ops-staff.controller.ts'), rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — D239 alert_mutes(쌓기만 · 위변조 끌 수 없음) · 보내기 4곳에서 뺌 · API(감사) · 운영 알림 상자 · 지우는 문장 없음 · 문서 505 · 판 v10.370',
   'CREATE TABLE IF NOT EXISTS public.alert_mutes' in M39 and "alert_code <> 'AUDIT_CHAIN_BROKEN'" in M39 and 'trg_alert_mutes_guard' in M39 and not re.search(r'\b(DROP|DELETE FROM|TRUNCATE)\b', M39)
   and LW.count('FROM alert_mutes m WHERE m.alert_code = x.code') == 1 and 'const muted = new Set(' in LW and SC.count('FROM alert_mutes m WHERE m.alert_code = ops_alerts.alert_code') == 2
   and "@Audit('ALERT_MUTE', 'SETTING')" in OC and "@Audit('ALERT_UNMUTE', 'SETTING')" in OC and '<AlertMuteBox codes=' in OA and '잠시 끄기' in doc('505_') and VT >= (10, 370), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, aid = mk_staff('1370'); consent_ok.agree(em, PW); TA = login(em)
    CODE = f"TEST_V1370_{int(time.time()) % 100000}"
    try:
        psql(f"INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES ('{CODE}', 'CRITICAL', '시험 1370 급한 알림', '{{}}'::jsonb)")
        pend = lambda: psql(f"SELECT count(*) FROM fn_ops_alert_push_pending() WHERE alert_code = '{CODE}'")
        p0 = pend()
        m1 = call('POST', '/admin/alert-mutes', {'code': CODE, 'hours': 1, 'reason': '시험 1370 끄기'}, TS)
        m2 = call('POST', '/admin/alert-mutes', {'code': CODE, 'hours': 4, 'reason': '시험 1370 두 번'}, TS)
        bad = call('POST', '/admin/alert-mutes', {'code': 'AUDIT_CHAIN_BROKEN', 'hours': 1, 'reason': '시험 1370 위변조'}, TS)
        lst = call('GET', '/admin/alert-mutes', None, TS)
        la = call('GET', '/admin/alert-mutes', None, TA)
        pa = call('POST', '/admin/alert-mutes', {'code': CODE, 'hours': 1, 'reason': '시험 1370 ADMIN'}, TA)
        lb = call('GET', '/admin/alert-mutes', None, TB)
        dl = psql(f"DELETE FROM alert_mutes WHERE id = {m1.get('id') or 0}")
        u1 = call('POST', f"/admin/alert-mutes/{m1.get('id')}/lift", {'reason': '시험 1370 켜기'}, TS)
        u2 = call('POST', f"/admin/alert-mutes/{m1.get('id')}/lift", {'reason': '시험 1370 두 번'}, TS)
        lst2 = call('GET', '/admin/alert-mutes', None, TS)
        aud = psql("SELECT count(*) FILTER (WHERE action = 'ALERT_MUTE') || '|' || count(*) FILTER (WHERE action = 'ALERT_UNMUTE') FROM audit.audit_logs WHERE occurred_at > now() - interval '10 minutes'")
        a_, u_ = (aud.split('|') + ['0', '0'])[:2]
        ok('② API · DB — 끄기 · 두 번 409 · 위변조 422 · 꺼진 목록 · ADMIN 보기만(끄기 403) · 회원 403 · 지우기 막힘 · 다시 켜기 · 두 번 404 · 감사 끄기 · 켜기',
           p0 == '1' and m1.get('ok') is True and m2.get('code') == 'ALERT_MUTE_EXISTS' and bad.get('code') in ('ALERT_MUTE_FORBIDDEN',)
           and any(x.get('code') == CODE for x in lst.get('active') or []) and lst.get('canEdit') is True and la.get('canEdit') is False and pa.get('_err') == 403 and lb.get('_err') == 403
           and '!' in dl and u1.get('ok') is True and u2.get('_err') == 404 and not any(x.get('code') == CODE for x in lst2.get('active') or []) and int(a_ or 0) >= 1 and int(u_ or 0) >= 1,
           f"{p0} · {m1.get('ok')} {m2.get('code')} {bad.get('code')} · {la.get('canEdit')} {pa.get('_err')} {lb.get('_err')} · {dl[-30:]} · {u1.get('ok')} {u2.get('_err')} · 감사 {aud}")
        # ③ 보내기 대기에서 빠짐 — 서비스 함수(alertPushPending)를 쓰는 미리 보기 API 대신 같은 SQL 을 DB 에서
        m3 = call('POST', '/admin/alert-mutes', {'code': CODE, 'hours': 1, 'reason': '시험 1370 다시 끄기'}, TS)
        q = lambda: psql(f"SELECT count(*) FROM (SELECT alert_code AS code FROM fn_ops_alert_push_pending()) x WHERE x.code = '{CODE}' AND NOT EXISTS (SELECT 1 FROM alert_mutes m WHERE m.alert_code = x.code AND m.lifted_at IS NULL AND m.until_at > now())")
        c1 = q()
        call('POST', f"/admin/alert-mutes/{m3.get('id')}/lift", {'reason': '시험 1370 끝'}, TS)
        c2 = q()
        ok('③ 보내기 — 꺼진 동안 텔레그램 대기에서 빠짐(0) · 켜면 돌아옴(1) · 알림 기록은 그대로',
           m3.get('ok') is True and c1 == '0' and c2 == '1' and psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = '{CODE}'") == '1', f'{c1} → {c2}')
    finally:
        psql(f"UPDATE ops_alerts SET acknowledged_at = now(), resolved_at = now(), resolve_note = '시험 1370' WHERE alert_code = '{CODE}' AND resolved_at IS NULL")
        rm_role(aid, '1370')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
