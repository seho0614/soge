"""v10.340 (docs/473) 문의하기 폼 「혹시 이 질문인가요?」 · 「이걸로 해결됨」(D230)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1340.py
  ① (코드) D230 · POST /faq/{id}/deflect · SimilarFaq · 사전 · 운영 지표 · screens.json · 문서 473 · 판 v10.340 · 마이그레이션 268
  ② (API) 그날 +1 · 404 · 지표
  ③ (화면) 폼 비슷한 질문 · 해결됨
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

M30 = rd('prisma/migrations/D230_faq_deflect/migration.sql')
FB, SIM, FORM = rd('src/modules/help/faq-feedback.controller.ts'), rd('site/src/components/support/SimilarFaq.tsx'), rd('site/src/components/InquiryForm.tsx')
PG, SV, SJ = rd('site/src/app/support/new/page.tsx'), rd('src/modules/support/inquiry-admin.service.ts'), rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/forms.json'))['inq']; EN = json.loads(rd('site/src/i18n/messages/en/forms.json'))['inq']
except Exception:
    KO, EN = {}, {}
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D230(지우는 문장 없음) · 「이걸로 해결됨」 API · 문의하기 폼 비슷한 질문 3개 · 사전(한 · 영) · 운영 지표 「문의 전 해결」 · screens.json · 문서 473 · 판 v10.340 · 마이그레이션 268',
   'ADD COLUMN IF NOT EXISTS deflect' in M30 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M30) and "@Post(':id/deflect')" in FB
   and 'export function pickSimilar' in SIM and 'data-similar-yes' in SIM and '<SimilarFaq faqs={faqs} title={title} />' in FORM and 'faqs={hub}' in PG
   and KO.get('similarH') and EN.get('similarH') and 'deflected' in SV and '"POST /faq/{id}/deflect"' in SJ and 'D230' in doc('473_')
   and VT >= (10, 340) and len(mig) >= 268 and 'D230_faq_deflect' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TA = login('admin@x.com')
    cs = [f for f in call('GET', '/faq?channel=CS') if isinstance(f, dict)]
    f0 = next((f for f in cs if len(f.get('question', '')) >= 4), {})
    fid = f0.get('id')
    day = lambda: psql(f"SELECT coalesce(sum(deflect), 0) FROM faq_daily WHERE faq_id = '{fid}' AND day = (now() AT TIME ZONE 'Asia/Seoul')::date")
    hidden = psql("SELECT id FROM faqs WHERE NOT is_active LIMIT 1")
    s0 = call('GET', '/admin/inquiries/stats', None, TA)
    b0 = int(day() or 0)
    d1 = call('POST', f'/faq/{fid}/deflect', {})
    b1 = int(day() or 0)
    hd = call('POST', f'/faq/{hidden}/deflect', {}) if hidden else {'_err': 404}
    s1 = call('GET', '/admin/inquiries/stats', None, TA)
    al = call('GET', '/admin/faqs', None, TA)
    row = next((r for r in (al.get('rows') or []) if r.get('id') == fid), {})
    ok('② API — 「이걸로 해결됨」 그날 줄 +1 · 숨긴 질문 404 · 1:1 문의 지표 「문의 전 해결」 +1 · 자주 묻는 질문 표 30일 셈',
       d1.get('ok') is True and b1 == b0 + 1 and hd.get('_err') == 404 and s1.get('deflected') == (s0.get('deflected') or 0) + 1 and (row.get('deflect30') or 0) >= 1,
       f"{b0}→{b1} · {hd.get('_err')} · {s0.get('deflected')}→{s1.get('deflected')} · {row.get('deflect30')}")
    if SITE and fid:
        word = f0['question'][:60]
        def run(b, seen, perr):
            ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
            ps.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
            ps.evaluate("() => { try { Object.keys(localStorage).filter((k) => k.startsWith('sgb_faq_d:')).forEach((k) => localStorage.removeItem(k)); } catch (e) {} }")
            ps.fill('#cs-title', word); ps.wait_for_timeout(1200)
            seen['n'] = ps.locator('[data-similar-item]').count()
            it = ps.locator(f'[data-similar-item="{fid}"]')
            seen['mine'] = it.count()
            if it.count():
                b_ = int(day() or 0)
                it.locator('summary').click(); ps.wait_for_timeout(500)
                it.locator('[data-similar-yes]').click(); ps.wait_for_timeout(1500)
                seen['done'] = it.locator('[data-similar-done]').count(); seen['plus'] = int(day() or 0) - b_
            ps.screenshot(path=os.path.join(HERE, 'v1340_similar.png'), full_page=False)
        r = ui(run)
        if r is None:
            print('  (playwright 없음 — ③ 건너뜀)')
        else:
            seen, perr = r
            ok('③ 화면 — 문의하기 제목에 질문 낱말 → 비슷한 질문(3개까지) · 그 질문 · 「이걸로 해결됨」 → 감사 글 · 셈 +1 · 화면 오류 없음',
               1 <= seen.get('n', 0) <= 3 and seen.get('mine') == 1 and seen.get('done') == 1 and seen.get('plus') == 1 and not perr, f'{word} · {seen} · {perr[:2]}')
    else:
        print('  (SITE 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② ~ ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
