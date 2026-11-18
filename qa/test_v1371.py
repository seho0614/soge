"""v10.371 (D239 · docs/506) 사이트 점검 중 화면
  ① (코드) 설정 · 레이아웃 · 사전 · API · 화면
  ② (API) 예약 · 422 · 403 · 공개 설정 · 지우기 · 기록 · 감사
  ③ (화면) 사용자 웹 점검 중 → 원래대로
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


M39, OC, LY, MT, LWX = rd('prisma/migrations/D239_alert_mutes_maintenance_role_expiry/migration.sql'), rd('src/modules/admin/ops-staff.controller.ts'), rd('site/src/app/layout.tsx'), rd('site/src/components/Maintenance.tsx'), rd('web/src/app/admin/LaunchWatch.tsx')
KO, EN = json.loads(rd('site/src/i18n/messages/ko.json') or '{}'), json.loads(rd('site/src/i18n/messages/en.json') or '{}')
MK = ['maintTitle', 'maintBody', 'maintUntil', 'maintContact', 'maintSoon']
ok('① 코드 — D239 설정 넷(GLOBAL) · 레이아웃 점검 화면 · 예정 띠 · 사전 한 · 영(글자만) · API(SUPER · 감사) · 첫 화면 「점검 예약」 · 문서 506 · 판 v10.371',
   "('site.maintenance_from', '', 'GLOBAL'" in M39 and "('site.maintenance_until', '', 'GLOBAL'" in M39 and "if (maint === 'on')" in LY and "maint === 'soon' && <MaintenanceSoon" in LY
   and 'export function maintenanceState' in MT and all(isinstance(KO.get('common', {}).get(k), str) and isinstance(EN.get('common', {}).get(k), str) for k in MK)
   and "@Audit('SITE_MAINTENANCE_SET', 'SETTING')" in OC and '<MaintenanceBox />' in LWX and '점검' in doc('506_') and VT >= (10, 371), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    em, aid = mk_staff('1371'); consent_ok.agree(em, PW); TA = login(em)
    kst = lambda m: (datetime.datetime.utcnow() + datetime.timedelta(hours=9, minutes=m)).strftime('%Y-%m-%dT%H:%M')
    try:
        s1 = call('POST', '/admin/maintenance', {'from': kst(120), 'until': kst(180), 'note': '시험 1371 점검', 'reason': '시험 1371 예약'}, TS)
        g1 = call('GET', '/admin/maintenance', None, TS)
        long_ = call('POST', '/admin/maintenance', {'from': kst(60), 'until': kst(60 + 13 * 60), 'reason': '시험 1371 긺'}, TS)
        past = call('POST', '/admin/maintenance', {'from': kst(-120), 'until': kst(-60), 'reason': '시험 1371 지남'}, TS)
        ga = call('GET', '/admin/maintenance', None, TA)
        pa = call('POST', '/admin/maintenance', {'from': kst(120), 'until': kst(180), 'reason': '시험 1371 ADMIN'}, TA)
        val = psql("SELECT value FROM site_settings WHERE key = 'site.maintenance_from'")
        pub = call('GET', '/site-settings/public')
        cl = call('POST', '/admin/maintenance/clear', {'reason': '시험 1371 지움'}, TS)
        g2 = call('GET', '/admin/maintenance', None, TS)
        hist = psql("SELECT count(*) FROM site_setting_changes WHERE key = 'site.maintenance_from' AND at > now() - interval '10 minutes'")
        aud = psql("SELECT count(*) FILTER (WHERE action = 'SITE_MAINTENANCE_SET') || '|' || count(*) FILTER (WHERE action = 'SITE_MAINTENANCE_CLEAR') FROM audit.audit_logs WHERE occurred_at > now() - interval '10 minutes'")
        ok('② API — 예약(2시간 뒤 · 1시간) · 상태 soon 아님(24시간 안이라 soon) · 12시간 넘음 422 · 지난 시각 422 · ADMIN 보기만(403) · 설정 값 +09:00 · 공개 설정에 나옴 · 지우기 · 바뀐 기록 · 감사',
           s1.get('ok') is True and g1.get('from') == kst(120) and g1.get('soon') is True and g1.get('on') is False and long_.get('code') == 'MAINTENANCE_TIME' and past.get('code') == 'MAINTENANCE_TIME'
           and ga.get('canEdit') is False and pa.get('_err') == 403 and val.endswith('+09:00') and (pub.get('site.maintenance_from') or '').endswith('+09:00')
           and cl.get('ok') is True and g2.get('from') is None and int(hist or 0) >= 2 and int(aud.split('|')[0] or 0) >= 1 and int(aud.split('|')[-1] or 0) >= 1,
           f"{s1.get('ok')} · {g1} · {long_.get('code')} {past.get('code')} · {ga.get('canEdit')} {pa.get('_err')} · {val} · {cl.get('ok')} {g2.get('from')} · 기록 {hist} · 감사 {aud}")
        if SITE:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000); seen['before'] = pg.locator('[data-maintenance="on"]').count()
                psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 1371 지금 점검', true); UPDATE site_settings SET value = '{kst(-5)}+09:00' WHERE key = 'site.maintenance_from'; UPDATE site_settings SET value = '{kst(30)}+09:00' WHERE key = 'site.maintenance_until'; COMMIT;")
                ok_on = False
                for _ in range(14):   # 사용자 웹 공개 설정 캐시 5분
                    pg.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000)
                    if pg.locator('[data-maintenance="on"]').count():
                        ok_on = True; break
                    pg.wait_for_timeout(25000)
                seen['on'] = ok_on; seen['text'] = pg.locator('main h1').first.inner_text()[:30] if ok_on else ''
                psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1371 원래대로', true); UPDATE site_settings SET value = '' WHERE key IN ('site.maintenance_from', 'site.maintenance_until'); COMMIT;")
                back = False
                for _ in range(16):   # 뒤 시험이 점검 화면에 걸리지 않게 — 원래 화면으로 돌아올 때까지 기다림
                    pg.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000)
                    if not pg.locator('[data-maintenance="on"]').count():
                        back = True; break
                    pg.wait_for_timeout(25000)
                seen['back'] = back
                pg.close()
            r = ui(run)
            psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1371 원래대로', true); UPDATE site_settings SET value = '' WHERE key IN ('site.maintenance_from', 'site.maintenance_until', 'site.maintenance_note', 'site.maintenance_note_en'); COMMIT;")
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 점검 전에는 원래 화면 · 시각 안이면 사용자 웹 「서비스 점검 중입니다」(설정 캐시 5분 안) · 지우면 원래 화면으로 돌아옴 · 화면 오류 없음',
                   seen.get('before') == 0 and seen.get('on') is True and seen.get('back') is True and '점검' in (seen.get('text') or '') and not perr, f'{seen} · {perr[:2]}')
    finally:
        psql("BEGIN; SELECT set_config('app.setting_reason', '시험 1371 정리', true); UPDATE site_settings SET value = '' WHERE key IN ('site.maintenance_from', 'site.maintenance_until', 'site.maintenance_note', 'site.maintenance_note_en') AND value <> ''; COMMIT;")
        rm_role(aid, '1371')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
