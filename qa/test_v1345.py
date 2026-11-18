"""v10.345 (docs/479) 자주 묻는 질문 「미리보기」
  ① (코드) FaqPreview · 같은 찾기 규칙 · 표 · 고치는 칸 · 문서 479 · 판 v10.345
  ② (화면) 줄 미리보기 · 찾기 시험 · 저장 전 글 미리보기 · 저장 안 됨
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

FP, FA, HUB = rd('web/src/app/admin/FaqPreview.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('site/src/components/support/CsHub.tsx')
ok('① 코드 — 미리보기 부품(나오는 곳 · 숨김 띠 · 찾기 시험 · 고객센터와 같은 규칙) · 표 줄 · 고치는 칸 단추 · 서버 안 부름 · 문서 479 · 판 v10.345',
   'export function faqMatch' in FP and 'data-faq-preview-hit' in FP and 'data-faq-preview-hidden' in FP and 'data-faq-preview-where' in FP and 'api(' not in FP
   and "k.toLowerCase().includes(w) || w.includes(k.toLowerCase())" in FP and "k.toLowerCase().includes(word) || word.includes(k.toLowerCase())" in HUB
   and 'data-faq-preview-row' in FA and 'data-faq-preview-edit' in FA and '<FaqPreview' in FA and '미리보기' in doc('479_') and VT >= (10, 345), VER)
if API and DB and ADMIN_WEB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TA = login('admin@x.com')
    l0 = call('GET', '/admin/faqs', None, TA)
    rows = l0.get('rows') or []
    first = rows[0] if rows else {}
    def run(b, seen, perr):
        pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + '/#/faq', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
        btn = pg.locator(f'[data-faq-preview-row="{first.get("id")}"]')
        seen['btns'] = pg.locator('[data-faq-preview-row]').count()
        if btn.count():
            btn.click(); pg.wait_for_timeout(600)
            seen['box'] = pg.locator('[data-faq-preview]').count()
            seen['q'] = pg.locator('[data-faq-preview-item] summary').inner_text().strip()
            seen['where'] = pg.locator('[data-faq-preview-where]').inner_text().strip()
            pg.fill('input[name=faq-preview-word]', (first.get('question') or 'xx')[:2])
            seen['hit'] = pg.locator('[data-faq-preview-hit]').get_attribute('data-faq-preview-hit')
            pg.fill('input[name=faq-preview-word]', 'qzx없는낱말qzx')
            seen['miss'] = pg.locator('[data-faq-preview-hit]').get_attribute('data-faq-preview-hit')
            pg.screenshot(path=os.path.join(HERE, 'v1345_preview.png'), full_page=False)
            pg.locator('[data-faq-preview-close]').click(); pg.wait_for_timeout(300)
            seen['closed'] = pg.locator('[data-faq-preview]').count()
        pg.locator('[data-faq-new]').click(); pg.wait_for_timeout(400)
        pg.fill('input[name=faq-question]', '시험 1345 저장 전 질문'); pg.fill('textarea[name=faq-answer]', '시험 1345 저장 전 답')
        pg.fill('input[name=faq-link]', 'https://x.com'); pg.fill('input[name=faq-link-label]', '밖')
        pg.locator('[data-faq-preview-edit]').click(); pg.wait_for_timeout(400)
        seen['newq'] = pg.locator('[data-faq-preview-item] summary').inner_text().strip() if pg.locator('[data-faq-preview-item]').count() else ''
        seen['badlink'] = pg.locator('[data-faq-preview-badlink]').count()
        pg.fill('input[name=faq-question]', '시험 1345 저장 전 질문 고침'); pg.wait_for_timeout(300)
        seen['live'] = pg.locator('[data-faq-preview-item] summary').inner_text().strip() if pg.locator('[data-faq-preview-item]').count() else ''
    r = ui(run)
    if r is None:
        print('  (playwright 없음 — ② 건너뜀)')
    else:
        seen, perr = r
        l1 = call('GET', '/admin/faqs', None, TA)
        ok('② 화면 — 줄 「미리보기」 → 상자 · 질문 · 나오는 곳 · 찾기 시험(질문 낱말 나옴 · 없는 낱말 안 나옴) · 닫기 · 새 질문 칸 미리보기(저장 전 글 · 고치면 바로 · 밖 주소 경고) · 저장 안 됨 · 화면 오류 없음',
           seen.get('btns', 0) >= 1 and seen.get('box') == 1 and seen.get('q') == (first.get('question') or '').strip() and seen.get('where')
           and seen.get('hit') == 'question' and seen.get('miss') == 'none' and seen.get('closed') == 0
           and seen.get('newq') == '시험 1345 저장 전 질문' and seen.get('live') == '시험 1345 저장 전 질문 고침' and seen.get('badlink') == 1
           and len(l1.get('rows') or []) == len(rows) and not perr, f'{seen} · {len(rows)}→{len(l1.get("rows") or [])} · {perr[:2]}')
else:
    print('  (API · DB · ADMIN_WEB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
