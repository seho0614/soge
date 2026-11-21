"""v10.341 (docs/474) 1:1 문의 답변 만족도 · 「아직」이면 다시 열림(D231)
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb SITE=http://localhost:15174 python3 test_v1341.py
  ① (코드) D231 · POST /me/inquiries/{id}/feedback · 내 문의 내역 · 운영 표시 · 지표 · 사전 · screens.json · 문서 474 · 판 v10.341 · 마이그레이션 269
  ② (API) 409 · 다시 열림 · 운영 표시 · 다시 답 → 비움 · 해결됨 · 지표 · 404
  ③ (화면) 내 문의 내역 해결됨
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

M31 = rd('prisma/migrations/D231_inquiry_feedback/migration.sql')
NS, MC, SV = rd('src/modules/me/me-notify.service.ts'), rd('src/modules/me/me.controller.ts'), rd('src/modules/support/inquiry-admin.service.ts')
HP, FBC, DESK, SJ = rd('site/src/app/support/history/page.tsx'), rd('site/src/components/support/InquiryFeedback.tsx'), rd('web/src/app/admin/InquiryDesk.tsx'), rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/deal.json'))['support']; EN = json.loads(rd('site/src/i18n/messages/en/deal.json'))['support']
except Exception:
    KO, EN = {}, {}
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D231(지우는 문장 없음) · 만족도 API(내 것 · 답 뒤 · 아직이면 다시 엶 · 감사) · 다시 답하면 비움 · 내 문의 내역 단추 · 운영 「다시 열림」 · 해결률 · 사전(한 · 영) · screens.json · 문서 474 · 판 v10.341 · 마이그레이션 269',
   'ADD COLUMN IF NOT EXISTS feedback' in M31 and 'reopen_count' in M31 and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M31)
   and 'async inquiryFeedback' in NS and "'INQUIRY_FEEDBACK'" in NS and "@Post('inquiries/:id/feedback')" in MC and 'feedback = NULL, feedback_at = NULL' in SV and 'resolvedRate' in SV
   and '<InquiryFeedback id={r.id}' in HP and 'data-inq-fb-yes' in FBC and 'data-inquiry-reopened' in DESK and 'data-inquiry-resolved' in DESK
   and KO.get('fbQ') and EN.get('fbQ') and '"POST /me/inquiries/{id}/feedback"' in SJ and 'D231' in doc('474_')
   and VT >= (10, 341) and len(mig) >= 269 and 'D231_inquiry_feedback' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW); consent_ok.agree('intro@x.com', PW)
    TA, TB, TC = login('admin@x.com'), login('buyer@x.com'), login('intro@x.com')
    stamp = int(time.time()) % 100000
    T = f'시험 1341 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; DELETE FROM inquiries WHERE title LIKE '시험 1341 %'")
    clean()
    try:
        iq = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 문의', 'body': '시험 1341 문의 본문'}, TB)
        iid = iq.get('id')
        e0 = call('POST', f'/me/inquiries/{iid}/feedback', {'resolved': False}, TB)
        call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '시험 1341 첫 답변입니다'}, TA)
        n1 = call('POST', f'/me/inquiries/{iid}/feedback', {'resolved': False}, TB)
        st1 = psql(f"SELECT status || '|' || coalesce(feedback, '-') || '|' || reopen_count || '|' || (due_at > now()) FROM inquiries WHERE id = '{iid}'")
        lst = call('GET', f'/admin/inquiries?q={urllib.parse.quote(T)}', None, TA)
        row = next((r for r in (lst.get('rows') or []) if r.get('id') == iid), {})
        call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '시험 1341 두 번째 답변입니다'}, TA)
        st2 = psql(f"SELECT status || '|' || coalesce(feedback, '-') FROM inquiries WHERE id = '{iid}'")
        s0 = call('GET', '/admin/inquiries/stats', None, TA)
        y1 = call('POST', f'/me/inquiries/{iid}/feedback', {'resolved': True}, TB)
        s1 = call('GET', '/admin/inquiries/stats', None, TA)
        other = call('POST', f'/me/inquiries/{iid}/feedback', {'resolved': True}, TC)
        my = call('GET', '/me/inquiries', None, TB)
        mine = next((r for r in (my if isinstance(my, list) else []) if r.get('id') == iid), {})
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'INQUIRY_FEEDBACK' AND target_id = '{iid}'")
        ok('② API — 답 전 409 · 「아직」 → 다시 열림(OPEN · 횟수 1 · 기한) · 운영 목록 UNRESOLVED · 다시 답 → 만족도 비움 · 「해결됨」 · 해결률 셈 +1 · 내 목록 feedback · 감사 2 · 남의 문의 404',
           e0.get('_err') == 409 and e0.get('code') == 'INQUIRY_NO_ANSWER' and n1.get('status') == 'OPEN' and st1 == 'OPEN|UNRESOLVED|1|true'
           and row.get('feedback') == 'UNRESOLVED' and row.get('reopenCount') == 1 and st2 == 'ANSWERED|-' and y1.get('feedback') == 'RESOLVED'
           and s1.get('resolved') == (s0.get('resolved') or 0) + 1 and s1.get('resolvedRate') is not None and mine.get('feedback') == 'RESOLVED'
           and aud == '2' and other.get('_err') == 404,
           f"{e0.get('code')} · {st1} · {row.get('feedback')} {row.get('reopenCount')} · {st2} · {s0.get('resolved')}→{s1.get('resolved')} · {mine.get('feedback')} · {aud} · {other.get('_err')}")
        if SITE:
            iq2 = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 화면', 'body': '시험 1341 화면 본문'}, TB)
            call('POST', f"/admin/inquiries/{iq2.get('id')}/answer", {'answer': '시험 1341 화면 답변입니다'}, TA)
            def run(b, seen, perr):
                ps = site_login(b, perr, 'buyer@x.com')
                ps.goto(SITE + '/support/history', wait_until='networkidle', timeout=120000); ps.wait_for_timeout(1500)
                tr = ps.locator('tr', has_text=f'{T} 화면')
                seen['row'] = tr.count()
                if tr.count():
                    tr.locator('details:not([data-inq-photos]) summary').first.click()   # v10.611 사진 펼침(details)이 앞에 있음; ps.wait_for_timeout(500)
                    tr.locator('[data-inq-fb-yes]').click(); ps.wait_for_timeout(2500)
                    seen['done'] = ps.locator('tr', has_text=f'{T} 화면').locator('[data-inq-fb="RESOLVED"]').count()
                seen['db'] = psql(f"SELECT coalesce(feedback, '-') FROM inquiries WHERE id = '{iq2.get('id')}'")
                ps.screenshot(path=os.path.join(HERE, 'v1341_history.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ③ 건너뜀)')
            else:
                seen, perr = r
                ok('③ 화면 — 내 문의 내역 답변 펼침 → 「해결됨」 → 감사 글 · DB RESOLVED · 화면 오류 없음',
                   seen.get('row') == 1 and seen.get('db') == 'RESOLVED' and not perr, f'{seen} · {perr[:2]}')
        else:
            print('  (SITE 없음 — ③ 건너뜀)')
    finally:
        clean()
    ok('④ 지움 — 시험 문의 없음', psql("SELECT count(*) FROM inquiries WHERE title LIKE '시험 1341 %'") == '0', '')
else:
    print('  (API · DB 없음 — ② ~ ④ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
