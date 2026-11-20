"""v10.493 (D270 · docs/631) 사내 설문
  ① (코드) D270 its_surveys · 질문(고치는 중만) · 낸 사람(시각 없음) · 답(익명이면 계정 없음 · 무작위 uuid · 시각 없음 · 유형 검사 트리거) · its.survey_min_count 3 · 내려받기 승인 ITS_SURVEY · 화면 ItsSurvey · 메뉴 · 화면 목록 ITS-040 · 041 · 문서 631
  ② (API · DB) 만들기(검수 담당 403) · 열기 · 두 번 409 · 받는 중 제목 409 · 마감일 늦추기 · 대상 밖 404 · 꼭 답할 것 빠지면 422 · 내기 · 두 번 409 · 답에 계정 없음 · DB 에 계정을 넣어도 지움 · 받는 중 결과 감춤 · 마감 뒤 집계 · 글 답 가나다순 · 응답이 적으면 감춤 · CSV 승인 없이 422 · 승인 뒤 집계 · 이름 밝힌 설문은 계정 · 낸 사람 · 기간 지나면 저절로 마감 · DB 가 답 고치기 막음
  ③ (화면) 사무 › 사내 설문 답할 설문 · 관리(SUPER) · 화면 오류 없음
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


M70 = migr('D270_')
KY, AS, SG, SV, DY, IC = (rd('src/modules/admin/its-keys.ts'), rd('src/modules/admin/its-assets.ts'), rd('src/modules/admin/its-suggest.ts'),
                          rd('src/modules/admin/its-survey.ts'), rd('src/modules/admin/its-daily.ts'), rd('src/modules/admin/its.controller.ts'))
UI, AP, MN, AM, SC, WK = (rd('web/src/app/admin/Its.tsx'), rd('web/src/App.tsx'), rd('web/src/lib/adminMenu.ts'), rd('src/app.module.ts'),
                          rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
stamp = int(time.time()) % 1000000
kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
today = kst.strftime('%Y-%m-%d')
day = lambda n: (kst + datetime.timedelta(days=n)).strftime('%Y-%m-%d')

EA = rd('src/modules/admin/export-approval.ts')
ok('① 코드 — D270 its_surveys · its_survey_questions · its_survey_takers · its_survey_answers(무작위 uuid · 계정 지움 · 유형 검사) · its.survey_min_count 3 · ITS_SURVEY(서버 · DB) · ItsController 설문 12 · ItsSurvey · 메뉴 · 화면 목록 ITS-040 · 041 · 문서 631 · 판 v10.493',
   'CREATE TABLE IF NOT EXISTS public.its_survey_answers' in M70 and 'trg_its_survey_answer_guard' in M70 and 'NEW.account_id := NULL' in M70 and 'trg_its_survey_takers_ro' in M70
   and "('its.survey_min_count', '3'" in M70 and "'ITS_SURVEY'" in M70 and "'ITS_SURVEY'] as const" in EA and "@ExportGate('ITS_SURVEY')" in IC
   and "@Post('its/my-surveys/:id/answer')" in IC and 'export async function surveyResults' in SV and 'itsSurveyCloseJob' in DY
   and 'export function ItsSurvey' in UI and "['its-survey', '사내 설문']" in MN and "{tab === 'its-survey' && <ItsSurvey />}" in AP
   and '"SB-ADM-ITS-040"' in SJ and '"SB-ADM-ITS-041"' in SJ and '설문' in doc('631_') and VT >= (10, 493), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1493a', 'PAYOUT')
    be, bid, TB = staff('1493b', 'REVIEWER')
    de, did, TD = staff('1493d', 'PARTNER_AFF')
    tag = f'시험1493-{stamp}'
    t0 = psql("SELECT now()")
    m0 = getset('its.survey_min_count')
    QS = [{'type': 'SINGLE', 'body': '도구 만족', 'options': ['좋음', '보통', '나쁨']}, {'type': 'MULTI', 'body': '자주 쓰는 것', 'options': ['메일', '메신저', '캘린더']},
          {'type': 'SCALE', 'body': '추천 점수', 'scaleMax': 5}, {'type': 'TEXT', 'body': '하고 싶은 말', 'required': False}]
    try:
        setting('its.survey_min_count', '3', '1493')
        c403 = call('POST', '/admin/its/surveys', {'title': f'{tag} 막힘', 'opensOn': today, 'closesOn': day(7), 'questions': QS}, TB)
        n1 = call('POST', '/admin/its/surveys', {'title': f'{tag} 익명', 'anonymous': True, 'audience': ['PAYOUT', 'REVIEWER', 'ADMIN'], 'opensOn': today, 'closesOn': day(7), 'questions': QS}, TS)
        sid = n1.get('id')
        before = [x for x in call('GET', '/admin/its/my-surveys', None, TA).get('items') or [] if x.get('id') == sid]
        o1 = call('POST', f'/admin/its/surveys/{sid}/open', None, TS)
        o2 = call('POST', f'/admin/its/surveys/{sid}/open', None, TS)
        t409 = call('PUT', f'/admin/its/surveys/{sid}', {'title': '바꿈'}, TS)
        ext = call('PUT', f'/admin/its/surveys/{sid}', {'closesOn': day(10)}, TS)
        fa = call('GET', f'/admin/its/my-surveys/{sid}', None, TA)
        fd = call('GET', f'/admin/its/my-surveys/{sid}', None, TD)
        ok('② 만들기 · 열기 — 검수 담당 만들기 403 · 열기 전 안 보임 · 열기 · 두 번 409 · 받는 중 제목 409 · 마감일 늦추기 · 대상(지급 담당) 답하기 화면 · 대상 밖(제휴 담당) 404',
           c403.get('_err') == 403 and n1.get('ok') is True and not before and o1.get('state') == 'OPEN' and o2.get('_err') == 409 and t409.get('code') == 'ITS_SURVEY_STATE'
           and ext.get('ok') is True and len(fa.get('questions') or []) == 4 and fd.get('_err') == 404,
           f"{c403.get('_err')} {n1.get('ok')} {before} {o1.get('state')} {o2.get('_err')} {t409.get('code')} {ext.get('ok')} {len(fa.get('questions') or [])} {fd.get('_err')}")
        q = {x['ord']: x['id'] for x in fa.get('questions') or []}
        miss = call('POST', f'/admin/its/my-surveys/{sid}/answer', {'answers': {q.get(1): 0}}, TA)
        a1 = call('POST', f'/admin/its/my-surveys/{sid}/answer', {'answers': {q.get(1): 0, q.get(2): [0, 2], q.get(3): 4, q.get(4): '하하 좋습니다'}}, TA)
        a1b = call('POST', f'/admin/its/my-surveys/{sid}/answer', {'answers': {q.get(1): 1, q.get(2): [1], q.get(3): 3}}, TA)
        bad = call('POST', f'/admin/its/my-surveys/{sid}/answer', {'answers': {q.get(1): 7, q.get(2): [0], q.get(3): 1}}, TB)
        a2 = call('POST', f'/admin/its/my-surveys/{sid}/answer', {'answers': {q.get(1): 1, q.get(2): [1], q.get(3): 2, q.get(4): '가나 아쉽습니다'}}, TB)
        db3 = psql(f"INSERT INTO its_survey_answers (survey_id, account_id, answers) VALUES ({int(sid or 0)}, '{did}', '{{\"{q.get(1)}\": 0, \"{q.get(2)}\": [2], \"{q.get(3)}\": 5}}'::jsonb)")
        accs = psql(f"SELECT count(*) || '|' || count(account_id) FROM its_survey_answers WHERE survey_id = {int(sid or 0)}")
        tk = psql(f"SELECT count(*) FROM its_survey_takers WHERE survey_id = {int(sid or 0)} AND account_id IN ('{aid}', '{bid}')")
        cols = psql("SELECT count(*) FROM information_schema.columns WHERE table_name IN ('its_survey_answers', 'its_survey_takers') AND data_type LIKE 'timestamp%'")
        ok('② 답하기 — 꼭 답할 것 빠짐 422 · 내기 · 두 번 409 · 보기 밖 422 · 답 3줄 모두 계정 없음(DB 에 넣어도 지움) · 낸 사람 2 · 두 표에 시각 칸 없음',
           miss.get('code') == 'ITS_SURVEY_ANSWER' and a1.get('ok') is True and a1b.get('_err') == 409 and a2.get('ok') is True and bad.get('code') == 'ITS_SURVEY_ANSWER'
           and '!' not in db3 and accs == '3|0' and tk == '2' and cols == '0', f"{miss.get('code')} {a1.get('ok')} {a1b.get('_err')} {a2.get('ok')} {bad.get('code')} {db3[-40:]} {accs} {tk} {cols}")
        r_open = call('GET', f'/admin/its/surveys/{sid}/results', None, TS)
        e422 = call('GET', f'/admin/its/surveys/{sid}/export', None, TS)
        cl = call('POST', f'/admin/its/surveys/{sid}/close', None, TS)
        res = call('GET', f'/admin/its/surveys/{sid}/results', None, TS)
        q1 = next((x for x in res.get('questions') or [] if x.get('ord') == 1), {})
        q3 = next((x for x in res.get('questions') or [] if x.get('ord') == 3), {})
        q4 = next((x for x in res.get('questions') or [] if x.get('ord') == 4), {})
        ok('② 결과 — 받는 중 감춤(OPEN) · 승인 없이 CSV 422 · 마감 → 응답 3 · 하나 고르기 [2,1,0] · 점수 평균 3.67 · 글 답 가나다순 · 낸 사람 이름 없음',
           r_open.get('hidden') == 'OPEN' and not r_open.get('questions') and e422.get('code') == 'EXPORT_NEED_APPROVAL' and cl.get('state') == 'CLOSED' and res.get('responses') == 3
           and q1.get('counts') == [2, 1, 0] and q3.get('avg') == 3.67 and q4.get('texts') == ['가나 아쉽습니다', '하하 좋습니다'] and res.get('respondents') is None,
           f"{r_open.get('hidden')} {e422.get('code')} {cl.get('state')} {res.get('responses')} {q1.get('counts')} {q3.get('avg')} {q4.get('texts')}")
        tkt = __import__('export_ticket').get(TS, 'ITS_SURVEY', TS)
        ex = call('GET', f'/admin/its/surveys/{sid}/export?ticket={tkt}', None, TS) if tkt else {}
        ok('② CSV — 내려받기 승인(ITS_SURVEY) 뒤 집계 · 응답 수 · 이름 없음(승인 번호를 못 받는 점검판이면 건너뜀)',
           tkt is None or ('응답 수' in (ex.get('csv') or '') and '시험1493a' not in (ex.get('csv') or '') and ex.get('responses') == 3), f"{tkt} {str(ex)[:80]}")
        n2 = call('POST', '/admin/its/surveys', {'title': f'{tag} 적음', 'opensOn': today, 'closesOn': day(3), 'questions': QS[:1]}, TS)
        call('POST', f"/admin/its/surveys/{n2.get('id')}/open", None, TS)
        f2 = call('GET', f"/admin/its/my-surveys/{n2.get('id')}", None, TA)
        call('POST', f"/admin/its/my-surveys/{n2.get('id')}/answer", {'answers': {(f2.get('questions') or [{}])[0].get('id'): 2}}, TA)
        call('POST', f"/admin/its/surveys/{n2.get('id')}/close", None, TS)
        r2 = call('GET', f"/admin/its/surveys/{n2.get('id')}/results", None, TS)
        e2 = call('GET', f"/admin/its/surveys/{n2.get('id')}/export?ticket=1", None, TS)
        ok('② 응답이 적으면 — 마감 뒤에도 감춤(MIN) · 응답 수도 감춤', r2.get('hidden') == 'MIN' and r2.get('responses') is None and not r2.get('questions') and e2.get('_err') == 422,
           f"{r2.get('hidden')} {r2.get('responses')} {e2.get('code')}")
        n3 = call('POST', '/admin/its/surveys', {'title': f'{tag} 이름', 'anonymous': False, 'opensOn': today, 'closesOn': day(3), 'questions': QS[:1]}, TS)
        call('POST', f"/admin/its/surveys/{n3.get('id')}/open", None, TS)
        f3 = call('GET', f"/admin/its/my-surveys/{n3.get('id')}", None, TA)
        a3 = call('POST', f"/admin/its/my-surveys/{n3.get('id')}/answer", {'answers': {(f3.get('questions') or [{}])[0].get('id'): 0}}, TA)
        acc3 = psql(f"SELECT account_id::text FROM its_survey_answers WHERE survey_id = {int(n3.get('id') or 0)}")
        r3 = call('GET', f"/admin/its/surveys/{n3.get('id')}/results", None, TS)
        ro = psql(f"UPDATE its_survey_answers SET answers = '{{}}'::jsonb WHERE survey_id = {int(n3.get('id') or 0)}")
        ok('② 이름 밝힌 설문 — 답에 계정 · 받는 중에도 결과 · 낸 사람 이름 · DB 가 답 고치기 막음',
           a3.get('ok') is True and acc3 == aid and r3.get('hidden') is None and r3.get('respondents') == ['시험1493a'] and '!' in ro, f"{a3.get('ok')} {acc3 == aid} {r3.get('hidden')} {r3.get('respondents')} {ro[-30:]}")
        psql(f"SET session_replication_role = replica; UPDATE its_surveys SET opens_on = '{day(-5)}', closes_on = '{day(-1)}' WHERE id = {int(n3.get('id') or 0)};")
        jb = call('POST', '/admin/jobs', {'job': 'its_office_daily'}, TS)
        st3 = psql(f"SELECT state FROM its_surveys WHERE id = {int(n3.get('id') or 0)}")
        late = psql(f"INSERT INTO its_survey_answers (survey_id, answers) VALUES ({int(n3.get('id') or 0)}, '{{}}'::jsonb)")
        ok('② 정기 작업 its_office_daily — 기간 지난 설문 저절로 마감 · 마감 뒤 DB 넣기 막음(ITS_SURVEY_CLOSED)', jb.get('_err') is None and st3 == 'CLOSED' and 'ITS_SURVEY_CLOSED' in late, f"{jb.get('_err')} {st3} {late[-50:]}")
    finally:
        psql("SET session_replication_role = replica; "
             "DELETE FROM its_survey_answers WHERE survey_id IN (SELECT id FROM its_surveys WHERE title LIKE '시험1493-%'); "
             "DELETE FROM its_survey_takers WHERE survey_id IN (SELECT id FROM its_surveys WHERE title LIKE '시험1493-%'); "
             "DELETE FROM its_survey_questions WHERE survey_id IN (SELECT id FROM its_surveys WHERE title LIKE '시험1493-%'); "
             "DELETE FROM its_surveys WHERE title LIKE '시험1493-%';")
        setting('its.survey_min_count', m0 or None, '1493 되돌림')
        rm_role(aid, '1493'); rm_role(bid, '1493'); rm_role(did, '1493')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['my'] = pg.locator('[data-its-my-survey]').count()
        seen['admin'] = pg.locator('[data-its-survey-admin]').count()
        pg.locator('[data-its-survey-new]').click(); pg.wait_for_timeout(800)
        seen['edit'] = pg.locator('[data-its-survey-edit]').count()
    r = admin_page('/#/its-survey', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 사내 설문 답할 설문 · 관리(SUPER) · 만들기 상자 · 화면 오류 없음', seen.get('my') == 1 and seen.get('admin') == 1 and seen.get('edit') == 1 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
