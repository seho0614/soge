"""v10.353 (docs/487) 막힌 접속 기록
  ① (코드) 요약 스크립트 · 타이머 · 접속 기록 줄 · API · 화면 · 알림 · 문서 487 · 판 v10.353
  ② (요약 스크립트) 흉내 기록 → 셈 · 뺄 것 뺌
  ③ (API) 요약 파일 없음 · 회원 403
  ④ (화면) 막힌 접속 상자
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

import gzip, shutil, tempfile
DS, AP, WI = rd('deploy/aws/nginx_deny_summary.py'), rd('deploy/aws/nginx-allow-apply.sh'), rd('deploy/aws/nginx-allow-watch-install.sh')
NS, ED, SC = rd('src/modules/identity/nginx-allow-script.ts'), rd('deploy/aws/nginx_admin_allow_edit.py'), rd('src/worker/scheduler.service.ts')
CT, SB, SA = rd('src/modules/identity/staff-ip.controller.ts'), rd('web/src/app/admin/SecurityBoxes.tsx'), rd('web/src/app/admin/StaffAccess.tsx')
LINE = 'access_log /var/log/nginx/sgb-admin-access.log;'
ok('① 코드 — 요약(403 · /api/ 뺌 · 7일 · 50) · 타이머 10분 · 접속 기록 줄(루트 적용 · 반영 스크립트 · 처음 준비) · API(ADMIN · SUPER · 가림) · 화면 · 알림 NGINX_DENIED_SPIKE · 문서 487 · 판 v10.353',
   "m.group(4) != '403' or m.group(3).startswith('/api/')" in DS and 'OnUnitActiveSec=10min' in WI and '/usr/local/sbin/sgb-nginx-deny-summary' in WI
   and LINE in AP and LINE in NS and LINE in ED and "@Get('admin/staff-access/denied')" in CT and "'NGINX_DENIED_SPIKE', 'WARN'" in SC
   and 'export function DeniedBox' in SB and '<DeniedBox' in SA and 'data-denied-pick' in SB and 'denied' in doc('487_') and VT >= (10, 353), VER)
T = tempfile.mkdtemp(prefix='t1353')
try:
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    f = lambda d: (now - d).strftime('%d/%b/%Y:%H:%M:%S +0900')
    L = [f'203.0.113.9 - - [{f(datetime.timedelta(minutes=i))}] "GET / HTTP/1.1" 403 153 "-" "x"' for i in range(120)]
    L += [f'203.0.113.9 - - [{f(datetime.timedelta(minutes=3))}] "GET /api/v1/admin/x HTTP/1.1" 403 50 "-" "x"',
          f'198.51.100.7 - - [{f(datetime.timedelta(days=2))}] "GET /assets/a.js HTTP/1.1" 403 153 "-" "x"',
          f'198.51.100.8 - - [{f(datetime.timedelta(days=9))}] "GET / HTTP/1.1" 403 153 "-" "x"',
          f'121.168.92.13 - - [{f(datetime.timedelta(minutes=1))}] "GET / HTTP/1.1" 200 900 "-" "x"', 'garbage line']
    log = os.path.join(T, 'a.log')
    open(log, 'w').write('\n'.join(L[:60]) + '\n'); open(log + '.1', 'w').write('\n'.join(L[60:]) + '\n')
    with gzip.open(log + '.2.gz', 'wt') as g: g.write(f'198.51.100.6 - - [{f(datetime.timedelta(days=3))}] "GET / HTTP/1.1" 403 153 "-" "x"\n')
    p = subprocess.run(['python3', '-I', os.path.join(K, 'deploy/aws/nginx_deny_summary.py')], capture_output=True, text=True,
                       env={**os.environ, 'SGB_DENY_LOG': log, 'SGB_DENY_OUT': os.path.join(T, 'out')})
    j = json.loads(open(os.path.join(T, 'out', 'denied.json')).read()) if os.path.exists(os.path.join(T, 'out', 'denied.json')) else {}
    rows = j.get('rows') or []
    ok('② 요약 스크립트 — 화면 403 120 · /api/ 403 뺌 · 9일 전 뺌 · 200 뺌 · .gz 읽음 · 많은 순 · 24시간 셈 · 주소',
       p.returncode == 0 and j.get('total7') == 122 and [r.get('ip') for r in rows] == ['203.0.113.9', '198.51.100.6', '198.51.100.7'] and rows[0].get('n7') == 120
       and rows[0].get('n24') == 120 and rows[0].get('paths') == ['/'] and rows[2].get('n24') == 0 and j.get('files') == 3, f"{p.stdout.strip()} · {j.get('total7')} · {[(r.get('ip'), r.get('n7'), r.get('n24')) for r in rows]}")
finally:
    shutil.rmtree(T, ignore_errors=True)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    d = call('GET', '/admin/staff-access/denied', None, TS)
    fb = call('GET', '/admin/staff-access/denied', None, TB)
    ok('③ API — 점검판에는 요약 파일이 없음(installed false · 빈 표) · SUPER 는 IP 전부 · 회원 403',
       d.get('installed') is False and d.get('rows') == [] and d.get('full') is True and fb.get('_err') == 403, f"{d} · {fb.get('_err')}")
    if ADMIN_WEB:
        def run(b, seen, perr):
            pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pg.goto(ADMIN_WEB + '/#/staff-access', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
            seen['box'] = pg.locator('[data-denied="off"]').count()
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ④ 건너뜀)')
        else:
            seen, perr = r
            ok('④ 화면 — 권한 계층 › 접속 인증 › 「막힌 접속」(설치 전 안내) · 화면 오류 없음', seen.get('box') == 1 and not perr, f'{seen} · {perr[:2]}')
else:
    print('  (API · DB 없음 — ③ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
