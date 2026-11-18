"""v10.379 (D241 · docs/515) 점검 예정 회원 알림
  ① (코드) D241 · 정기 작업 · 상자 줄
  ② (작업) 24시간 안 · 한 번 · 문자 · 메일 닫음
  ③ (메일 켬) 새 시작 시각 · 문자만 닫음
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




M41, NJ, SC, OC, BX = rd('prisma/migrations/D241_setting_schedules_grace_mail_maint_notice_sessions/migration.sql'), rd('src/modules/admin/member-notice-jobs.ts'), rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/ops-staff.controller.ts'), rd('web/src/app/admin/OpsStaffBoxes.tsx')
ok('① 코드 — D241 maintenance_notices(쌓기만) · site.maintenance_mail(off) · 알림 종류 SITE_MAINTENANCE · 정기 작업 10분 · 문자 안 보냄 · 점검 상자 줄 · 문서 515 · 판 v10.379',
   'CREATE TABLE IF NOT EXISTS public.maintenance_notices' in M41 and "('site.maintenance_mail', 'off', 'ADMIN'" in M41 and "('SITE_MAINTENANCE', '사이트 점검 안내'" in M41 and "('maint_notice', 10," in M41
   and "SKIPPED: 점검 안내는 문자로 보내지 않음" in NJ and "case 'maint_notice':" in SC and 'notice: n ?' in OC and 'data-maintenance-notice=' in BX and '24시간' in doc('515_') and VT >= (10, 379), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    import random
    OFF = random.randint(0, 600)   # 두 번 돌림(a · b)이 같은 분이면 점검 시작 시각이 같아 「이미 보냄」 — 시작을 0 ~ 10시간 당겨 겹치지 않게
    kst = lambda h: (datetime.datetime.utcnow() + datetime.timedelta(hours=9 + h, minutes=-OFF if h < 24 else 0)).strftime('%Y-%m-%dT%H:%M')
    m0 = psql("SELECT value FROM site_settings WHERE key = 'site.maintenance_mail'")
    TAG = f"시험 1379 {int(time.time()) % 100000}"
    try:
        psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1379', true); UPDATE site_settings SET value = 'off' WHERE key = 'site.maintenance_mail'; COMMIT;")
        far = call('POST', '/admin/maintenance', {'from': kst(25), 'until': kst(26), 'note': TAG, 'reason': '시험 1379 멀리'}, TS)
        jf = call('POST', '/admin/jobs', {'job': 'maint_notice'}, TS)
        s1 = call('POST', '/admin/maintenance', {'from': kst(23), 'until': kst(24), 'note': TAG, 'reason': '시험 1379 가까이'}, TS)
        g0 = call('GET', '/admin/maintenance', None, TS)
        j1 = call('POST', '/admin/jobs', {'job': 'maint_notice'}, TS)
        act = psql("SELECT count(*) FROM accounts WHERE status = 'ACTIVE' AND withdrawn_at IS NULL")
        got = psql(f"SELECT count(*) FROM notifications WHERE event_code = 'SITE_MAINTENANCE' AND body LIKE '%{TAG}%'")
        dv = psql(f"SELECT count(*) FILTER (WHERE d.channel = 'SMS' AND d.status = 'FAILED' AND d.failed_reason LIKE 'SKIPPED%') || '|' || count(*) FILTER (WHERE d.channel = 'EMAIL' AND d.status = 'FAILED' AND d.failed_reason LIKE 'SKIPPED%') FROM notifications n JOIN notification_deliveries d ON d.notification_id = n.id WHERE n.event_code = 'SITE_MAINTENANCE' AND n.body LIKE '%{TAG}%'")
        q = psql(f"SELECT count(*) FROM v_notify_queue WHERE event_code = 'SITE_MAINTENANCE' AND body LIKE '%{TAG}%'")
        j2 = call('POST', '/admin/jobs', {'job': 'maint_notice'}, TS)
        g1 = call('GET', '/admin/maintenance', None, TS)
        nt = g1.get('notice') or {}
        ok('② 작업 — 25시간 뒤 점검은 아직 안 보냄 · 23시간 뒤 점검은 쓰는 회원 모두에게 사이트 알림 · 문자 · 메일 줄 SKIPPED(메일 꺼짐) · 대기열 0 · 다시 돌려도 0 · API notice(보낸 수 · 사이트 알림만)',
           far.get('ok') is True and (jf.get('detail') or {}).get('due') is False and s1.get('ok') is True and g0.get('notice') is None and g0.get('mail') is False
           and int(got or 0) == int(act or -1) and int(got) >= 1 and dv == f"{got}|{got}" and q == '0' and (j2.get('detail') or {}).get('already') is True
           and nt.get('sent') == int(got) and nt.get('mailed') is False,
           f"{(jf.get('detail') or {})} · 회원 {act} 알림 {got} · 닫음 {dv} · 대기 {q} · {(j2.get('detail') or {})} · {nt}")
        # ③ 메일 켬 — 시작 시각을 바꾸면 새로 한 번 · 메일 줄은 닫지 않음(문자만 닫음)
        psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1379 메일', true); UPDATE site_settings SET value = 'on' WHERE key = 'site.maintenance_mail'; COMMIT;")
        TAG2 = TAG + ' 메일'
        s2 = call('POST', '/admin/maintenance', {'from': kst(22), 'until': kst(23), 'note': TAG2, 'reason': '시험 1379 메일'}, TS)
        j3 = call('POST', '/admin/jobs', {'job': 'maint_notice'}, TS)
        dv2 = psql(f"SELECT count(*) FILTER (WHERE d.channel = 'SMS') || '|' || count(*) FILTER (WHERE d.channel = 'EMAIL') FROM notifications n JOIN notification_deliveries d ON d.notification_id = n.id WHERE n.event_code = 'SITE_MAINTENANCE' AND n.body LIKE '%{TAG2}%'")
        g2 = call('GET', '/admin/maintenance', None, TS)
        ro = psql("UPDATE maintenance_notices SET sent = 0 WHERE id = (SELECT max(id) FROM maintenance_notices)")
        sms_, mail_ = (dv2.split('|') + ['0', '0'])[:2]
        ok('③ 메일 켬 — 시작 시각을 바꾸면 새로 한 번 · 문자 줄만 닫음(메일은 메일 보내기가 가져감) · API mailed · 기록 고치기 막힘',
           s2.get('ok') is True and int((j3.get('detail') or {}).get('sent') or 0) >= 1 and int(sms_) >= 1 and mail_ == '0' and (g2.get('notice') or {}).get('mailed') is True and '!' in ro,
           f"{(j3.get('detail') or {})} · {dv2} · {g2.get('notice')} · {ro[-30:]}")
    finally:
        call('POST', '/admin/maintenance/clear', {'reason': '시험 1379 끝'}, TS)
        psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1379 되돌림', true); UPDATE site_settings SET value = '{m0 or 'off'}' WHERE key = 'site.maintenance_mail'; COMMIT;")
        psql(f"DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE event_code = 'SITE_MAINTENANCE' AND body LIKE '%{TAG}%'); "
             f"DELETE FROM notifications WHERE event_code = 'SITE_MAINTENANCE' AND body LIKE '%{TAG}%'")
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
