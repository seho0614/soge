"""v10.368 (D238 · docs/503) DB 복원 시험 기록
  ① (코드) D238 restore_drills · 설정 · 업무 안내 · API · sla_alert · 화면 · 문서 503 · 판 v10.368
  ② (API · 정기 작업) 적기 · 알림 풀림 · 422 · 403 · 고치기 막힘
  ③ (화면) 관 관리 › 업무 안내 › 「DB 복원 시험 기록」
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


M38, SC, OSC, OG = rd('prisma/migrations/D238_export_requests_restore_drills/migration.sql'), rd('src/worker/scheduler.service.ts'), rd('src/modules/admin/ops-safety.controller.ts'), rd('web/src/app/admin/OpsGuide.tsx')
SR = rd('src/modules/admin/security-report.ts')
ok('① 코드 — D238 restore_drills(쌓기만) · 설정 ops.restore_drill_days · 업무 안내 RESTORE_DRILL · API(ADMIN 보기 · SUPER 적기 · 감사) · sla_alert RESTORE_DRILL_DUE · 업무 안내 화면 상자 · 월간 보고 · 문서 503 · 판 v10.368',
   'CREATE TABLE IF NOT EXISTS public.restore_drills' in M38 and 'trg_restore_drills_ro' in M38 and "('ops.restore_drill_days', '30', 'ADMIN'" in M38 and "SELECT 'RESTORE_DRILL'" in M38
   and "@Audit('RESTORE_DRILL_ADD', 'SETTING')" in OSC and 'const rd = await this.restoreDrillDue()' in SC and "this.alertOnce('RESTORE_DRILL_DUE', 'WARN'" in SC
   and '<RestoreDrillBox />' in OG and 'DB 복원 시험 ${s.drillLast' in SR and '"POST /admin/restore-drills"' in SJ and '복원 시험' in doc('503_') and VT >= (10, 368), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, aid = mk_staff('1368')
    try:
        consent_ok.agree(em, PW); TA = login(em)
        n0 = int(psql("SELECT count(*) FROM restore_drills") or 0)
        if n0 == 0:
            j0 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
            a0 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'RESTORE_DRILL_DUE' AND resolved_at IS NULL")
        else:
            a0 = '1'
        kst = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).date()
        p1 = call('POST', '/admin/restore-drills', {'drillDate': kst.isoformat(), 'snapshot': 'rds:sgb-db-drill-1368', 'minutes': 25, 'rowsMatch': True, 'ok': True, 'note': '시험 1368'}, TS)
        a1 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'RESTORE_DRILL_DUE' AND resolved_at IS NULL")
        j1 = call('POST', '/admin/jobs', {'job': 'sla_alert'}, TS)
        a2 = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'RESTORE_DRILL_DUE' AND resolved_at IS NULL")
        g = call('GET', '/admin/restore-drills', None, TS)
        fut = call('POST', '/admin/restore-drills', {'drillDate': (kst + datetime.timedelta(days=2)).isoformat(), 'snapshot': 'rds:x-1368', 'minutes': 5, 'rowsMatch': True, 'ok': True}, TS)
        bad = call('POST', '/admin/restore-drills', {'drillDate': kst.isoformat(), 'snapshot': 'a b', 'minutes': 5, 'rowsMatch': True, 'ok': True}, TS)
        ga = call('GET', '/admin/restore-drills', None, TA)
        pa = call('POST', '/admin/restore-drills', {'drillDate': kst.isoformat(), 'snapshot': 'rds:x-1368', 'minutes': 5, 'rowsMatch': True, 'ok': True}, TA)
        gb = call('GET', '/admin/restore-drills', None, TB)
        up = psql("UPDATE restore_drills SET minutes = 1 WHERE note = '시험 1368'")
        gd = call('GET', '/admin/ops-guides', None, TS)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'RESTORE_DRILL_ADD' AND occurred_at > now() - interval '10 minutes'")
        rd1 = ((j1.get('detail') or {}).get('restoreDrill') or {})
        ok('② API · 정기 작업 — (기록 없을 때 RESTORE_DRILL_DUE 열림) · 적기 → 알림 풀림 · 작업 뒤에도 0 · 지난 날 0 · 넘김 아님 · 미래 날짜 422 · 스냅샷 이름 422 · ADMIN 보기만(적기 403) · 회원 403 · 고치기 막힘 · 업무 안내 RESTORE_DRILL · 감사',
           a0 == '1' and p1.get('ok') is True and a1 == '0' and a2 == '0' and rd1.get('days') == 0 and g.get('daysSince') == 0 and g.get('overdue') is False and g.get('canEdit') is True
           and (g.get('last') or {}).get('snapshot') == 'rds:sgb-db-drill-1368' and fut.get('code') == 'RESTORE_DRILL_DATE' and bad.get('code') == 'RESTORE_DRILL_SNAPSHOT'
           and ga.get('canEdit') is False and pa.get('_err') == 403 and gb.get('_err') == 403 and '!' in up
           and any(r.get('code') == 'RESTORE_DRILL' for r in gd.get('rows') or []) and int(aud or 0) >= 1,
           f"n0 {n0} a {a0}{a1}{a2} · {rd1} · {g.get('daysSince')} {g.get('overdue')} · {fut.get('code')} {bad.get('code')} · {ga.get('canEdit')} {pa.get('_err')} {gb.get('_err')} · {up[-30:]} · 감사 {aud}")
        if ADMIN_WEB:
            def chk(pg, seen):
                seen['box'] = pg.locator('[data-restore-drills]').count(); seen['form'] = pg.locator('[data-restore-drill-form]').count()
                seen['guide'] = pg.locator('[data-ops-guide-row="RESTORE_DRILL"]').count(); seen['row'] = pg.locator('[data-restore-drill]').count()
            r = admin_page('/#/ops-guide', chk)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 관 관리 › 업무 안내 › 「DB 복원 시험 기록」 상자 · 표 · 적는 칸(SUPER) · 업무 「DB 복원 시험(월 1회)」 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('form') == 1 and seen.get('guide') == 1 and (seen.get('row') or 0) >= 1 and not perr, f'{seen} · {perr[:2]}')
    finally:
        rm_role(aid, '1368')
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
