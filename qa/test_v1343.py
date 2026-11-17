"""v10.343 (docs/476) 사용자 웹 이용안내 「이렇게 이용하세요」 — 회원 · 파트너 이용 흐름 7(마이그레이션 없음)
  KIT=<kit> SITE=http://localhost:15174 python3 test_v1343.py
  ① (코드) /guide/flows · 이용안내 링크 · 사전(한 · 영) · screens.json · 문서 476 · 판 v10.343
  ② (화면) 흐름 7 · 바로 가기 7 · 링크
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

FP, GP, SJ = rd('site/src/app/guide/flows/page.tsx'), rd('site/src/app/guide/page.tsx'), rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/policy.json')); EN = json.loads(rd('site/src/i18n/messages/en/policy.json'))
except Exception:
    KO, EN = {}, {}
KEYS = ['join', 'earn', 'consult', 'buy', 'support', 'partner', 'affiliate']
ki, ei = (KO.get('flows') or {}).get('items') or {}, (EN.get('flows') or {}).get('items') or {}
same = all(k in ki and k in ei and len(ki[k].get('steps') or []) == len(ei[k].get('steps') or []) >= 3 for k in KEYS)
en_txt = json.dumps(EN.get('flows') or {}, ensure_ascii=False)
ok('① 코드 — /guide/flows 흐름 7 · 바로 가기 · 이용안내 링크 · 사전 한 · 영(흐름 7 · 단계 수 같음 · 영어에 한글 없음 · SoGaeBank 아님) · screens.json · 문서 476 · 판 v10.343',
   'data-screen="SB-HOM-ETC-050"' in FP and all(f"['{k}', " in FP for k in KEYS) and 'data-guide-flow-go' in FP and 'href="/guide/flows"' in GP
   and same and not re.search(r'[가-힣]', en_txt) and 'SoGaeBank' not in en_txt and KO.get('guide', {}).get('flowsLink') and EN.get('guide', {}).get('flowsLink')
   and '"SB-HOM-ETC-050"' in SJ and '/guide/flows' in doc('476_') and VT >= (10, 343), f'{VER} · 같음 {same}')
if SITE:
    def run(b, seen, perr):
        ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
        ps.goto(SITE + '/guide', wait_until='networkidle', timeout=120000)
        seen['link'] = ps.locator('[data-guide-flows]').count()
        r_ = ps.goto(SITE + '/guide/flows', wait_until='networkidle', timeout=120000)
        seen['status'] = r_.status if r_ else None
        seen['flows'] = ps.locator('[data-guide-flow]').count(); seen['go'] = ps.locator('[data-guide-flow-go]').count()
        seen['steps'] = ps.locator('[data-guide-flow="earn"] li').count()
        ps.screenshot(path=os.path.join(HERE, 'v1343_flows.png'), full_page=False)
        pm = b.new_page(viewport={'width': 390, 'height': 844}); pm.on('pageerror', lambda e: perr.append(str(e)[:120]))
        pm.goto(SITE + '/guide/flows', wait_until='networkidle', timeout=120000)
        seen['wide'] = pm.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    r = ui(run)
    if r is None:
        print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = r
        ok('② 화면 — 이용안내 링크 · /guide/flows 200 · 흐름 7 · 바로 가기 7 · 소개비 받기 단계 5 · 휴대폰 폭 가로 넘침 없음 · 화면 오류 없음',
           seen.get('link') == 1 and seen.get('status') == 200 and seen.get('flows') == 7 and seen.get('go') == 7 and seen.get('steps') == 5 and seen.get('wide') is True and not perr,
           f'{seen} · {perr[:2]}')
else:
    print('  (SITE 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
