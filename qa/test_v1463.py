"""v10.463 (D263 · docs/601) 업무 요청 · 할 일 보드
  ① (코드) D263 ofc_tasks · 상태 가드 · 댓글 쌓기만 · 정기 작업 ofc_task_due 09:10 · OfcController · 화면 OfcTasks · 메뉴 · 화면 목록 OFC-020 · 문서 601
  ② (API · DB) 요청 → 담당 보드 「요청」 칸 · 남은 404 · 요청한 사람이 진행 403 · 진행 · 완료 · 다시 열기 · 담당이 취소 403 · 끝난 것 취소 409 · 댓글 · 제목 고치기 DB 막음 · 기한 지남 알림(수만)
  ③ (화면) 사무 › 업무 요청 칸 셋 · 화면 오류 없음
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

SJ = rd('spec/screens.json')

import base64
def jwt_life(tok):
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        j = json.loads(base64.urlsafe_b64decode(p)); return int(j["exp"]) - int(j["iat"])
    except Exception:
        return None
def login_full(e, pw=PW):
    return call("POST", "/auth/login", {"email": e, "password": pw})
def mk_staff(tag, role="ADMIN"):
    stamp = int(time.time()) % 100000
    em = f"t{tag}s{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if role:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', '{role}') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid
def rm_role(aid, tag):
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag} 지움', true); DELETE FROM account_roles WHERE account_id = '{aid}' AND role <> 'MEMBER'; COMMIT;")




def admin_page(path, fn):
    def run(b, seen, perr):
        pg = b.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: perr.append(str(e)[:120]))
        pg.goto(ADMIN_WEB + "/", wait_until="networkidle", timeout=120000)
        pg.fill("input[name=email]", "admin@x.com"); pg.fill("input[name=password]", PW); pg.click("button[type=submit]"); pg.wait_for_timeout(3000)
        pg.goto(ADMIN_WEB + path, wait_until="networkidle", timeout=120000); pg.wait_for_timeout(3000)
        fn(pg, seen)
    return ui(run)


def setting(key, value, tag):
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def staff(tag, role):
    """운영 계정 하나 + 약관 동의 + 증표(시험 끝에 역할 지움)"""
    import consent_ok
    em, aid = mk_staff(tag, role)
    consent_ok.agree(em, PW)
    return em, aid, login(em)


M63 = migr('D263_')
CC, CT, CR, CN, OC = (rd('src/modules/acct/ofc-calendar.ts'), rd('src/modules/acct/ofc-tasks.ts'), rd('src/modules/acct/ofc-trips.ts'),
                      rd('src/modules/acct/ofc-notify.ts'), rd('src/modules/acct/ofc.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Ofc.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today, ym = kst.strftime('%Y-%m-%d'), kst.strftime('%Y-%m')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

ok('① 코드 — D263 ofc_tasks · trg_ofc_task_guard · 댓글 fn_block_write · ofc.task_due_alert · 정기 작업 ofc_task_due 09:10 · OfcController · OfcTasks · 메뉴 · 화면 목록 OFC-020 · 문서 601 · 판 v10.463',
   'CREATE TABLE IF NOT EXISTS public.ofc_tasks' in M63 and 'trg_ofc_task_guard' in M63 and 'trg_ofc_task_comments_ro' in M63 and "('ofc_task_due', 1440, 9, 10" in M63
   and 'export async function ofcTaskDueJob' in CT and "case 'ofc_task_due':" in SC and "'ofc_task_due'," in WK and "@Post('office/tasks/:id/move')" in OC
   and 'export function OfcTasks' in UI and "['ofc-tasks', '업무 요청']" in MN and "{tab === 'ofc-tasks' && <OfcTasks />}" in AP and '"SB-ADM-OFC-020"' in SJ
   and '업무 요청' in doc('601_') and VT >= (10, 463), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1463a', 'PAYOUT')
    be, bid, TB = staff('1463b', 'REVIEWER')
    ce, cid, TC = staff('1463c', 'ADMIN')
    tag = f'시험1463-{stamp}'
    t0 = psql("SELECT now()")
    s0 = getset('ofc.task_due_alert')
    try:
        n1 = call('POST', '/admin/office/tasks', {'title': f'{tag} 검토', 'body': '내용', 'assigneeId': bid, 'dueOn': today, 'priority': 'HIGH'}, TA)
        tid = n1.get('id')
        bad = call('POST', '/admin/office/tasks', {'title': f'{tag} 지난 기한', 'assigneeId': bid, 'dueOn': day(-1)}, TA)
        bb = call('GET', '/admin/office/tasks?view=mine', None, TB)
        col = next((c for c in bb.get('columns') or [] if c.get('state') == 'REQUESTED'), {})
        card = next((x for x in col.get('items') or [] if x.get('id') == tid), {})
        other = call('GET', f'/admin/office/tasks/{tid}', None, TC)
        sup = call('GET', f'/admin/office/tasks/{tid}', None, TS)
        m403 = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DOING'}, TA)
        m1 = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DOING'}, TB)
        m1b = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DOING'}, TB)
        m2 = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DONE', 'note': '마침'}, TB)
        m3 = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DOING'}, TA)
        m4 = call('POST', f'/admin/office/tasks/{tid}/move', {'to': 'DONE'}, TB)
        c403 = call('POST', f'/admin/office/tasks/{tid}/cancel', {'reason': '시험 1463'}, TB)
        c409 = call('POST', f'/admin/office/tasks/{tid}/cancel', {'reason': '시험 1463'}, TA)
        cm = call('POST', f'/admin/office/tasks/{tid}/comments', {'body': '확인했습니다'}, TB)
        dt = call('GET', f'/admin/office/tasks/{tid}', None, TA)
        st = psql(f"SELECT state || '|' || (done_at IS NOT NULL) || '|' || (started_at IS NOT NULL) FROM ofc_tasks WHERE id = {int(tid or 0)}")
        ro1 = psql(f"UPDATE ofc_tasks SET title = '바꿈' WHERE id = {int(tid or 0)}")
        ro2 = psql(f"DELETE FROM ofc_task_comments WHERE task_id = {int(tid or 0)}")
        ok('② 흐름 — 요청 → 담당 「요청」 칸(오늘까지 · 중요) · 지난 기한 422 · 남은 404 · SUPER 봄 · 요청한 사람 진행 403 · 진행 · 같은 칸 409 · 완료 · 다시 열기 · 완료 · 담당 취소 403 · 끝난 것 취소 409 · 댓글 · 기록 · DB 가 제목 고치기 · 댓글 지우기 막음',
           n1.get('ok') is True and bad.get('code') == 'OFC_TASK_DUE' and card.get('due') == 'TODAY' and card.get('priority') == 'HIGH' and other.get('_err') == 404 and sup.get('id') == tid
           and m403.get('_err') == 403 and m403.get('code') == 'OFC_TASK_WHO' and m1.get('state') == 'DOING' and m1b.get('_err') == 409 and m2.get('state') == 'DONE' and m3.get('state') == 'DOING' and m4.get('state') == 'DONE'
           and c403.get('_err') == 403 and c409.get('_err') == 409 and c409.get('code') == 'OFC_TASK_STATE' and cm.get('ok') is True
           and len(dt.get('comments') or []) >= 6 and (dt.get('can') or {}).get('reopen') is True and st.startswith('DONE|true|true') and '!' in ro1 and '!' in ro2,
           f"{n1.get('ok')} {bad.get('code')} {card.get('due')} {other.get('_err')} · {m403.get('_err')} {m1.get('state')} {m1b.get('_err')} {m2.get('state')} {m3.get('state')} {m4.get('state')} · {c403.get('_err')} {c409.get('code')} · {len(dt.get('comments') or [])} {st} {ro1[-30:]}")
        n2 = call('POST', '/admin/office/tasks', {'title': f'{tag} 넘김', 'assigneeId': aid}, TA)
        as403 = call('POST', f"/admin/office/tasks/{n2.get('id')}/assign", {'assigneeId': cid}, TB)
        as1 = call('POST', f"/admin/office/tasks/{n2.get('id')}/assign", {'assigneeId': cid, 'note': '대신 부탁'}, TA)
        cnew = call('GET', '/admin/office/tasks?view=mine', None, TC)
        seen_c = any(x.get('id') == n2.get('id') for c in cnew.get('columns') or [] for x in c.get('items') or [])
        cc = call('POST', f"/admin/office/tasks/{n2.get('id')}/cancel", {'reason': '시험 1463 취소'}, TA)
        ok('② 담당 바꾸기 · 취소 — 남이 바꾸기 404(안 보임) · 요청한 사람이 바꿈 · 새 담당 보드에 보임 · 취소',
           n2.get('ok') is True and as403.get('_err') == 404 and as1.get('ok') is True and seen_c and cc.get('ok') is True,
           f"{n2.get('ok')} {as403.get('_err')} {as1.get('ok')} {seen_c} {cc.get('ok')}")
        setting('ofc.task_due_alert', 'on', '1463')
        psql(f"INSERT INTO ofc_tasks (title, requester, assignee, due_on) VALUES ('{tag} 지남', '{aid}', '{bid}', '{day(-3)}')")
        jb = call('POST', '/admin/jobs', {'job': 'ofc_task_due'}, TS)
        al = psql(f"SELECT count(*) || '|' || coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'OFC_TASK_OVERDUE' AND detail->>'day' = '{today}' AND resolved_at IS NULL")
        ok('② 기한 지남 — 정기 작업 ofc_task_due · 운영 알림 OFC_TASK_OVERDUE 하루 하나(제목에 업무 제목 없음 · 수만)',
           jb.get('_err') is None and al.startswith('1|') and tag not in al and '기한 지난 업무 요청' in al, f"{jb.get('_err')} {al}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM ofc_task_comments WHERE task_id IN (SELECT id FROM ofc_tasks WHERE title LIKE '시험1463-%'); "
             f"DELETE FROM ofc_tasks WHERE title LIKE '시험1463-%'; DELETE FROM ops_alerts WHERE alert_code = 'OFC_TASK_OVERDUE' AND raised_at >= '{t0}'::timestamptz;")
        setting('ofc.task_due_alert', s0 or None, '1463 되돌림')
        rm_role(aid, '1463'); rm_role(bid, '1463'); rm_role(cid, '1463')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['cols'] = pg.locator('[data-ofc-task-col]').count()
        pg.locator('[data-ofc-task-add]').click(); pg.wait_for_timeout(800)
        seen['form'] = pg.locator('[data-ofc-task-new]').count()
    r = admin_page('/#/ofc-tasks', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 업무 요청 칸 셋(요청 · 진행 · 완료) · 새 요청 상자 · 화면 오류 없음', seen.get('cols') == 3 and seen.get('form') == 1 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
