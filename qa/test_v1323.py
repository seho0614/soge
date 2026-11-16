"""v10.323 (docs/450) 공지 등록 미리보기 — 노출 › 메인 운영 › 콘텐츠 › 공지 등록
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1323.py
  ① (코드) NoticePreview — 나오는 곳 · 게시 방식 · 알림 받을 회원 수(GET /admin/notices/audience) · 휴대폰 폭 · 공지 등록 칸 아래 · 문서 450 · 판 v10.323
  ② (API) audience — 회원 등급 받는 사람 수가 정수 (미리보기가 쓰는 값)
  ③ (운영 화면) 제목 · 회원 등급 · 상단 고정을 고르면 미리보기에 나오는 곳 3 · 알림 n명 · 제목 그대로 · 저장 안 함(공지 수 그대로)
"""
import datetime, json, os, re, subprocess, sys, time, urllib.error, urllib.request

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

MO = rd('web/src/app/admin/MainOps.tsx')
ok('① 코드 — 미리보기(나오는 곳 · 게시 방식 · 알림 받을 회원 수 · 휴대폰 360px) · 공지 등록 알림 줄 아래 · 문서 450 · 판 v10.323',
   'function NoticePreview(' in MO and '/admin/notices/audience?grades=' in MO.split('function NoticePreview(')[1].split('function NoticeFilesPick(')[0]
   and 'data-preview-where={where.length}' in MO and 'maxWidth: 360' in MO and '<NoticePreview title={f.title}' in MO
   and '미리보기' in doc('450_') and VT >= (10, 323), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TA = login('admin@x.com')
    au = call('GET', '/admin/notices/audience?grades=MEMBER', None, TA)
    ok('② API — audience(회원) 받는 사람 수 정수', isinstance(au.get('count'), int) and au.get('count') >= 1, str(au)[:120])
    n0 = psql('SELECT count(*) FROM notices')
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright and ADMIN_WEB:
        seen, perr = {}, []
        try:
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/mainops/content', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                card = pg.locator('#notice-form + div.card')
                pv = card.locator('[data-notice-preview]')
                seen['pv'] = pv.count()
                if pv.count():
                    seen['where0'] = pv.locator('[data-preview-where]').get_attribute('data-preview-where')
                    card.locator('input').first.fill('시험 1323 미리보기 제목')
                    card.locator('[data-grade-pick="MEMBER"]').check()
                    card.locator('label:has-text("상단 고정") input[type=checkbox]').first.check()
                    pg.wait_for_timeout(2500)
                    seen['where'] = pv.locator('[data-preview-where]').get_attribute('data-preview-where')
                    seen['notify'] = pv.locator('[data-preview-notify]').get_attribute('data-preview-notify')
                    seen['title'] = pv.locator('[data-preview-title]').inner_text()
                    pv.screenshot(path=os.path.join(HERE, 'v1323_preview.png'))
                b.close()
        except Exception as ex:
            perr.append(str(ex)[:160])
        ok('③ 운영 화면 — 등급 고르기 전 나오는 곳 0 → 회원 · 상단 고정이면 3 · 알림 n명(audience 와 같음) · 제목 그대로 · 저장 안 함 · 화면 오류 없음',
           seen.get('pv') == 1 and seen.get('where0') == '0' and seen.get('where') == '3' and seen.get('notify') == str(au.get('count'))
           and seen.get('title') == '시험 1323 미리보기 제목' and psql('SELECT count(*) FROM notices') == n0 and not perr, f'{seen} · {perr[:2]}')
    else:
        print('  (ADMIN_WEB · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② ~ ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
