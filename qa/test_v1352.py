"""v10.352 (D234 · docs/486) 고객센터 주간 보고
  ① (코드) D234 설정 · 정기 작업 · 글 · API · 화면 · 작업 이름 · 문서 486 · 판 v10.352
  ② (API) 미리 보기 글 · 지난주 월 ~ 일 · 회원 403
  ③ (정기 작업) cs_weekly → 운영 알림 · 운영자 게시판 · off 면 안 보냄
  ④ (화면) 주간 보고 미리 보기
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

M34, CW, CG = rd('prisma/migrations/D234_staff_ip_expiry_cs_weekly/migration.sql'), rd('src/modules/support/cs-weekly.ts'), rd('src/modules/support/cs-glance.controller.ts')
SC, WC, GW = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'), rd('web/src/app/admin/CsGlance.tsx')
ok('① 코드 — D234 설정 ops.cs_weekly · 정기 작업 cs_weekly(월요일 09:10) · 지난주 숫자 글 · 미리 보기 API · 정기 작업(텔레그램 · 슬랙 · 게시판 · 알림 · off) · 작업 이름 · 화면 · 문서 486 · 판 v10.352',
   "('ops.cs_weekly', 'on', 'ADMIN'" in M34 and "VALUES ('cs_weekly', 10080, 9, 10, 2, true" in M34 and 'export function csWeeklyText' in CW and "date_trunc('week', now() AT TIME ZONE 'Asia/Seoul')" in CW
   and "@Get('weekly')" in CG and "case 'cs_weekly':" in SC and "'CS_WEEKLY', 'INFO'" in SC and "key = 'ops.cs_weekly'" in SC and "'cs_weekly'," in WC
   and 'data-cs-weekly-toggle' in GW and 'cs_weekly' in doc('486_') and VT >= (10, 352), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    w = call('GET', '/admin/cs-glance/weekly', None, TA)
    st = w.get('stats') or {}
    try:
        f = datetime.date.fromisoformat(st.get('from') or ''); t = datetime.date.fromisoformat(st.get('to') or '')
        rng = f.weekday() == 0 and (t - f).days == 6 and t < datetime.date.today() + datetime.timedelta(days=1)
    except Exception:
        rng = False
    fb = call('GET', '/admin/cs-glance/weekly', None, TB)
    lines = (w.get('text') or '').split('\n')
    ok('② API — 미리 보기 글 8줄(제목 · 문의 · 해결 · 문의 전 해결 · 낱말 · 리드관 · 지금 · 끄기) · 지난주 월 ~ 일 · 회원 403',
       len(lines) == 8 and lines[0].startswith('[소개뱅크] 고객센터 주간 보고 ') and 'ops.cs_weekly' in lines[-1] and rng and isinstance(st.get('received'), int) and fb.get('_err') == 403,
       f"{lines[:2]} · {st.get('from')} ~ {st.get('to')} · {fb.get('_err')}")
    try:
        t0 = psql("SELECT now()")
        j1 = call('POST', '/admin/jobs', {'job': 'cs_weekly'}, TA)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'CS_WEEKLY' AND raised_at >= '{t0}'")
        bd = psql(f"SELECT count(*) FROM ops_board_posts WHERE title LIKE '고객센터 주간 보고%' AND created_at >= '{t0}'")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'ops.cs_weekly'")
        t1 = psql("SELECT now()")
        j2 = call('POST', '/admin/jobs', {'job': 'cs_weekly'}, TA)
        al2 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'CS_WEEKLY' AND raised_at >= '{t1}'")
        ok('③ 정기 작업 — cs_weekly → 운영 알림 CS_WEEKLY · 운영자 게시판 한 줄 · off 면 보내지 않음(알림 없음)',
           j1.get('_err') is None and al == '1' and bd == '1' and j2.get('_err') is None and (j2.get('detail') or {}).get('off') is True and al2 == '0',
           f"{al} {bd} · {j2.get('detail')} {al2}")
    finally:
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'ops.cs_weekly'")
    if ADMIN_WEB:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
            if pg.locator('[data-cs-weekly-toggle]').count():
                pg.locator('[data-cs-weekly-toggle]').click(); pg.wait_for_timeout(2000)
            seen['text'] = '고객센터 주간 보고' in (pg.locator('[data-cs-weekly]').inner_text() if pg.locator('[data-cs-weekly]').count() else '')
            pg.screenshot(path=os.path.join(HERE, 'v1352_weekly.png'), full_page=False)
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = r
            ok('④ 화면 — 첫 화면 「주간 보고 미리 보기」 → 글 · 화면 오류 없음', seen.get('text') and not perr, f'{seen} · {perr[:2]}')
    else:
        print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
