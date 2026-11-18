"""v10.346 (docs/480) 못 찾은 낱말 → 「기존 질문에 더하기」
  ① (코드) POST /admin/faqs/misses/attach · 화면 · screens.json · 문서 480 · 판 v10.346
  ② (API) 더하기 · 다시 · 404 · 422 둘 · 회원 403
  ③ (화면) 고르기 → 더하기 → 목록에서 빠짐
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

FS, FC, FA, SJ = rd('src/modules/help/faq-admin.service.ts'), rd('src/modules/help/faq-admin.controller.ts'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('spec/screens.json')
ok('① 코드 — 기존 질문에 더하기 API(ADMIN · SUPER · 감사) · 낱말 10개 · 20자 · 화면 고르기 · 단추 · screens.json · 문서 480 · 판 v10.346',
   'async missAttach' in FS and "'FAQ_KEYWORDS_FULL'" in FS and "@Post('misses/attach')" in FC and "@Audit('FAQ_MISS_ATTACH', 'FAQ')" in FC
   and 'data-faq-miss-pick' in FA and 'data-faq-miss-attach' in FA and '"POST /admin/faqs/misses/attach"' in SJ and 'attach' in doc('480_') and VT >= (10, 346), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = ''.join(chr(97 + int(c)) for c in str(int(time.time()) % 100000).zfill(5))
    W, W2, W3, WL = f'시험더함 {stamp}', f'시험화면더함 {stamp}', f'시험가득 {stamp}', f'시험긴낱말 {stamp} ' + 'ㄱ' * 12
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM faqs WHERE question LIKE '시험 1346 %'; "
                         "DELETE FROM faq_search_misses WHERE word LIKE '시험더함 %' OR word LIKE '시험화면더함 %' OR word LIKE '시험가득 %' OR word LIKE '시험긴낱말 %'; "
                         "DELETE FROM faq_search_miss_done WHERE word LIKE '시험더함 %' OR word LIKE '시험화면더함 %' OR word LIKE '시험가득 %' OR word LIKE '시험긴낱말 %'")
    clean()
    try:
        for w in (W, W2, W3, WL):
            psql(f"INSERT INTO faq_search_misses (word, day, hits) VALUES ('{w}', (now() AT TIME ZONE 'Asia/Seoul')::date, 5)")
        f1 = call('POST', '/admin/faqs', {'category': '시험', 'question': f'시험 1346 질문 {stamp}', 'answer': '시험 1346 답입니다', 'topic': 'ETC', 'isActive': False}, TA).get('id')
        f2 = call('POST', '/admin/faqs', {'category': '시험', 'question': f'시험 1346 가득 {stamp}', 'answer': '시험 1346 답입니다', 'topic': 'ETC', 'isActive': False,
                                          'keywords': [f'낱말{i}' for i in range(10)]}, TA).get('id')
        a1 = call('POST', '/admin/faqs/misses/attach', {'word': W, 'faqId': f1}, TA)
        kw = psql(f"SELECT '{W}' = ANY(keywords) FROM faqs WHERE id = '{f1}'")
        al = call('GET', '/admin/faqs', None, TA)
        gone = not any(m.get('word') == W for m in (al.get('misses') or []))
        a2 = call('POST', '/admin/faqs/misses/attach', {'word': W, 'faqId': f1}, TA)
        n1 = psql(f"SELECT count(*) FROM faqs f, unnest(f.keywords) k WHERE f.id = '{f1}' AND k = '{W}'")
        nf = call('POST', '/admin/faqs/misses/attach', {'word': W, 'faqId': '00000000-0000-4000-8000-000000000000'}, TA)
        lg = call('POST', '/admin/faqs/misses/attach', {'word': WL, 'faqId': f1}, TA)
        fu = call('POST', '/admin/faqs/misses/attach', {'word': W3, 'faqId': f2}, TA)
        fb = call('POST', '/admin/faqs/misses/attach', {'word': W, 'faqId': f1}, TB)
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'FAQ_MISS_ATTACH' AND occurred_at > now() - interval '10 minutes'")
        ok('② API — 더하기 → 질문 낱말에 있음 · 목록에서 빠짐 · 감사 · 다시 → added false(한 번만) · 없는 질문 404 · 20자 넘음 422 · 낱말 10개 422 · 회원 403',
           f1 and f2 and a1.get('added') is True and kw == 't' and gone and int(aud or 0) >= 1 and a2.get('added') is False and n1 == '1'
           and nf.get('_err') == 404 and lg.get('_err') == 422 and lg.get('code') == 'FAQ_MISS_WORD' and fu.get('_err') == 422 and fu.get('code') == 'FAQ_KEYWORDS_FULL' and fb.get('_err') == 403,
           f"{a1.get('added')} {kw} {gone} {a2.get('added')} {n1} · {nf.get('_err')} {lg.get('code')} {fu.get('code')} {fb.get('_err')} · 감사 {aud}")
        if ADMIN_WEB:
            f3 = call('POST', '/admin/faqs', {'category': '시험', 'question': f'시험 1346 화면 {stamp}', 'answer': '시험 1346 답입니다', 'topic': 'ETC', 'isActive': True}, TA).get('id')
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/faq', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                sel = pg.locator(f'[data-faq-miss-pick="{W2}"]')
                seen['sel'] = sel.count()
                if sel.count():
                    sel.select_option(f3); pg.wait_for_timeout(300)
                    pg.locator(f'[data-faq-miss="{W2}"] [data-faq-miss-attach]').click(); pg.wait_for_timeout(2500)
                    seen['row'] = pg.locator(f'[data-faq-miss="{W2}"]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1346_attach.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                k3 = psql(f"SELECT '{W2}' = ANY(keywords) FROM faqs WHERE id = '{f3}'")
                ok('③ 화면 — 못 찾은 낱말 줄 · 있는 질문 고르기 → 「기존 질문에 더하기」 → 목록에서 빠짐 · 질문 낱말에 있음 · 화면 오류 없음',
                   seen.get('sel') == 1 and seen.get('row') == 0 and k3 == 't' and not perr, f'{seen} · {k3} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
else:
    print('  (API · DB 없음 — ② ③ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
