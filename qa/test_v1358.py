"""v10.358 (D236 · docs/492) 급한 알림 당번
  ① (코드) D236 표 · 칸 · API · 정기 작업 · 화면 · 문서 492 · 판 v10.358
  ② (API) 요일 · 정하기 · 422 · 403
  ③ (정기 작업) launch_watch 당번 보내기
  ④ (화면) 당번 상자
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

M26 = rd('prisma/migrations/D226_faq_feedback_inquiry_templates/migration.sql')
FB, TC = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/support/inquiry-template.controller.ts')
FS, AM = rd('src/modules/help/faq-admin.service.ts'), rd('src/app.module.ts')
HUB, FA, DESK = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
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


M36, OC, SC, SB, OA = rd('prisma/migrations/D236_staff_session_oncall_password/migration.sql'), rd('src/modules/admin/oncall.controller.ts'), rd('src/worker/scheduler.service.ts'), rd('web/src/app/admin/SecurityBoxes.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 코드 — D236 당번 표(요일 7) · 알림 칸 둘 · API(ADMIN · SUPER 읽기 · SUPER 정하기 · 감사 · 운영 역할만) · 정기 작업(당번 개인 · 30분 SUPER) · 화면 · 문서 492 · 판 v10.358',
   'CREATE TABLE IF NOT EXISTS public.staff_oncall' in M36 and 'ADD COLUMN IF NOT EXISTS escalated_at' in M36 and "@Audit('ONCALL_SET', 'SETTING')" in OC and "'ONCALL_NOT_STAFF'" in OC
   and 'const oc = await this.oncallPush()' in SC and "raised_at < now() - interval '30 minutes'" in SC and "WHERE r.role = 'SUPER' AND s.telegram_chat IS NOT NULL" in SC
   and 'export function OncallBox' in SB and '<OncallBox />' in OA and '당번' in doc('492_') and VT >= (10, 358), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    em, adm = mk_staff('1358')
    consent_ok.agree(em, PW); TA = login(em)
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    g0 = call('GET', '/admin/oncall', None, TS)
    today = g0.get('today'); prev = next((r.get('accountId') for r in (g0.get('rows') or []) if r.get('dow') == today), None)
    try:
        p1 = call('PUT', f'/admin/oncall/{today}', {'accountId': adm}, TS)
        g1 = call('GET', '/admin/oncall', None, TS)
        t1 = next((r for r in (g1.get('rows') or []) if r.get('dow') == today), {})
        pb = call('PUT', f'/admin/oncall/{today}', {'accountId': buyer}, TS)
        p8 = call('PUT', '/admin/oncall/8', {}, TS)
        pa = call('PUT', f'/admin/oncall/{today}', {}, TA)
        ga = call('GET', '/admin/oncall', None, TA)
        gb = call('GET', '/admin/oncall', None, TB)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'ONCALL_SET' AND occurred_at > now() - interval '10 minutes'")
        ok('② API — 요일 7줄 · 오늘 · SUPER 고를 목록 · 시험 운영자를 오늘 당번 · 감사 · 운영 역할 없는 계정 422 · 요일 8 422 · ADMIN 은 보기만(정하기 403 · 고를 목록 없음) · 회원 403',
           len(g0.get('rows') or []) == 7 and today in range(1, 8) and g0.get('canEdit') is True and len(g0.get('staff') or []) >= 1 and p1.get('ok') is True
           and t1.get('accountId') == adm and int(aud or 0) >= 1 and pb.get('code') == 'ONCALL_NOT_STAFF' and p8.get('code') == 'ONCALL_DOW'
           and pa.get('_err') == 403 and ga.get('canEdit') is False and ga.get('staff') == [] and gb.get('_err') == 403,
           f"{len(g0.get('rows') or [])} {today} · {t1.get('accountId') == adm} · {pb.get('code')} {p8.get('code')} · {pa.get('_err')} {ga.get('canEdit')} {gb.get('_err')}")
        j = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        oc = (j.get('detail') or {}).get('oncall') or {}
        ok('③ 정기 작업 — launch_watch 결과에 당번 보내기(점검판은 텔레그램 열쇠가 없으면 NO_TOKEN · 있으면 보낸 수)',
           j.get('_err') is None and (oc.get('reason') == 'NO_TOKEN' or isinstance(oc.get('oncall'), int)), f"{oc}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['box'] = pg.locator('[data-oncall]').get_attribute('data-oncall') if pg.locator('[data-oncall]').count() else None
                seen['dows'] = pg.locator('[data-oncall-dow]').count(); seen['picks'] = pg.locator('[data-oncall-pick]').count()
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 위험감지 › 운영 알림 › 「급한 알림 당번」 오늘 정해짐 · 요일 7칸 · 고르기 7 · 화면 오류 없음',
                   seen.get('box') == 'set' and seen.get('dows') == 7 and seen.get('picks') == 7 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        call('PUT', f'/admin/oncall/{today}', {'accountId': prev} if prev else {}, TS)
        rm_role(adm, '1358')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
