"""v10.492 (D270 · docs/630) 사내 제안 · 건의함
  ① (코드) D270 its_suggestions(익명 = 작성자 · 시각 칸 비움 · 트리거 · CHECK · 무작위 uuid) · 검토 기록 쌓기만 · 넣기 API 에 @Audit 없음 · 권한 주소 맵에 넣기 · 내 제안 · 접수 번호 없음 · 화면 ItsSuggest · 메뉴 · 화면 목록 ITS-030 · 031 · 문서 630
  ② (API · DB) 익명 내기 → 작성자 · 시각 없음 · 접수 번호 · 감사 기록에 안 남음 · DB 에 계정을 넣어도 지움 · 이름 밝힌 제안은 「내 제안」 · 접수 번호로 보기 · 검토 403 · 익명은 「익명」 · 답변 없이 채택 422 · 검토 중 → 채택 → 끝 · 끝난 것 409 · 기록 · DB 가 내용 고치기 · 지우기 막음 · 접수 대기 알림(수만)
  ③ (화면) 사무 › 제안함 쓰기 · 익명 선택 · 검토(SUPER) · 화면 오류 없음
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
import re as _re
_sub = IC[IC.find("@Post('its/suggestions')"):IC.find('submit(@Body()')] if "@Post('its/suggestions')" in IC else '@Audit'
_ans = IC[IC.find("@Post('its/my-surveys/:id/answer')"):IC.find('async answer(')] if "@Post('its/my-surveys/:id/answer')" in IC else '@Audit'
ok('① 코드 — D270 its_suggestions · ck_its_sug_anon · trg_its_suggest_insert · gen_random_uuid · 기록 쌓기만 · 넣기 · 답 넣기 API 에 @Audit 없음 · 주소 맵에 넣기 · 내 제안 · 접수 번호 · 답 넣기 없음 · ItsSuggest · 메뉴 · 화면 목록 ITS-030 · 031 · 문서 630 · 판 v10.492',
   'CREATE TABLE IF NOT EXISTS public.its_suggestions' in M70 and 'ck_its_sug_anon' in M70 and 'trg_its_suggest_insert' in M70 and 'trg_its_suggestion_log_ro' in M70
   and 'id            uuid PRIMARY KEY DEFAULT gen_random_uuid()' in M70 and 'NEW.author_id := NULL' in M70 and 'NEW.created_at := NULL' in M70
   and '@Audit' not in _sub and '@Audit' not in _ans and "('POST', '/admin/its/suggestions'," not in M70 and "/admin/its/suggestions/mine" not in M70
   and '/admin/its/suggestions/lookup' not in M70 and '/admin/its/my-surveys' not in M70 and "('POST', '/admin/its/suggestions/{id}/decide', 'its-suggest', 'APPROVE')" in M70
   and 'export async function submitSuggestion' in SG and "createHash('sha256')" in SG and 'export function ItsSuggest' in UI and "['its-suggest', '제안함']" in MN
   and "{tab === 'its-suggest' && <ItsSuggest />}" in AP and '"SB-ADM-ITS-030"' in SJ and '"SB-ADM-ITS-031"' in SJ and '익명' in doc('630_') and VT >= (10, 492), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ae, aid, TA = staff('1492a', 'PAYOUT')
    be, bid, TB = staff('1492b', 'REVIEWER')
    ce, cid, TC = staff('1492c', 'ADMIN')
    tag = f'시험1492-{stamp}'
    t0 = psql("SELECT now()")
    s0 = getset('its.suggest_alert')
    try:
        an = call('POST', '/admin/its/suggestions', {'category': 'WORK', 'title': f'{tag} 익명 제안', 'body': '회의를 줄이면 좋겠습니다. 시험 내용입니다.', 'anonymous': True}, TA)
        row = psql(f"SELECT is_anon || '|' || (author_id IS NULL) || '|' || (created_at IS NULL) || '|' || (receipt_hash IS NOT NULL) || '|' || created_on::text FROM its_suggestions WHERE title = '{tag} 익명 제안'")
        mineA = psql(f"SELECT count(*) FROM its_suggestions WHERE author_id = '{aid}'")
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE occurred_at >= '{t0}'::timestamptz AND (action LIKE 'ITS_SUGGEST%' AND actor_account_id = '{aid}' OR after_data::text LIKE '%{tag} 익명%')")
        psql(f"INSERT INTO its_suggestions (category, title, body, is_anon, author_id, created_at) VALUES ('OTHER', '{tag} DB 익명', 'DB 에서 계정을 넣어 봅니다 — 지워져야 합니다.', true, '{aid}', now())")
        dbrow = psql(f"SELECT (author_id IS NULL) || '|' || (created_at IS NULL) FROM its_suggestions WHERE title = '{tag} DB 익명'")
        ok('② 익명 — 작성자 · 시각 없음 · 날짜만 · 접수 번호(12자) · 감사 기록에 안 남음 · DB 에 계정 · 시각을 넣어도 트리거가 지움',
           an.get('ok') is True and _re.match(r'^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$', an.get('receiptCode') or '') is not None and row == f'true|true|true|true|{today}'
           and mineA == '0' and aud == '0' and dbrow == 'true|true', f"{an.get('receiptCode')} {row} {mineA} {aud} {dbrow}")
        nm = call('POST', '/admin/its/suggestions', {'category': 'SYSTEM', 'title': f'{tag} 이름 제안', 'body': '메뉴 찾기가 어렵습니다. 시험 내용입니다.'}, TA)
        mine = call('GET', '/admin/its/suggestions/mine', None, TA)
        mine_titles = [x.get('title') for x in mine.get('items') or [] if tag in (x.get('title') or '')]
        lk = call('POST', '/admin/its/suggestions/lookup', {'code': an.get('receiptCode')}, TB)
        lk404 = call('POST', '/admin/its/suggestions/lookup', {'code': 'ZZZZ-ZZZZ-ZZZZ'}, TA)
        lk400 = call('POST', '/admin/its/suggestions/lookup', {'code': '짧음'}, TA)
        ok('② 이름 밝힘 · 접수 번호 — 「내 제안」에는 이름 밝힌 것만 · 접수 번호로 보기(누구든 번호를 알면) · 없는 번호 404 · 모양 400',
           nm.get('ok') is True and mine_titles == [f'{tag} 이름 제안'] and lk.get('title') == f'{tag} 익명 제안' and lk.get('state') == 'RECEIVED' and 'author' not in lk
           and lk404.get('_err') == 404 and lk400.get('_err') == 400, f"{nm.get('ok')} {mine_titles} {lk.get('state')} {lk404.get('_err')} {lk400.get('_err')}")
        r403 = call('GET', '/admin/its/suggestions', None, TB)
        rv = call('GET', '/admin/its/suggestions?state=ALL&q=' + urllib.parse.quote(tag), None, TC)
        ia = next((x for x in rv.get('items') or [] if x.get('title') == f'{tag} 익명 제안'), {})
        ib = next((x for x in rv.get('items') or [] if x.get('title') == f'{tag} 이름 제안'), {})
        sid = ia.get('id')
        d422 = call('POST', f'/admin/its/suggestions/{sid}/decide', {'to': 'ADOPTED'}, TC)
        d1 = call('POST', f'/admin/its/suggestions/{sid}/decide', {'to': 'REVIEWING'}, TC)
        d2 = call('POST', f'/admin/its/suggestions/{sid}/decide', {'to': 'ADOPTED', 'answer': '다음 달부터 회의 없는 수요일을 합니다.'}, TC)
        d3 = call('POST', f'/admin/its/suggestions/{sid}/decide', {'to': 'DONE'}, TC)
        d409 = call('POST', f'/admin/its/suggestions/{sid}/decide', {'to': 'REVIEWING'}, TC)
        det = call('GET', f'/admin/its/suggestions/{sid}', None, TC)
        lk2 = call('POST', '/admin/its/suggestions/lookup', {'code': an.get('receiptCode')}, TA)
        ok('② 검토 — 검수 담당 403 · 익명은 쓴 사람 없음 · 이름 밝힌 것은 이름 · 답변 없이 채택 422 · 검토 중 → 채택(답변) → 끝 · 끝난 것 409 · 기록 3줄(검토한 사람) · 접수 번호로 답변 봄',
           r403.get('_err') == 403 and ia.get('isAnon') is True and ia.get('author') is None and ib.get('author') == '시험1492a'
           and d422.get('code') == 'ITS_SUGGEST_ANSWER' and d1.get('state') == 'REVIEWING' and d2.get('state') == 'ADOPTED' and d3.get('state') == 'DONE' and d409.get('_err') == 409
           and len(det.get('log') or []) == 3 and all(l.get('actor') == '시험1492c' for l in det.get('log') or []) and det.get('author') is None
           and lk2.get('state') == 'DONE' and '회의 없는 수요일' in (lk2.get('answer') or ''),
           f"{r403.get('_err')} {ia.get('author')} {ib.get('author')} {d422.get('code')} {d1.get('state')} {d2.get('state')} {d3.get('state')} {d409.get('_err')} {len(det.get('log') or [])} {lk2.get('state')}")
        ro1 = psql(f"UPDATE its_suggestions SET title = '바꿈' WHERE title = '{tag} 이름 제안'")
        ro2 = psql(f"DELETE FROM its_suggestions WHERE title = '{tag} 이름 제안'")
        ro3 = psql(f"UPDATE its_suggestions SET author_id = '{aid}' WHERE title = '{tag} 익명 제안'")
        setting('its.suggest_alert', 'on', '1492')
        jb = call('POST', '/admin/jobs', {'job': 'its_office_daily'}, TS)
        al = psql(f"SELECT count(*) || '|' || coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'ITS_SUGGEST_WAITING' AND detail->>'day' = '{today}' AND resolved_at IS NULL")
        ok('② DB 가 제목 고치기 · 지우기 · 익명에 작성자 넣기를 막음 · 접수 대기 알림 ITS_SUGGEST_WAITING 하루 하나(제목 · 쓴 사람 없이 수만)',
           '!' in ro1 and '!' in ro2 and '!' in ro3 and jb.get('_err') is None and al.startswith('1|') and tag not in al and '제안' in al, f"{ro1[-30:]} {ro2[-30:]} {ro3[-30:]} {al}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM its_suggestion_log WHERE suggestion_id IN (SELECT id FROM its_suggestions WHERE title LIKE '시험1492-%'); "
             f"DELETE FROM its_suggestions WHERE title LIKE '시험1492-%'; DELETE FROM ops_alerts WHERE alert_code = 'ITS_SUGGEST_WAITING' AND raised_at >= '{t0}'::timestamptz;")
        setting('its.suggest_alert', s0 or None, '1492 되돌림')
        rm_role(aid, '1492'); rm_role(bid, '1492'); rm_role(cid, '1492')
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        seen['form'] = pg.locator('[data-its-sug-form]').count()
        seen['anon'] = pg.locator('[data-its-sug-anon] input[type=checkbox]').is_checked() if pg.locator('[data-its-sug-anon]').count() else None
        seen['review'] = pg.locator('[data-its-sug-review]').count()
    r = admin_page('/#/its-suggest', chk)
    if r:
        seen, perr = r
        ok('③ 화면 — 사무 › 제안함 쓰기(익명 처음 켬) · 검토(SUPER) · 화면 오류 없음', seen.get('form') == 1 and seen.get('anon') is True and seen.get('review') == 1 and not perr, f'{seen} {perr[:2]}')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
