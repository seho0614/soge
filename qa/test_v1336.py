"""v10.336 (docs/469) 고객센터 찾기 「못 찾은 낱말」 → 자주 묻는 질문 후보(D228)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1336.py
  ① (코드) D228 · POST /faq/miss · POST /admin/faqs/misses/done · CsHub · FaqAdmin · screens.json · 문서 469 · 판 v10.336 · 마이그레이션 266
  ② (DB) 표 둘
  ③ (API) 낱말 셈 · 사람 정보 모양은 안 셈 · 운영 목록 · 다룸 · 404 · 회원 403
  ④ (화면) 고객센터에서 없는 낱말 → 셈 · 운영 화면 「못 찾은 낱말 30일」
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

M28 = rd('prisma/migrations/D228_faq_search_misses/migration.sql')
FB, FC, FS = rd('src/modules/help/faq-feedback.controller.ts'), rd('src/modules/help/faq-admin.controller.ts'), rd('src/modules/help/faq-admin.service.ts')
HUB, FA, SJ = rd('site/src/components/support/CsHub.tsx'), rd('web/src/app/admin/FaqAdmin.tsx'), rd('spec/screens.json')
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D228(지우는 문장 없음) · 공개 POST /faq/miss(사람 정보 거름) · 다룸 API · 운영 목록 misses · 고객센터 0건 낱말 보냄 · 운영 화면 「못 찾은 낱말 30일」 · screens.json · 문서 469 · 판 v10.336 · 마이그레이션 266',
   'CREATE TABLE IF NOT EXISTS public.faq_search_misses' in M28 and 'CREATE TABLE IF NOT EXISTS public.faq_search_miss_done' in M28 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M28)
   and "@Post('miss')" in FB and 'export function missWord' in FB and "@Post('misses/done')" in FC and "@Audit('FAQ_MISS_DONE', 'FAQ')" in FC
   and 'misses' in FS and 'async missDone' in FS and "'/api/v1/faq/miss'" in HUB and 'data-faq-misses' in FA and 'data-faq-miss-new' in FA
   and '"POST /faq/miss"' in SJ and '"POST /admin/faqs/misses/done"' in SJ and 'D228' in doc('469_')
   and VT >= (10, 336) and len(mig) >= 266 and 'D228_faq_search_misses' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = ''.join(chr(97 + int(c)) for c in str(int(time.time()) % 100000).zfill(5))
    W, W2 = f'시험낱말 {stamp}', f'시험화면 {stamp}'
    clean = lambda: psql(f"DELETE FROM faq_search_misses WHERE word LIKE '시험낱말 %' OR word LIKE '시험화면 %'; DELETE FROM faq_search_miss_done WHERE word LIKE '시험낱말 %' OR word LIKE '시험화면 %'")
    clean()
    try:
        ok('② DB — 표 둘', psql("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('faq_search_misses', 'faq_search_miss_done')") == '2', '')
        hits = lambda w: psql(f"SELECT coalesce(sum(hits), 0) FROM faq_search_misses WHERE word = '{w}'")
        m1 = call('POST', '/faq/miss', {'q': '  ' + W.upper() + '  '})
        m2 = call('POST', '/faq/miss', {'q': W})
        p1 = call('POST', '/faq/miss', {'q': '010-1234-5678 전화'})
        p2 = call('POST', '/faq/miss', {'q': 'me@x.com'})
        h = hits(W)
        al = call('GET', '/admin/faqs', None, TA)
        mrow = next((m for m in (al.get('misses') or []) if m.get('word') == W), {})
        dn = call('POST', '/admin/faqs/misses/done', {'word': W}, TA)
        al2 = call('GET', '/admin/faqs', None, TA)
        gone = not any(m.get('word') == W for m in (al2.get('misses') or []))
        nf = call('POST', '/admin/faqs/misses/done', {'word': f'없는낱말 {stamp}'}, TA)
        fb = call('POST', '/admin/faqs/misses/done', {'word': W}, TB)
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'FAQ_MISS_DONE' AND occurred_at > now() - interval '10 minutes'")
        ok('③ API — 낱말 셈(대소문자 · 빈칸 다듬음 · 2회) · 전화 · 메일 모양은 안 셈 · 운영 목록 30일 · 다룸 → 목록에서 빠짐 · 감사 · 없는 낱말 404 · 회원 403',
           m1.get('kept') is True and m2.get('kept') is True and p1.get('kept') is False and p2.get('kept') is False and h == '2'
           and mrow.get('hits30') == 2 and dn.get('ok') is True and gone and int(aud or 0) >= 1 and nf.get('_err') == 404 and fb.get('_err') == 403,
           f"{m1.get('kept')} {p1.get('kept')} {p2.get('kept')} · {h} · {mrow} · {dn.get('ok')} 빠짐 {gone} · {nf.get('_err')} · {fb.get('_err')}")
        if SITE or ADMIN_WEB:
            def run(b, seen, perr):
                if SITE:
                    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    ps.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    ps.fill('#cs-q', W2); ps.wait_for_timeout(3500)
                    seen['found0'] = ps.locator('[data-cs-found="0"]').count()
                    seen['hits'] = hits(W2)
                if ADMIN_WEB:
                    pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/faq', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['box'] = pg.locator('[data-faq-misses]').count()
                    row = pg.locator(f'[data-faq-miss="{W2}"]')
                    seen['row'] = row.count()
                    if row.count():
                        row.locator('[data-faq-miss-new]').click(); pg.wait_for_timeout(800)
                        seen['form'] = pg.locator('input[name=faq-question]').input_value() == W2
                    pg.screenshot(path=os.path.join(HERE, 'v1336_admin.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 고객센터에서 없는 낱말 → 1.2초 뒤 셈 1 · 운영 화면 「못 찾은 낱말 30일」에 그 낱말 · 「이 낱말로 새 질문」 → 질문 칸에 채움 · 화면 오류 없음',
                   (not SITE or (seen.get('found0') == 1 and seen.get('hits') == '1')) and (not ADMIN_WEB or (seen.get('box') == 1 and (not SITE or (seen.get('row') == 1 and seen.get('form') is True))))
                   and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE · ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
    ok('⑤ 지움 — 시험 낱말 없음', psql("SELECT count(*) FROM faq_search_misses WHERE word LIKE '시험낱말 %' OR word LIKE '시험화면 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
