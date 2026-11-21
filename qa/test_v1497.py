"""v10.497 (D272 · docs/635) 가동 감시 · 장애 공지 — 대표 11/20 「㊷ ①」
  ① (코드) 장애 공지 · 진행 글 · 감시 결과 · 대상 상태 · 설정 처음 off · 공개 상태 주소 · 결과 받기(토큰) · 연결 · 메뉴 · 화면 · 사용자 웹 띠 · /status · n8n 워크플로 · 문서
  ② (API · DB) 받기 꺼짐 · 토큰(SUPER) · 연속 실패 → UPTIME_DOWN 한 번 · 회복 · 장애 공지 올리기 → 공개 상태 · 끝남 · 끝난 공지 막음 · DB 막음 · 정리
  ③ (화면) 운영 화면 가동 · 장애 공지 · 사용자 웹 /status
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로) — 빈 값은 NULL 로(무늬 트리거가 '' 를 막는 키가 있음)"""
    v = 'NULL' if value is None or value == '' else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def callh(m_, p, b=None, t=None, headers=None):
    """머리글을 더 붙여 부름(감시 토큰 등)"""
    hd = {'content-type': 'application/json', **(headers or {})}
    if t:
        hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        body = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        try:
            bd = json.loads(e.read() or b'{}')
        except Exception:
            bd = {}
        return {'_err': e.code, 'code': bd.get('code'), 'message': bd.get('message')}


def http_get(url):
    """사용자 웹 정적 파일 · 화면(상태 · 머리글 · 본문 앞 2만 자)"""
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': 'Mozilla/5.0 qa'}), timeout=60)
        return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(200000).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, {}, ''
    except Exception as e:
        return 0, {}, str(e)[:120]


STAMP = int(time.time()) % 1000000


