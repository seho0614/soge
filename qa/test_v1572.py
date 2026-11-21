"""v10.572 (docs/714) 10차 운영 기반 ④ 운영 알림 받을 사람 규칙 — 위험감지 › 알림 받을 사람 규칙(opb-alert-routes) · SUPER
  ① (코드) 표 · 처음 값(D220 13종 + 기본 *) · 기록 쌓기만 · 고르기 함수 · 스위치 둘 처음 off · 메일 · 텔레그램 · 슬랙 · 게시판 · 대기 수 연결 · 문서 714 · 판
  ② (DB · API) 처음 값 · 처음 규칙으로 고른 것 = 지금 함수 · 새 종류 규칙(WARN · 메일만 · 끄기 · 권한그룹 · 409) · 막힘(422 · 403) · 빼기 · 기록 고치기 막힘 · 스위치 잠깐 켜고 끔
  ③ (화면) 규칙 14줄 이상 · 기본 줄 · 고치기 · 꺼짐
  (두 번 돌아도 통과 — 「TEST1572_」 알림 · 규칙 · 기록은 시작 · 끝에 replica 로 지움 · 스위치는 처음 값으로 되돌림 · 만든 ADMIN 은 역할을 거둠)
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

"""시험 몸통"""
def migr_has(word):
    d = os.path.join(K, 'prisma', 'migrations')
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''

MG = migr_has('CREATE TABLE IF NOT EXISTS public.opb_alert_routes')
AR, OC = rd('src/modules/opb/alert-routes.ts'), rd('src/modules/opb/opb.controller.ts')
LW, SC = rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts')
MN, AP = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx')
D220 = ['SETTING_CHANGED', 'UPLOADS_BACKUP_FAILED', 'UPLOADS_BACKUP_BAD', 'ORDER_OPEN_EXPIRED', 'STAFF_LOGIN_NEW', 'AGENT_LIVE', 'AGENT_READY_GAP',
        'AGENT_CAP_NEAR', 'AGENT_STEP_READY', 'STAFF_IP_PASS_NEW', 'STAFF_IP_LOCKED', 'STAFF_IP_DAY_LIMIT', 'ASSUME_READY']
ok('① 코드 — 표 opb_alert_routes(처음 값 = D220 목록 13 + 기본 *) · 기록 쌓기만 · opb_alert_route_pending · 스위치 둘 처음 off · 메일 · 텔레그램 · 슬랙 · 게시판 · 대기 수가 규칙을 봄(off 면 지금 함수) · 권한그룹 메일 · 문서 714 · 판 v10.572',
   bool(MG) and all(f"'{c}'" in MG for c in D220) and "('*', 'CRITICAL'" in MG and 'trg_opb_alert_route_log_ro' in MG and 'opb_alert_route_pending' in MG
   and "('opb.alert_routes', 'off'" in MG and "('opb.alert_group_mail', 'off'" in MG and "alert_code <> 'AUDIT_CHAIN_BROKEN'" in MG
   and "(await opbRoutePending(this.db, 'mail')) ??" in LW and "opbRoutePending(this.db, ch === 'slack' ? 'slack' : 'telegram')" in LW and 'opbRouteBacklog(this.db' in LW
   and "(await opbRoutePending(this.db, 'board')) ??" in SC and 'opbGroupMail(this.db, this.mail, p.items)' in SC
   and "@Put('alert-routes/:code')" in OC and "@Roles('SUPER')" in OC and 'StateConflict' in AR and "'opb-alert-routes'" in MN and "'opb-alert-routes': ['SUPER']" in AP
   and '"SB-ADM-OPB-020"' in SJ and doc('714_') != '' and VT >= (10, 572), f"{len(MG)} {VER}")

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1572', 'ADMIN')
    CODE = f'TEST1572_{STAMP}'
    CLEAN = ("SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code LIKE 'TEST1572\\_%'; "
             "DELETE FROM opb_alert_routes WHERE alert_code LIKE 'TEST1572\\_%'; DELETE FROM opb_alert_route_log WHERE alert_code LIKE 'TEST1572\\_%' OR reason LIKE '시험 1572%';")
    psql(CLEAN)
    sw0 = getset('opb.alert_routes')
    try:
        consent_ok.agree(em, PW)
        TA = login(em)
        v = call('GET', '/admin/opb/alert-routes', None, TS)
        rules = {r.get('code'): r for r in (v.get('rules') or [])}
        base_ok = '*' in rules and all(c in rules for c in D220) and rules['*'].get('minSeverity') == 'CRITICAL' and all(rules[c].get('minSeverity') == 'INFO' for c in D220 if c in rules)
        ok('② 처음 값 — 기본 * = CRITICAL · D220 13종 = INFO · 네 길 · 60분 · 스위치 꺼짐(지금 동작) · ADMIN 은 403',
           base_ok and v.get('on') is False and v.get('groupMail') is False and all(rules[c].get('throttleMin') == 60 for c in rules if c in D220 or c == '*')
           and call('GET', '/admin/opb/alert-routes', None, TA).get('_err') == 403, f"{len(rules)} {v.get('on')} {v.get('_err')}")
        # 처음 규칙의 고르기 = 지금 함수(메일 · 텔레그램 · 슬랙 · 게시판 · 대기 수)
        same = psql(
            "SELECT (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM fn_ops_alert_mail_pending()) = (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM opb_alert_route_pending('mail', 50))"
            " AND (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM fn_ops_alert_push_pending()) = (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM opb_alert_route_pending('telegram', 50))"
            " AND (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM fn_ops_alert_slack_pending()) = (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM opb_alert_route_pending('slack', 50))"
            " AND fn_ops_alert_mail_backlog() = (SELECT count(*) FROM opb_alert_route_pending('mail', NULL))"
            " AND (SELECT coalesce(array_agg(o.id ORDER BY o.id), '{}') FROM (SELECT o.id FROM ops_alerts o WHERE o.board_posted_at IS NULL AND o.acknowledged_at IS NULL AND o.resolved_at IS NULL"
            "   AND o.raised_at > now() - interval '24 hours' AND (o.severity = 'CRITICAL' OR o.alert_code IN ('" + "', '".join(D220) + "'))"
            "   ORDER BY (o.severity = 'CRITICAL') DESC, o.id LIMIT 50) o) = (SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM opb_alert_route_pending('board', 50))")
        ok('② 처음 규칙으로 고른 것 = 지금 함수(메일 · 텔레그램 · 슬랙 50건 · 메일 대기 수 · 게시판 목록)', same == 't', same)
        # 새 종류 WARN 알림 하나 — 기본 줄(CRITICAL)이면 안 감 · 규칙(WARN · 메일만)이면 메일만 · 메일 끄면 안 감 · CRITICAL 은 게시판 늘
        psql(f"INSERT INTO ops_alerts (alert_code, severity, title, raised_at) VALUES ('{CODE}', 'WARN', '시험 1572 경고', clock_timestamp())")
        has = lambda ch: psql(f"SELECT count(*) FROM opb_alert_route_pending('{ch}', NULL) WHERE alert_code = '{CODE}'")
        h0 = (has('mail'), has('telegram'), has('board'))
        s1 = call('PUT', f'/admin/opb/alert-routes/{CODE}', {'minSeverity': 'WARN', 'toTelegram': False, 'toSlack': False, 'toBoard': False, 'groups': ['R_ADMIN'], 'reason': '시험 1572 만듦'}, TS)
        h1 = (has('mail'), has('telegram'), has('slack'), has('board'))
        v1 = call('GET', '/admin/opb/alert-routes', None, TS)
        r1 = next((r for r in (v1.get('rules') or []) if r.get('code') == CODE), {})
        s2 = call('PUT', f'/admin/opb/alert-routes/{CODE}', {'toMail': False, 'expectedUpdatedAt': r1.get('updatedAt'), 'reason': '시험 1572 메일 끔'}, TS)
        h2 = has('mail')
        s3 = call('PUT', f'/admin/opb/alert-routes/{CODE}', {'toMail': True, 'expectedUpdatedAt': r1.get('updatedAt'), 'reason': '시험 1572 옛 판'}, TS)
        ok('② 규칙 — 기본이면 WARN 안 감 · WARN · 메일만 규칙이면 메일만(텔레그램 · 슬랙 · 게시판 아님) · 메일 끄면 안 감 · 받을 권한그룹 저장 · 옛 updatedAt 이면 409',
           h0 == ('0', '0', '0') and s1.get('ok') is True and s1.get('created') is True and h1 == ('1', '0', '0', '0') and r1.get('groups') == ['R_ADMIN']
           and s2.get('ok') is True and h2 == '0' and s3.get('_err') == 409 and s3.get('code') == 'OPB_ROUTE_CHANGED', f"{h0} {s1} {h1} {r1} {s2} {h2} {s3}")
        e1 = call('PUT', '/admin/opb/alert-routes/AUDIT_CHAIN_BROKEN', {'toMail': False, 'reason': '시험 1572 막힘'}, TS)
        e2 = call('PUT', f'/admin/opb/alert-routes/{CODE}', {'groups': ['R_NOPE_1572'], 'reason': '시험 1572 없는 그룹'}, TS)
        e3 = call('POST', '/admin/opb/alert-routes/*/remove', {'reason': '시험 1572 기본 빼기'}, TS)
        e4 = call('PUT', f'/admin/opb/alert-routes/{CODE}', {'minSeverity': 'WARN', 'reason': '시험 1572 ADMIN'}, TA)
        e5 = call('PUT', '/admin/opb/alert-routes/bad-code', {'reason': '시험 1572 형식'}, TS)
        ok('② 막힘 — 위변조 의심 종류 422 OPB_ROUTE_LOCKED · 없는 권한그룹 422 · 기본 줄 빼기 422 · ADMIN 403 · 형식 422',
           e1.get('code') == 'OPB_ROUTE_LOCKED' and e2.get('code') == 'OPB_ROUTE_GROUP' and e3.get('code') == 'OPB_ROUTE_DEFAULT' and e4.get('_err') == 403
           and e5.get('_err') == 422 and e5.get('code') == 'OPB_ROUTE_CODE', f"{e1.get('code')} {e2.get('code')} {e3.get('code')} {e4.get('_err')} {e5}")
        rm = call('POST', f'/admin/opb/alert-routes/{CODE}/remove', {'reason': '시험 1572 빼기'}, TS)
        rm2 = call('POST', f'/admin/opb/alert-routes/{CODE}/remove', {'reason': '시험 1572 빼기 다시'}, TS)
        lg = psql(f"SELECT string_agg(action, ',' ORDER BY id) FROM opb_alert_route_log WHERE alert_code = '{CODE}'")
        ro = psql(f"UPDATE opb_alert_route_log SET reason = '고침' WHERE alert_code = '{CODE}'")
        ok('② 빼기 — 빼면 기본 줄을 따름(다시 빼면 404) · 기록 SET · SET · REMOVE 쌓임 · 기록은 고칠 수 없음(DB 가 막음)',
           rm.get('ok') is True and rm2.get('_err') == 404 and lg == 'SET,SET,REMOVE' and 'OPB_ROUTE_LOG_RO' in ro and has('mail') == '0', f"{rm} {rm2.get('_err')} {lg} {ro[-60:]}")
        # 스위치 — 잠깐 켜도 처음 규칙이라 동작이 같음 · 켜진 채 텔레그램 미리보기(서버 길)가 500 아님 · 바로 끔
        on = call('PUT', '/admin/opb/alert-route-settings', {'on': True, 'reason': '시험 1572 켜 봄'}, TS)
        pv = call('GET', '/admin/ops-alerts/push-preview', None, TS)
        off = call('PUT', '/admin/opb/alert-route-settings', {'on': False, 'reason': '시험 1572 끔'}, TS)
        ok('② 스위치 — 켜기 · 켜진 채 텔레그램 미리보기 됨(규칙 길) · 끄기 · 값은 다시 off · ADMIN 은 스위치 403',
           on.get('ok') is True and pv.get('_err') is None and off.get('ok') is True and getset('opb.alert_routes') == 'off'
           and call('PUT', '/admin/opb/alert-route-settings', {'on': False, 'reason': '시험 1572 ADMIN'}, TA).get('_err') == 403, f"{on} {str(pv)[:120]} {off}")
    finally:
        if sw0 in ('on', 'off') and getset('opb.alert_routes') != sw0:
            setting('opb.alert_routes', sw0, '1572 되돌림')
        psql(CLEAN)
        rm_role(aid, '1572')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def look(pg, seen):
        seen['rules'] = pg.get_attribute('[data-opb-routes]', 'data-opb-routes', timeout=20000) if pg.locator('[data-opb-routes]').count() else None
        seen['on'] = pg.get_attribute('[data-opb-routes]', 'data-opb-on') if pg.locator('[data-opb-routes]').count() else None
        seen['star'] = pg.locator('[data-opb-rule="*"]').count()
        seen['edit'] = pg.locator('[data-opb-edit]').count()
    u = admin_page('/#/opb-alert-routes', look)
    if u is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = u
        ok('③ 화면 — 위험감지 › 알림 받을 사람 규칙 · 규칙 14줄 이상 · 기본 줄 · 고치기 단추 · 꺼짐 표시 · 화면 오류 없음',
           (seen.get('rules') or '0').isdigit() and int(seen.get('rules') or 0) >= 14 and seen.get('star') == 1 and seen.get('edit', 0) >= 14 and seen.get('on') == 'off' and not perr,
           f"{seen} {perr[:2]}")
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
