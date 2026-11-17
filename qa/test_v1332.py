"""v10.332 (docs/463) 고객센터 홈 · 머리줄 「고객센터」 · 운영 화면 「자주 묻는 질문」 관리(D224)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1332.py
  ① (코드) D224 · /admin/faqs 3개 · 감사 · 머리줄 링크 · CsHub · 사전 · 운영 탭 · screens.json · 문서 463 · 판 v10.332 · 마이그레이션 262
  ② (DB) topic · is_top · 검사 제약 · 처음 채운 분야
  ③ (API) 등록 · 409 · 422 · GET /faq 분야 · TOP · 숨김 · 회원 403 · 감사
  ④ (화면) 사용자 웹 고객센터 홈 · 운영 화면 자주 묻는 질문
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

M24 = rd('prisma/migrations/D224_faq_manage/migration.sql')
FC, FS = rd('src/modules/help/faq-admin.controller.ts'), rd('src/modules/help/faq-admin.service.ts')
AM, UH = rd('src/app.module.ts'), rd('site/src/components/common/UniHeader.tsx')
HUB, PG = rd('site/src/components/support/CsHub.tsx'), rd('site/src/app/support/new/page.tsx')
MENU, APP, FA = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/FaqAdmin.tsx')
SJ = rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/deal.json'))['support']['hub']
    EN = json.loads(rd('site/src/i18n/messages/en/deal.json'))['support']['hub']
except Exception:
    KO, EN = {}, {}
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D224(지우는 문장 없음) · 운영 API 3개 · 감사 · 머리줄 「고객센터」 · 고객센터 홈 · 사전(한 · 영) · 운영 탭 · screens.json · 문서 463 · 판 v10.332 · 마이그레이션 262',
   'ADD COLUMN IF NOT EXISTS topic' in M24 and 'ADD COLUMN IF NOT EXISTS is_top' in M24 and 'faqs_topic_check' in M24
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M24) and "@Controller('api/v1/admin/faqs')" in FC and "@Audit('FAQ_CREATE', 'FAQ')" in FC
   and "@Audit('FAQ_UPDATE', 'FAQ')" in FC and "@Patch(':id')" in FC and 'FAQ_TOP_FULL' in FS and 'FAQ_DUPLICATE' in FS
   and 'FaqAdminController' in AM and 'FaqAdminService' in AM and "{ href: '/support/new', label: h('support') }" in UH
   and 'data-cs-hub' in HUB and 'data-cs-quick' in PG and '<CsHub faqs={hub} />' in PG
   and KO.get('findH') and EN.get('findH') and set(KO.get('topic', {})) == set(EN.get('topic', {})) and len(KO.get('quick', {})) == 8
   and "['faq', '자주 묻는 질문']" in MENU and "tab === 'faq' && <FaqAdmin />" in APP and 'data-faq-admin' in FA
   and '"SB-ADM-SIT-100"' in SJ and '"PATCH /admin/faqs/{id}"' in SJ and 'D224' in doc('463_') and VT >= (10, 332)
   and len(mig) >= 262 and 'D224_faq_manage' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    t0 = psql("SELECT now()")
    stamp = int(time.time()) % 100000
    Q = f'시험 1332 {stamp} 질문'
    clean = lambda: psql("DELETE FROM faqs WHERE question LIKE '시험 1332 %'")
    clean()
    try:
        bad = psql("INSERT INTO faqs (category, question, answer, topic) VALUES ('시험', '시험 1332 잘못된 분야', '답', 'XX')")
        wrong = psql("SELECT count(*) FROM faqs WHERE category = '정산' AND topic <> 'MONEY'")
        n_set = psql("SELECT count(*) FROM faqs WHERE category = '정산'")
        ok('② DB — topic · is_top 칸 · 잘못된 분야는 막힘 · 처음 채운 분야(정산 → MONEY)',
           psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'faqs' AND column_name IN ('topic', 'is_top')") == '2'
           and '!' in bad and 'faqs_topic_check' in bad and wrong == '0' and n_set not in ('', '0'), f'{bad[-60:]} · 정산 {n_set} · 다른 분야 {wrong}')
        c1 = call('POST', '/admin/faqs', {'category': '시험', 'question': Q, 'answer': '시험 답 1332', 'topic': 'MONEY', 'channels': ['FAQ', 'CS'], 'keywords': ['시험1332']}, TA)
        fid = c1.get('id')
        c2 = call('POST', '/admin/faqs', {'category': '시험', 'question': Q, 'answer': '다른 답', 'topic': 'MONEY'}, TA)
        c3 = call('POST', '/admin/faqs', {'category': '시험', 'question': Q + ' 링크', 'answer': '링크 시험 답 1332', 'linkHref': 'https://example.com', 'linkLabel': '밖'}, TA)
        pick = lambda: next((f for f in call('GET', '/faq?channel=CS') if isinstance(f, dict) and f.get('id') == fid), None) if fid else None
        g1 = pick() or {}
        p1 = call('PATCH', f'/admin/faqs/{fid}', {'isTop': True}, TA)
        g2 = pick() or {}
        p2 = call('PATCH', f'/admin/faqs/{fid}', {'isActive': False}, TA)
        g3 = pick()
        al = call('GET', '/admin/faqs', None, TA)
        row = next((r for r in (al.get('rows') or []) if r.get('id') == fid), {})
        fb = call('GET', '/admin/faqs', None, TB)
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action IN ('FAQ_CREATE', 'FAQ_UPDATE') AND occurred_at >= '{t0}'")
        ok('③ API — 등록 200 · 같은 질문 409 · 사이트 밖 주소 422 · GET /faq 에 분야 · TOP · 숨기면 빠짐 · 운영 목록엔 숨김으로 · 회원 403 · 감사 3줄 이상',
           c1.get('ok') is True and bool(fid) and c2.get('_err') == 409 and c2.get('code') == 'FAQ_DUPLICATE' and c3.get('_err') == 422 and c3.get('code') == 'FAQ_LINK'
           and g1.get('topic') == 'MONEY' and g1.get('isTop') is False and p1.get('ok') is True and g2.get('isTop') is True
           and p2.get('ok') is True and g3 is None and row.get('isActive') is False and al.get('topMax') == 10 and fb.get('_err') == 403
           and aud.isdigit() and int(aud) >= 3,
           f"{c1.get('note')} · {c2.get('_err')} {c2.get('code')} · {c3.get('_err')} {c3.get('code')} · {g1.get('topic')} {g1.get('isTop')} → {g2.get('isTop')} · 숨김 뒤 {g3 is None} · 403 {fb.get('_err')} · 감사 {aud}")
        if SITE or ADMIN_WEB:
            def run(b, seen, perr):
                if SITE:
                    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    ps.goto(SITE + '/', wait_until='networkidle', timeout=120000)
                    lk = ps.locator('[data-uni-header] nav a[href="/support/new"]')
                    seen['link'] = lk.count()
                    if lk.count():
                        lk.first.click(); ps.wait_for_url('**/support/new', timeout=60000); ps.wait_for_load_state('networkidle')
                    seen['url'] = ps.url.split('?')[0].endswith('/support/new')
                    seen['on'] = ps.locator('[data-uni-header] nav a.on[href="/support/new"]').count()
                    seen['quick'] = ps.locator('[data-cs-go]').count()
                    seen['top'] = ps.locator('[data-cs-tab="TOP"]').count()
                    seen['tabs'] = ps.locator('[data-cs-tab]').count()
                    ps.fill('[data-cs-q]', '정산'); ps.wait_for_timeout(800)
                    fd = ps.locator('[data-cs-found]')
                    seen['found'] = int(fd.first.get_attribute('data-cs-found') or 0) if fd.count() else -1
                    ps.fill('[data-cs-q]', '없는말쀍1332'); ps.wait_for_timeout(800)
                    seen['none'] = ps.locator('[data-cs-none]').count()
                    seen['ntc'] = ps.locator('[data-cs-notices]').count() + ps.locator('.w1-cs-ntc, .w1-empty').count()
                    ps.screenshot(path=os.path.join(HERE, 'v1332_support.png'), full_page=False)
                if ADMIN_WEB:
                    pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/faq', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['adm'] = pg.locator('[data-faq-admin]').count()
                    tb = pg.locator('[data-faq-rows]')
                    seen['admRows'] = int(tb.first.get_attribute('data-faq-rows') or 0) if tb.count() else -1
                    seen['admNew'] = pg.locator('[data-faq-new]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1332_admin.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                site_ok = not SITE or (seen.get('link') == 1 and seen.get('url') and seen.get('on') == 1 and seen.get('quick') == 8 and seen.get('top') == 1
                                       and seen.get('tabs', 0) >= 2 and seen.get('found', 0) >= 1 and seen.get('none') == 1)
                adm_ok = not ADMIN_WEB or (seen.get('adm') == 1 and seen.get('admRows', 0) >= 1 and seen.get('admNew') == 1)
                ok('④ 화면 — 머리줄 「고객센터」 → 고객센터 홈(켜짐 · 바로가기 8 · 분야 탭 · 찾기 있음 / 없음) · 운영 화면 「자주 묻는 질문」 표 · 화면 오류 없음',
                   site_ok and adm_ok and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE · ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
    ok('⑤ 지움 — 시험 질문 없음', psql("SELECT count(*) FROM faqs WHERE question LIKE '시험 1332 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
