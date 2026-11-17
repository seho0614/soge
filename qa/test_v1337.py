"""v10.337 (docs/470) 1:1 문의 처리 지표 · 답변 틀 기록 · 하루 요약 줄(마이그레이션 없음)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1337.py
  ① (코드) GET /admin/inquiries/stats · templateId · 하루 요약 · InquiryStats · screens.json · 문서 470 · 판 v10.337
  ② (API) 접수 → 틀 골라 답 → 지표 · days 범위 · 회원 403
  ③ (화면) 지표 상자
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

SV, IC = rd('src/modules/support/inquiry-admin.service.ts'), rd('src/modules/support/inquiry-admin.controller.ts')
LW, DESK, SJ = rd('src/modules/admin/launch-watch.service.ts'), rd('web/src/app/admin/InquiryDesk.tsx'), rd('spec/screens.json')
ok('① 코드 — 지표 API(감사 기록 첫 답) · 답변 templateId · 하루 요약 「1:1 문의」 줄 · 운영 화면 지표 상자 · screens.json · 문서 470 · 판 v10.337',
   'async stats(' in SV and "l.action = 'INQUIRY_ANSWER'" in SV and 'templateId: tpl' in SV and "@Get('stats')" in IC and 'templateId?: string' in IC
   and IC.index("@Get('stats')") < IC.index("@Get(':id')") and 'inquiryDigestLine' in LW and '1:1 문의 답변 전' in LW
   and 'function InquiryStats' in DESK and 'data-inquiry-stats' in DESK and 'templateId: tplId' in DESK
   and '"GET /admin/inquiries/stats"' in SJ and 'stats' in doc('470_') and VT >= (10, 337), VER)
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    T = f'시험 1337 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM inquiries WHERE title LIKE '시험 1337 %'")
    clean()
    try:
        s0 = call('GET', '/admin/inquiries/stats', None, TA)
        tpl = psql("SELECT id FROM inquiry_templates WHERE is_active ORDER BY sort_order, title LIMIT 1")
        u0 = next((t.get('used') for t in (s0.get('templates') or []) if t.get('id') == tpl), None)
        iq = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 문의', 'body': '시험 1337 문의 본문'}, TB)
        an = call('POST', f"/admin/inquiries/{iq.get('id')}/answer", {'answer': '시험 1337 답변입니다', 'templateId': tpl}, TA)
        s1 = call('GET', '/admin/inquiries/stats', None, TA)
        u1 = next((t.get('used') for t in (s1.get('templates') or []) if t.get('id') == tpl), None)
        d1, d2 = call('GET', '/admin/inquiries/stats?days=1', None, TA), call('GET', '/admin/inquiries/stats?days=500', None, TA)
        fb = call('GET', '/admin/inquiries/stats', None, TB)
        aud = psql(f"SELECT after_data->>'templateId' FROM audit.audit_logs WHERE action = 'INQUIRY_ANSWER' AND target_id = '{iq.get('id')}' ORDER BY occurred_at DESC LIMIT 1")
        ok('② API — 접수 · 답함 +1 · 처음 답까지 시간 있음 · 고른 틀이 감사 기록에 · 틀 쓴 횟수 +1 · days 1 → 7 · 500 → 90 · 회원 403',
           an.get('ok') is True and s1.get('received') == (s0.get('received') or 0) + 1 and s1.get('answered') == (s0.get('answered') or 0) + 1
           and s1.get('avgHours') is not None and aud == tpl and u0 is not None and u1 == u0 + 1
           and d1.get('days') == 7 and d2.get('days') == 90 and fb.get('_err') == 403,
           f"{s0.get('received')}→{s1.get('received')} · {s0.get('answered')}→{s1.get('answered')} · 틀 {u0}→{u1} · {d1.get('days')} {d2.get('days')} · {fb.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/inquiries', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-inquiry-stats]')
                seen['box'] = box.count()
                if box.count():
                    box.locator('summary').click(); pg.wait_for_timeout(800)
                    seen['cat'] = pg.locator('[data-inquiry-stats-cat]').count(); seen['tpl'] = pg.locator('[data-inquiry-stats-tpl]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1337_stats.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 「1:1 문의」 맨 위 지표 상자 · 펼치면 분류별 · 답변 틀별 표 · 화면 오류 없음',
                   seen.get('box') == 1 and seen.get('cat') == 1 and seen.get('tpl') == 1 and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 문의 없음', psql("SELECT count(*) FROM inquiries WHERE title LIKE '시험 1337 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
