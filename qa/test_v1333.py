"""v10.333 (docs/464) 운영 화면 「1:1 문의」 답변함(D225) · 회원 상세에서 권한 주기
  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1333.py
  ① (코드) D225 · /admin/inquiries 4개 · 정기 작업 · 운영 탭 · MemberRoles · 운영 알림 이름 · 내 문의 내역 · 사전 · screens.json · 문서 464 · 판 v10.333 · 마이그레이션 263
  ② (DB) 칸 넷 · 기한 트리거 · INQUIRY_DUE_BREACH
  ③ (API) 목록 · 한 건 · 답변 · 알림 · 내 문의 내역 · 감사 · 409 · 다시 열기 · 422 · 403
  ④ (화면) 1:1 문의 답변 · 회원 상세 권한 칸
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

M25 = rd('prisma/migrations/D225_inquiry_answer_desk/migration.sql')
IC, IS = rd('src/modules/support/inquiry-admin.controller.ts'), rd('src/modules/support/inquiry-admin.service.ts')
AM, SCH = rd('src/app.module.ts'), rd('src/worker/scheduler.service.ts')
MENU, APP, DESK = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/InquiryDesk.tsx')
MR, MB, OA = rd('web/src/app/admin/MemberRoles.tsx'), rd('web/src/app/admin/Members.tsx'), rd('web/src/app/admin/OpsAlerts.tsx')
HI, SJ = rd('site/src/app/support/history/page.tsx'), rd('spec/screens.json')
try:
    KO = json.loads(rd('site/src/i18n/messages/ko/deal.json'))['support']
    EN = json.loads(rd('site/src/i18n/messages/en/deal.json'))['support']
except Exception:
    KO, EN = {}, {}
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(x for x in (os.listdir(MD) if os.path.isdir(MD) else []) if x[:1] in 'ABCD')
ok('① 코드 — D225(지우는 문장 없음) · 운영 API 4개 · 정기 작업 · 운영 탭 · 회원 상세 권한 · 운영 알림 이름 · 내 문의 내역 펼침 · 사전 · screens.json · 문서 464 · 판 v10.333 · 마이그레이션 263',
   'ADD COLUMN IF NOT EXISTS due_at' in M25 and 'trg_inquiry_due' in M25 and 'fn_inquiry_due_alert' in M25 and 'INQUIRY_DUE_BREACH' in M25
   and not re.search(r'\b(DROP|DELETE|TRUNCATE)\b', M25) and "@Controller('api/v1/admin/inquiries')" in IC and "@Post(':id/answer')" in IC
   and "@Patch(':id')" in IC and "'INQUIRY_ANSWERED'" in IS and "'INQUIRY_ANSWER'" in IS and 'InquiryAdminController' in AM and 'InquiryAdminService' in AM
   and 'fn_inquiry_due_alert()' in SCH and "['inquiries', '1:1 문의']" in MENU and "tab === 'inquiries' && <InquiryDesk />" in APP and 'data-inquiry-desk' in DESK
   and "'/admin/reports/roles'" in MR and '<MemberRoles accountId={a.id}' in MB and "INQUIRY_DUE_BREACH: '1:1 문의 답변 기한 넘김'" in OA
   and 'data-inquiry-answer' in HI and KO.get('answeredOn') and EN.get('answeredOn') and '"SB-ADM-INQ-010"' in SJ and '"POST /admin/inquiries/{id}/answer"' in SJ
   and 'D225' in doc('464_') and VT >= (10, 333) and len(mig) >= 263 and 'D225_inquiry_answer_desk' in mig, f'{VER} · 마이그레이션 {len(mig)}')
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    t0 = psql("SELECT now()")
    stamp = int(time.time()) % 100000
    T = f'시험 1333 {stamp}'
    clean = lambda: psql("SET session_replication_role = replica; "
                         "DELETE FROM notifications WHERE event_code = 'INQUIRY_ANSWERED' AND body LIKE '%시험 1333 %'; "
                         "DELETE FROM inquiries WHERE title LIKE '시험 1333 %'")
    clean()
    try:
        c1 = call('POST', '/inquiries', {'category': 'ETC', 'title': f'{T} 회원 문의', 'body': '시험 1333 본문입니다'}, TB)
        iid = c1.get('id')
        due = psql(f"SELECT (due_at IS NOT NULL AND due_at > created_at)::text FROM inquiries WHERE id = '{iid}'") if iid else ''
        late = psql(f"INSERT INTO inquiries (account_id, category, title, body, status, created_at, due_at) VALUES ('{buyer}', 'ETC', '{T} 늦은 문의', '늦은 본문 1333', 'OPEN', now() - interval '5 days', now() - interval '1 hour') RETURNING id").splitlines()[0]
        n1 = psql("SELECT fn_inquiry_due_alert()")
        al = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'INQUIRY_DUE_BREACH' AND resolved_at IS NULL")
        ok('② DB — 칸 넷 · 접수하면 기한(영업일 1일)이 채워짐 · 기한 넘긴 문의 → 운영 알림 INQUIRY_DUE_BREACH',
           psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'inquiries' AND column_name IN ('answered_by', 'due_at', 'assignee_id', 'staff_note')") == '4'
           and bool(iid) and due == 'true' and n1.isdigit() and int(n1) >= 1 and al not in ('', '0'), f'{c1.get("no")} · 기한 {due} · 넘김 {n1} · 알림 {al}')
        ls = call('GET', '/admin/inquiries?status=OPEN&q=' + urllib.parse.quote(T), None, TA)
        lo = call('GET', '/admin/inquiries?overdue=1&q=' + urllib.parse.quote(T), None, TA)
        one = call('GET', f'/admin/inquiries/{iid}', None, TA)
        a1 = call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '시험 1333 첫 답변입니다'}, TA)
        noti = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{buyer}' AND event_code = 'INQUIRY_ANSWERED' AND created_at >= '{t0}'")
        mine = next((r for r in call('GET', '/me/inquiries', None, TB) if isinstance(r, dict) and r.get('id') == iid), {})
        a2 = call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '시험 1333 고친 답변입니다', 'close': True}, TA)
        aud = psql(f"SELECT count(*) || '|' || count(*) FILTER (WHERE before_data->>'answer' = '시험 1333 첫 답변입니다') FROM audit.audit_logs WHERE action = 'INQUIRY_ANSWER' AND target_id = '{iid}'")
        a3 = call('POST', f'/admin/inquiries/{iid}/answer', {'answer': '닫힌 뒤 답'}, TA)
        p1 = call('PATCH', f'/admin/inquiries/{iid}', {'status': 'OPEN', 'staffNote': '시험 메모 1333'}, TA)
        st = psql(f"SELECT status || '|' || coalesce(staff_note, '') FROM inquiries WHERE id = '{iid}'")
        a4 = call('POST', f'/admin/inquiries/{iid}/answer', {'answer': 'x'}, TA)
        fb = call('GET', '/admin/inquiries', None, TB)
        rows = ls.get('rows') or []
        ok('③ API — 목록(상태별 수 · 찾기 · 기한 넘김) · 한 건 · 답변 → 회원 알림 · 내 문의 내역에 답 · 고치면 감사 before · 닫힌 문의 409 · 다시 열기 · 짧은 답 422 · 회원 403',
           any(r.get('id') == iid for r in rows) and isinstance(ls.get('counts'), dict) and any(r.get('id') == late for r in (lo.get('rows') or []))
           and not any(r.get('id') == iid for r in (lo.get('rows') or [])) and one.get('body') == '시험 1333 본문입니다' and one.get('guest') is False
           and a1.get('ok') is True and noti not in ('', '0') and mine.get('answer') == '시험 1333 첫 답변입니다' and mine.get('status') == 'ANSWERED'
           and a2.get('ok') is True and aud == '2|1' and a3.get('_err') == 409 and a3.get('code') == 'INQUIRY_CLOSED'
           and p1.get('ok') is True and st == 'OPEN|시험 메모 1333' and a4.get('_err') == 422 and fb.get('_err') == 403,
           f"목록 {len(rows)} · 넘김 {len(lo.get('rows') or [])} · 알림 {noti} · 내 문의 {mine.get('status')} · 감사 {aud} · {a3.get('_err')} · {st} · {a4.get('_err')} · {fb.get('_err')}")
        if ADMIN_WEB:
            def run(b, seen, perr):
                pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.on('pageerror', lambda e: perr.append(str(e)[:120]))
                pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                pg.goto(ADMIN_WEB + '/#/inquiries', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['desk'] = pg.locator('[data-inquiry-desk]').count()
                pg.fill('input[name=inq-q]', T); pg.click('[data-inquiry-q-go]'); pg.wait_for_timeout(2500)
                bt = pg.locator(f'[data-inquiry-open="{iid}"]')
                seen['row'] = bt.count()
                if bt.count():
                    bt.first.click(); pg.wait_for_timeout(2500)
                    seen['one'] = pg.locator(f'[data-inquiry-one="{iid}"]').count()
                    pg.fill('[data-inquiry-answer]', '화면에서 보낸 답변 1333'); pg.click('[data-inquiry-send]'); pg.wait_for_timeout(3000)
                pg.screenshot(path=os.path.join(HERE, 'v1333_desk.png'), full_page=False)
                pg.goto(ADMIN_WEB + '/#/members', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                pg.fill('input[aria-label="회원 검색"]', 'buyer@x.com'); pg.keyboard.press('Enter'); pg.wait_for_timeout(2500)
                lk = pg.locator('[data-member-list] .linkbtn')
                if lk.count():
                    lk.first.click(); pg.wait_for_timeout(3000)
                seen['roles'] = pg.locator('[data-member-roles]').first.get_attribute('data-member-roles') if pg.locator('[data-member-roles]').count() else None
                seen['grant'] = pg.locator('[data-member-role-grant]').count()
                pg.screenshot(path=os.path.join(HERE, 'v1333_member.png'), full_page=False)
            r = ui(run)
            if r is None:
                print('  (playwright 없음 — ④ 건너뜀)')
            else:
                seen, perr = r
                sup = psql("SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = 'admin@x.com' AND r.role = 'SUPER'") != '0'
                sent = psql(f"SELECT answer FROM inquiries WHERE id = '{iid}'")
                ok('④ 화면 — 운영 화면 「1:1 문의」 표 → 펼쳐 답변 보내기 · 회원 상세 「권한 주기 · 거두기」(SUPER 면 단추 · 아니면 안내) · 화면 오류 없음',
                   seen.get('desk') == 1 and seen.get('row') == 1 and seen.get('one') == 1 and sent == '화면에서 보낸 답변 1333'
                   and seen.get('roles') == ('super' if sup else 'read') and (seen.get('grant') == 1 or not sup) and not perr, f'{seen} · SUPER {sup} · {sent} · {perr[:2]}')
        else:
            print('  (ADMIN_WEB 없음 — ④ 건너뜀)')
    finally:
        clean()
        n2 = psql("SELECT fn_inquiry_due_alert()")
    ok('⑤ 지움 — 시험 문의 · 알림 없음 · 남은 넘김이 0이면 운영 알림 풀림',
       psql("SELECT count(*) FROM inquiries WHERE title LIKE '시험 1333 %'") == '0'
       and (n2 != '0' or psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'INQUIRY_DUE_BREACH' AND resolved_at IS NULL") == '0'), f'남은 넘김 {n2}')
else:
    print('  (API · DB 없음 — ② ~ ⑤ 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f'\n결과: {n_ok} / {len(RES)}')
sys.exit(0 if n_ok == len(RES) else 1)
