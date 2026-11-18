"""v10.377 (D241 · docs/513) 설정 예약 변경
  ① (코드) D241 · API · 정기 작업 · 화면
  ② (API) 막힘 · 예약 · 409 · 권한
  ③ (작업) 바꿈 · 실패 · 취소
  ④ (화면) 전체 설정 「예약 변경」
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




M41, OP, SC, WK, BX, AP = rd('prisma/migrations/D241_setting_schedules_grace_mail_maint_notice_sessions/migration.sql'), rd('src/modules/admin/ops-plan.controller.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/OpsPlanBoxes.tsx'), rd('web/src/App.tsx')
ok('① 코드 — D241 setting_schedules(쌓기만 · 키마다 하나) · 정기 작업 5분 · API(감사) · 같은 검사(updateSetting) · 실패 알림 · 전체 설정 탭 상자 · 지우는 문장 없음 · 문서 513 · 판 v10.377',
   'CREATE TABLE IF NOT EXISTS public.setting_schedules' in M41 and 'ux_setting_schedules_open' in M41 and 'trg_setting_schedules_guard' in M41 and "('setting_schedule', 5," in M41
   and not re.search(r'\b(DROP|TRUNCATE)\b', M41) and "@Audit('SETTING_SCHEDULE', 'SETTING')" in OP and "@Audit('SETTING_SCHEDULE_CANCEL', 'SETTING')" in OP
   and 'admin.updateSetting(d.key, d.value' in OP and "case 'setting_schedule':" in SC and "'SETTING_SCHEDULE_FAIL'" in SC and "'setting_schedule'," in WK
   and 'data-setting-schedules=' in BX and "<SettingScheduleBox /><SiteSettings />" in AP and '"GET /admin/setting-schedules"' in SJ and '예약 변경' in doc('513_') and VT >= (10, 377), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, aid = mk_staff('1377'); consent_ok.agree(em, PW); TA = login(em)
    KEY, KEY2 = 'ops.dispute_due_days', 'ops.settle_due_days'
    v0, w0 = psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'"), psql(f"SELECT value FROM site_settings WHERE key = '{KEY2}'")
    kst = lambda mins: (datetime.datetime.utcnow() + datetime.timedelta(hours=9, minutes=mins)).strftime('%Y-%m-%dT%H:%M')
    nv = '4' if v0 != '4' else '5'
    T0 = psql("SELECT now()")
    clean = lambda: psql("SET session_replication_role = replica; UPDATE setting_schedules SET canceled_at = now(), canceled_by = NULL, cancel_reason = '시험 1377 정리' "
                         f"WHERE setting_key IN ('{KEY}', '{KEY2}') AND canceled_at IS NULL AND done_at IS NULL")
    try:
        clean()
        sec = call('POST', '/admin/setting-schedules', {'key': 'ops.telegram_token', 'value': 'x', 'at': kst(30), 'reason': '시험 1377 비밀'}, TS)
        mo = call('POST', '/admin/setting-schedules', {'key': 'mall.order_open', 'value': 'on', 'at': kst(30), 'reason': '시험 1377 주문'}, TS)
        fmt = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': '99', 'at': kst(30), 'reason': '시험 1377 형식'}, TS)
        tm = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': nv, 'at': kst(3), 'reason': '시험 1377 시각'}, TS)
        same = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': v0, 'at': kst(30), 'reason': '시험 1377 같음'}, TS)
        r1 = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': nv, 'at': kst(30), 'reason': '시험 1377 예약'}, TS)
        dup = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': nv, 'at': kst(40), 'reason': '시험 1377 두 번'}, TS)
        la, pa, lb = call('GET', '/admin/setting-schedules', None, TA), call('POST', '/admin/setting-schedules', {'key': KEY2, 'value': '3', 'at': kst(30), 'reason': '시험 1377 ADMIN'}, TA), call('GET', '/admin/setting-schedules', None, TB)
        ls = call('GET', '/admin/setting-schedules', None, TS)
        mine = next((x for x in ls.get('waiting') or [] if x.get('id') == r1.get('id')), {})
        dl = psql(f"DELETE FROM setting_schedules WHERE id = {r1.get('id') or 0}")
        ch = psql(f"UPDATE setting_schedules SET value = '7' WHERE id = {r1.get('id') or 0}")
        ok('② API — 비밀 · 주문 받기 422 · 형식 422 · 10분 안 422 · 같은 값 422 · 예약 · 같은 키 409 · ADMIN 보기만(예약 403) · 회원 403 · 목록(지금 값) · 지우기 · 고치기 막힘',
           sec.get('code') == 'SETTING_SCHEDULE_KEY' and mo.get('code') == 'SETTING_SCHEDULE_KEY' and fmt.get('code') == 'SETTING_FORMAT' and tm.get('code') == 'SETTING_SCHEDULE_TIME'
           and same.get('code') == 'SETTING_SCHEDULE_SAME' and r1.get('ok') is True and dup.get('code') == 'SETTING_SCHEDULE_EXISTS'
           and la.get('canEdit') is False and pa.get('_err') == 403 and lb.get('_err') == 403 and mine.get('nowValue') == v0 and mine.get('value') == nv and '!' in dl and '!' in ch,
           f"{sec.get('code')} {mo.get('code')} {fmt.get('code')} {tm.get('code')} {same.get('code')} · {r1.get('ok')} {dup.get('code')} · {la.get('canEdit')} {pa.get('_err')} {lb.get('_err')} · {mine.get('nowValue')}→{mine.get('value')}")
        # ③ 시각이 되면 바꿈 — 시각을 DB 로 당김(쌓기만 트리거를 끄고) · 실패 하나는 형식에 걸리는 값을 DB 로 넣음
        r2 = call('POST', '/admin/setting-schedules', {'key': KEY2, 'value': '3' if w0 != '3' else '4', 'at': kst(30), 'reason': '시험 1377 실패'}, TS)
        psql(f"SET session_replication_role = replica; UPDATE setting_schedules SET run_at = now() - interval '1 minute' WHERE id IN ({r1.get('id') or 0}, {r2.get('id') or 0}); "
             f"UPDATE setting_schedules SET value = '99' WHERE id = {r2.get('id') or 0}")
        j = call('POST', '/admin/jobs', {'job': 'setting_schedule'}, TS)
        v1 = psql(f"SELECT value FROM site_settings WHERE key = '{KEY}'")
        w1 = psql(f"SELECT value FROM site_settings WHERE key = '{KEY2}'")
        st = psql(f"SELECT string_agg(result, ',' ORDER BY id) FROM setting_schedules WHERE id IN ({r1.get('id') or 0}, {r2.get('id') or 0})")
        hist = psql(f"SELECT count(*) FROM site_setting_changes WHERE key = '{KEY}' AND at >= '{T0}' AND reason LIKE '예약 #{r1.get('id')} — %'")
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SETTING_SCHEDULE_FAIL' AND raised_at >= '{T0}'")
        j2 = call('POST', '/admin/jobs', {'job': 'setting_schedule'}, TS)
        r3 = call('POST', '/admin/setting-schedules', {'key': KEY, 'value': v0, 'at': kst(60), 'reason': '시험 1377 되돌림 예약'}, TS)
        c3 = call('POST', f"/admin/setting-schedules/{r3.get('id')}/cancel", {'reason': '시험 1377 취소'}, TS)
        c4 = call('POST', f"/admin/setting-schedules/{r3.get('id')}/cancel", {'reason': '시험 1377 두 번'}, TS)
        aud = psql("SELECT count(*) FILTER (WHERE action = 'SETTING_SCHEDULE') || '|' || count(*) FILTER (WHERE action = 'SETTING_SCHEDULE_CANCEL') FROM audit.audit_logs WHERE occurred_at > now() - interval '10 minutes'")
        a_, c_ = (aud.split('|') + ['0', '0'])[:2]
        ok('③ 작업 — 시각이 된 예약을 바꿈(바뀐 기록 사유 「예약 #번호」) · 형식에 걸린 예약은 실패(값 그대로) · 실패 알림 · 다시 돌려도 0 · 취소 · 두 번 404 · 감사',
           '_err' not in j and v1 == nv and w1 == w0 and st == 'APPLIED,FAILED' and hist == '1' and int(al or 0) >= 1 and (j2.get('affected') == 0)
           and c3.get('ok') is True and c4.get('_err') == 404 and int(a_ or 0) >= 1 and int(c_ or 0) >= 1,
           f"{j.get('affected')} · {v0}→{v1} · {w0}={w1} · {st} · 기록 {hist} · 알림 {al} · {j2.get('affected')} · {c3.get('ok')} {c4.get('_err')} · 감사 {aud}")
    finally:
        clean()
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1377 되돌림', true); UPDATE site_settings SET value = '{v0}' WHERE key = '{KEY}'; UPDATE site_settings SET value = '{w0}' WHERE key = '{KEY2}'; COMMIT;")
        psql(f"UPDATE ops_alerts SET acknowledged_at = now(), resolved_at = now(), resolve_note = '시험 1377' WHERE alert_code = 'SETTING_SCHEDULE_FAIL' AND resolved_at IS NULL")
        rm_role(aid, '1377')
    if ADMIN_WEB:
        def chk(pg, seen):
            pg.wait_for_selector('[data-setting-schedules]', timeout=30000)
            seen['box'] = pg.locator('[data-setting-schedules]').count(); seen['form'] = pg.locator('[data-setting-schedule-form]').count()
            seen['settings'] = pg.locator('[data-site-settings]').count()
        res = admin_page('/#/settings', chk)
        if res is None: print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = res
            ok('④ 화면 — 정책 › 전체 설정 탭 위 「예약 변경」 상자 · 예약 칸(SUPER) · 설정 표 그대로 · 화면 오류 없음',
               seen.get('box') == 1 and seen.get('form') == 1 and seen.get('settings') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