M72 = migr('D272_')
UT, UC, AM, SC, WK = (rd('src/modules/uptime/uptime.ts'), rd('src/modules/uptime/uptime.controller.ts'), rd('src/app.module.ts'),
                      rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
MN, APP, UI, OA = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/Uptime.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
LY, IB, STP, N8 = rd('site/src/app/layout.tsx'), rd('site/src/components/upt/IncidentBar.tsx'), rd('site/src/app/status/page.tsx'), rd('deploy/aws/n8n/uptime-watch.json')
try:
    n8 = json.loads(N8) if N8 else {}
except Exception:
    n8 = {}
ok('① 코드 — D272 장애 공지 · 진행 글(쌓기만 트리거) · 감시 결과 · 대상 상태 · 설정 uptime.report off · 토큰 지문 PRIVATE · 연속 실패 2 · 정기 작업 upt_daily · 공개 상태 /site/status · 결과 받기(토큰 timingSafeEqual) · UPTIME_DOWN 긴급 · 연결(app.module · scheduler · worker) · 메뉴 upt-status · 화면 UPT-010 · 사이트 띠 · /status · n8n 워크플로 · 문서 635 · 판 v10.497',
   'CREATE TABLE IF NOT EXISTS public.upt_incidents' in M72 and 'CREATE TABLE IF NOT EXISTS public.upt_incident_notes' in M72 and 'trg_upt_note_guard' in M72 and 'trg_upt_incident_guard' in M72
   and "('uptime.report', 'off', 'ADMIN'" in M72 and "('uptime.report_token_hash', '', 'PRIVATE'" in M72 and "('uptime.fail_count', '2'" in M72 and "VALUES ('upt_daily', 1440, 4, 50" in M72
   and "@Get('site/status')" in UC and "@Post('site/uptime/report')" in UC and 'timingSafeEqual' in UT and "'UPTIME_DOWN'" in UT and "'CRITICAL'" in UT and 'resetStatusCache' in UT
   and 'UptimeController' in AM and "case 'upt_daily'" in SC and "'upt_daily'," in WK and "['upt-status', '가동 · 장애 공지']" in MN and "'admrsk')?.tabs, 'sec-geo', ['upt-status']" in MN
   and "{tab === 'upt-status' && <UptStatus />}" in APP and 'export function UptStatus' in UI and 'MaintenanceBox' in UI and 'UPTIME_DOWN:' in OA
   and '<IncidentBar locale={locale} />' in LY and "apiGetPublic<PublicStatus>('/site/status', 60)" in IB and 'SB-HOM-UPT-010' in STP
   and any(x.get('type') == 'n8n-nodes-base.telegram' for x in n8.get('nodes', [])) and '/api/v1/site/uptime/report' in N8
   and '"SB-ADM-UPT-010"' in SJ and '"SB-HOM-UPT-010"' in SJ and 'n8n' in doc('635_') and VT >= (10, 497), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('uptime.report', 'uptime.report_token_hash', 'uptime.fail_count', 'uptime.keep_days')
    s0 = {k: getset(k) for k in keys}
    es, asf = mk_staff('1497a', 'ADMIN')
    tgt = f'T1497_{STAMP}'
    inc = None
    try:
        call('PUT', '/admin/uptime/settings', {'report': False, 'failCount': 2, 'reason': '시험 1497 처음'}, TS)
        off = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': True}]}, headers={'X-Uptime-Token': 'x' * 43})
        TA = login(es)
        tok_adm = call('POST', '/admin/uptime/token', {'reason': '시험 1497 ADMIN'}, TA)
        set_adm = call('PUT', '/admin/uptime/settings', {'report': True, 'reason': '시험 1497 ADMIN'}, TA)
        tk = call('POST', '/admin/uptime/token', {'reason': '시험 1497'}, TS)
        token = tk.get('token') or ''
        on = call('PUT', '/admin/uptime/settings', {'report': True, 'reason': '시험 1497 켬'}, TS)
        bad = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': True}]}, headers={'X-Uptime-Token': 'y' * 43})
        badt = callh('POST', '/site/uptime/report', {'checks': [{'target': 'bad', 'ok': True}]}, headers={'X-Uptime-Token': token})
        f1 = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': False, 'status': 0, 'ms': 10000, 'note': 'timeout'}]}, headers={'X-Uptime-Token': token})
        d1 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'UPTIME_DOWN' AND detail->>'target' = '{tgt}'")
        f2 = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': False, 'status': 503, 'ms': 40}]}, headers={'X-Uptime-Token': token})
        f3 = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': False, 'status': 503, 'ms': 40}]}, headers={'X-Uptime-Token': token})
        d2 = psql(f"SELECT count(*)::text || '|' || (SELECT down::text FROM upt_targets WHERE target = '{tgt}') FROM ops_alerts WHERE alert_code = 'UPTIME_DOWN' AND detail->>'target' = '{tgt}'")
        sev = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'UPTIME_DOWN' AND detail->>'target' = '{tgt}' LIMIT 1")
        up = callh('POST', '/site/uptime/report', {'checks': [{'target': tgt, 'ok': True, 'status': 200, 'ms': 120}]}, headers={'X-Uptime-Token': token})
        d3 = psql(f"SELECT count(*)::text || '|' || (SELECT down::text FROM upt_targets WHERE target = '{tgt}') FROM ops_alerts WHERE alert_code = 'UPTIME_RECOVERED' AND detail->>'target' = '{tgt}'")
        vw = call('GET', '/admin/uptime', None, TA)
        trow = next((x for x in vw.get('targets', []) if x.get('target') == tgt), {})
        ok('② 바깥 감시 — 받기 꺼짐 403 · ADMIN 토큰 · 설정 403 · SUPER 토큰(43자 · 한 번) · 켜기 · 틀린 토큰 403 · 대상 이름 400 · 1번 실패는 알림 없음 · 2번째에 UPTIME_DOWN(CRITICAL) 한 번 · 3번째 되풀이 없음 · 성공 → UPTIME_RECOVERED · 운영 화면 24시간 셈 4',
           off.get('_err') == 403 and off.get('code') == 'UPTIME_REPORT_OFF' and tok_adm.get('_err') == 403 and set_adm.get('_err') == 403 and len(token) == 43 and on.get('ok') is True
           and bad.get('code') == 'UPTIME_TOKEN_INVALID' and badt.get('_err') == 400 and f1.get('accepted') == 1 and d1 == '0' and f2.get('changed') and not f3.get('changed')
           and d2 == '1|true' and sev == 'CRITICAL' and up.get('changed') and d3 == '1|false' and trow.get('checks24') == 4,
           f"{off.get('code')} {tok_adm.get('_err')} {set_adm.get('_err')} {len(token)} {on.get('ok') or on} {bad.get('code')} {badt.get('_err')} {f1} {d1} {f2.get('changed')} {f3.get('changed')} {d2} {sev} {up.get('changed')} {d3} {trow}")
        cr = call('POST', '/admin/uptime/incidents', {'title': f'시험 1497 장애 {STAMP}', 'titleEn': 'Test 1497', 'level': 'MAJOR', 'parts': ['SITE', 'PAY'], 'body': '원인을 찾고 있습니다(시험).', 'banner': True, 'notifyOps': True}, TA)
        inc = cr.get('id')
        badp = call('POST', '/admin/uptime/incidents', {'title': '시험 1497', 'level': 'MAJOR', 'parts': ['NOPE'], 'body': '시험'}, TA)
        st1 = call('GET', '/site/status')
        has1 = any(x.get('id') == inc for x in st1.get('incidents', []))
        al = psql(f"SELECT severity FROM ops_alerts WHERE alert_code = 'UPT_INCIDENT' AND detail->>'incidentId' = '{inc}' ORDER BY id LIMIT 1")
        n1 = call('POST', f'/admin/uptime/incidents/{inc}/notes', {'state': 'IDENTIFIED', 'body': '원인을 찾았습니다(시험).'}, TA)
        n2 = call('POST', f'/admin/uptime/incidents/{inc}/notes', {'state': 'RESOLVED', 'body': '복구했습니다(시험).', 'bodyEn': 'Resolved (test).'}, TA)
        st2 = call('GET', '/site/status')
        gone = not any(x.get('id') == inc for x in st2.get('incidents', [])) and any(x.get('id') == inc for x in st2.get('recent', []))
        e1 = call('PUT', f'/admin/uptime/incidents/{inc}', {'title': '고침 시험'}, TA)
        e2 = call('PUT', f'/admin/uptime/incidents/{inc}', {'banner': False}, TA)
        n3 = call('POST', f'/admin/uptime/incidents/{inc}/notes', {'state': 'MONITORING', 'body': '끝난 뒤 글(시험)'}, TA)
        dd = psql(f"DELETE FROM upt_incidents WHERE id = {int(inc or 0)}")
        du = psql(f"UPDATE upt_incident_notes SET body = '바꿈' WHERE incident_id = {int(inc or 0)}")
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'upt-status'")
        ok('② 장애 공지 — 올리기(ADMIN) · 영향 범위 밖 400 · 공개 상태에 나옴(major) · 운영 알림 UPT_INCIDENT 긴급 · 진행 글 · 끝남 → 공개 상태에서 빠지고 최근에 · 끝난 공지 고치기 409 · 띠 끄기는 됨 · 끝난 공지 글 409 · DB 지우기 · 글 고치기 막음 · 권한 주소 6',
           bool(inc) and badp.get('_err') == 400 and has1 and st1.get('status') in ('major', 'maintenance') and al == 'CRITICAL' and n1.get('ok') is True and n2.get('state') == 'RESOLVED'
           and gone and e1.get('_err') == 409 and e1.get('code') == 'UPT_RESOLVED' and e2.get('ok') is True and n3.get('_err') == 409 and 'UPT_INCIDENT' in dd and 'UPT_NOTE' in du and rmap == '6',
           f"{inc} {badp.get('_err')} {has1} {st1.get('status')} {al} {n1.get('ok')} {n2.get('state')} {gone} {e1.get('code')} {e2.get('ok')} {n3.get('_err')} {dd[-40:]} {du[-40:]} {rmap}")
    finally:
        rm_role(asf, '1497')
        call('PUT', '/admin/uptime/settings', {'report': False, 'reason': '시험 1497 끔'}, TS)
        for k in keys:
            setting(k, s0[k], '1497 되돌림')
        psql(f"SET session_replication_role = replica; DELETE FROM upt_checks WHERE target = '{tgt}'; DELETE FROM upt_targets WHERE target = '{tgt}'; "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('UPTIME_DOWN', 'UPTIME_RECOVERED') AND detail->>'target' = '{tgt}';"
             + (f" DELETE FROM ops_alerts WHERE alert_code = 'UPT_INCIDENT' AND detail->>'incidentId' = '{inc}'; DELETE FROM upt_incident_notes WHERE incident_id = {int(inc)}; DELETE FROM upt_incidents WHERE id = {int(inc)};" if inc and str(inc).isdigit() else ''))
    if ADMIN_WEB:
        r = admin_page('/#/upt-status', lambda pg, seen: seen.update(n=pg.locator('[data-upt-status]').count(), rep=pg.locator('[data-upt-status]').first.get_attribute('data-upt-report') if pg.locator('[data-upt-status]').count() else None))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 가동 · 장애 공지(받기 표시 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rep') in ('on', 'off') and not perr, f"{seen} {perr[:2]}")
    if SITE:
        code, _, body = http_get(SITE + '/status')
        ok('③ 사용자 웹 — /status 서비스 상태(SB-HOM-UPT-010)', code == 200 and 'SB-HOM-UPT-010' in body, f'{code}')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
