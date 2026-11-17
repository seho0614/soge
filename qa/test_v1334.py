"""v10.334 (docs/465) 고객센터 질문 「도움이 되었나요?」 · 질문 초안(숨김) · 1:1 문의 답변 틀(D226)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 ADMIN_WEB=http://localhost:15173 python3 test_v1334.py
  ① (코드) D226 · /faq/{id}/view · helpful · /admin/inquiry-templates · CsHub · FaqAdmin · InquiryDesk · 사전 · screens.json · 문서 465 · 판 v10.334 · 마이그레이션 264
  ② (DB) faq_daily · inquiry_templates · 숨김 초안 14
  ③ (API) 하루 셈 · 404 · 30일 셈 · 후보 · 틀 409 · 숨기기 · 403
  ④ (화면) 도움 됨 단추 · 답변 틀 고르기 · 셈 칸
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
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/deal.json'))['support']['hub']
    EN = json.loads(rd('site/src/i18n/messages/en/deal.json'))['support']['hub']
except Exception:
    KO, EN = {}, {}
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
DRAFT = '소개몰 배송비는 얼마인가요?'
ok('① 코드 — D226(지우는 문장 없음 · 초안 숨김) · 공개 API 2 · 틀 API 3 · 「도움이 되었나요?」 · 운영 통계 · 후보 · 틀 고르기 · 관리 · 사전 · screens.json · 문서 465 · 판 v10.334 · 마이그레이션 264',
   'CREATE TABLE IF NOT EXISTS public.faq_daily' in M26 and 'CREATE TABLE IF NOT EXISTS public.inquiry_templates' in M26 and DRAFT in M26
   and "v.k, v.o, false FROM" in M26 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M26)
   and "@Post(':id/view')" in FB and "@Post(':id/helpful')" in FB and '@Roles' not in FB and "@Controller('api/v1/admin/inquiry-templates')" in TC
   and "@Audit('INQUIRY_TEMPLATE_CREATE', 'INQUIRY_TEMPLATE')" in TC and 'candidates' in FS and 'FaqFeedbackController' in AM and 'InquiryTemplateController' in AM
   and 'data-cs-help-yes' in HUB and "once(`sgb_faq_v:${f.id}`)" in HUB and 'data-faq-candidates' in FA and 'data-faq-stat' in FA
   and 'data-inquiry-template' in DESK and 'function TemplateManager' in DESK and KO.get('helpQ') and EN.get('helpQ')
   and '"POST /faq/{id}/helpful"' in SJ and '"PATCH /admin/inquiry-templates/{id}"' in SJ and 'D226' in doc('465_')
   and VT >= (10, 334) and len(mig) >= 264 and 'D226_faq_feedback_inquiry_templates' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    stamp = int(time.time()) % 100000
    T = f'시험 1334 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM inquiry_templates WHERE title LIKE '시험 1334 %'; "
                         "DELETE FROM inquiries WHERE title LIKE '시험 1334 %'")
    clean()
    try:
        cs = [f for f in call('GET', '/faq?channel=CS') if isinstance(f, dict)]
        draft_id = psql(f"SELECT id FROM faqs WHERE question = '{DRAFT}'")
        n_draft = psql("SELECT count(*) FROM faqs WHERE NOT is_active AND sort_order BETWEEN 300 AND 339")
        ok('② DB — 표 둘 · 처음 답변 틀 5개 이상 · 숨김 초안 14개 · 사용자 웹 GET /faq 에 초안 안 나옴',
           psql("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('faq_daily', 'inquiry_templates')") == '2'
           and int(psql("SELECT count(*) FROM inquiry_templates") or 0) >= 5 and bool(draft_id) and n_draft == '14'
           and not any(f.get('question') == DRAFT for f in cs) and len(cs) > 0, f'초안 {n_draft} · 고객센터 질문 {len(cs)}')
        fid = cs[0].get('id') if cs else None
        day = lambda: psql(f"SELECT coalesce(sum(views), 0) || '|' || coalesce(sum(yes), 0) || '|' || coalesce(sum(no), 0) FROM faq_daily WHERE faq_id = '{fid}' AND day = (now() AT TIME ZONE 'Asia/Seoul')::date")
        b0 = [int(x) for x in day().split('|')]
        v1 = call('POST', f'/faq/{fid}/view', {})
        h1 = call('POST', f'/faq/{fid}/helpful', {'yes': True})
        h2 = call('POST', f'/faq/{fid}/helpful', {'yes': False})
        b1 = [int(x) for x in day().split('|')]
        hd = call('POST', f'/faq/{draft_id}/view', {})
        al = call('GET', '/admin/faqs', None, TA)
        row = next((r for r in (al.get('rows') or []) if r.get('id') == fid), {})
        t1 = call('POST', '/admin/inquiry-templates', {'title': f'{T} 틀', 'body': '시험 1334 답변 틀 글입니다'}, TA)
        t2 = call('POST', '/admin/inquiry-templates', {'title': f'{T} 틀', 'body': '같은 이름'}, TA)
        t3 = call('PATCH', f"/admin/inquiry-templates/{t1.get('id')}", {'isActive': False}, TA)
        tl = call('GET', '/admin/inquiry-templates', None, TA)
        trow = next((r for r in (tl.get('rows') or []) if r.get('id') == t1.get('id')), {})
        fb = call('GET', '/admin/inquiry-templates', None, TB)
        ok('③ API — 펼침 · 예 · 아니오가 그날 줄에 +1 · 숨긴 질문 404 · 운영 목록 30일 셈 · 후보 목록 · 틀 만들기 · 같은 이름 409 · 숨기기 · 회원 403',
           v1.get('ok') is True and h1.get('ok') is True and h2.get('ok') is True and b1 == [b0[0] + 1, b0[1] + 1, b0[2] + 1] and hd.get('_err') == 404
           and (row.get('views30') or 0) >= 1 and isinstance(al.get('candidates'), list) and t1.get('ok') is True and t2.get('_err') == 409
           and t3.get('ok') is True and trow.get('isActive') is False and fb.get('_err') == 403,
           f'{b0} → {b1} · 숨김 {hd.get("_err")} · 30일 {row.get("views30")} · 틀 {t2.get("_err")} · {trow.get("isActive")} · {fb.get("_err")}')
        iq = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 문의', 'body': '시험 1334 문의 본문'}, TB)
        iid = iq.get('id')
        tpl = psql("SELECT id || '|' || body FROM inquiry_templates WHERE is_active ORDER BY sort_order, title LIMIT 1")
        tpl_id, tpl_body = (tpl.split('|', 1) + [''])[:2]
        if SITE or ADMIN_WEB:
            def run(b, seen, perr):
                if SITE:
                    ps = b.new_page(viewport={'width': 1280, 'height': 900}); ps.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    ps.goto(SITE + '/support/new', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                    it = ps.locator('[data-cs-list] details').first
                    if it.count():
                        it.locator('summary').click(); ps.wait_for_timeout(800)
                        it.locator('[data-cs-help-yes]').click(); ps.wait_for_timeout(800)
                        seen['thanks'] = it.locator('[data-cs-help-done]').count()
                    ps.screenshot(path=os.path.join(HERE, 'v1334_help.png'), full_page=False)
                if ADMIN_WEB:
                    pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                    pg.on('dialog', lambda d: d.accept())
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    pg.goto(ADMIN_WEB + '/#/inquiries', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    pg.fill('input[name=inq-q]', T); pg.click('[data-inquiry-q-go]'); pg.wait_for_timeout(2500)
                    bt = pg.locator(f'[data-inquiry-open="{iid}"]')
                    if bt.count():
                        bt.first.click(); pg.wait_for_timeout(2500)
                        sel = pg.locator('[data-inquiry-template]')
                        seen['sel'] = sel.count()
                        if sel.count():
                            sel.first.select_option(tpl_id); pg.wait_for_timeout(800)
                            seen['filled'] = pg.locator('[data-inquiry-answer]').first.input_value() == tpl_body
                    pg.click('[data-inquiry-tpl-manage]'); pg.wait_for_timeout(1500)
                    seen['mgr'] = pg.locator('[data-inquiry-templates]').count()
                    pg.goto(ADMIN_WEB + '/#/faq', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                    seen['stat'] = pg.locator('[data-faq-stat]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1334_admin.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                ok('④ 화면 — 고객센터 질문 「예」 → 「의견 감사합니다」 · 운영 화면 답변 틀 고르기 → 칸에 채움 · 틀 관리 · 자주 묻는 질문 셈 칸 · 화면 오류 없음',
                   (not SITE or seen.get('thanks') == 1) and (not ADMIN_WEB or (seen.get('sel') == 1 and seen.get('filled') is True and seen.get('mgr') == 1 and seen.get('stat', 0) >= 1))
                   and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE · ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
    ok('⑤ 지움 — 시험 틀 · 문의 없음', psql("SELECT count(*) FROM inquiry_templates WHERE title LIKE '시험 1334 %'") == '0'
       and psql("SELECT count(*) FROM inquiries WHERE title LIKE '시험 1334 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
