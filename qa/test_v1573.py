"""v10.573 (docs/715) 11차 회원 · 거래 ① 신고 → 이의 제기 — 스위치 mtr.appeal(처음 off)
  ① (코드) 이의 표 · 대상마다 한 번 · 결정 뒤 못 바꿈 · 설정 정규식 서버 = DB · 화면 목록 · 연결
  ② (DB · API) 신고로 가려진 글 → 회원 목록(사유 · 신고한 사람 없음) · 이의 400 · 됨 · 409 · 404 · 운영 받아들임(다시 보임 · 신고 기각 · 알림) · 다시 결정 409 · DB 지킴 · 꺼짐 422 · 기한 알림
  (두 번 돌아도 통과 — 「시험1573-」 글 · 신고 · 이의 · 알림은 시작 · 끝에 replica 로 지움 · 설정은 되돌림)
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


def migr_has(word):
    """그 낱말이 든 마이그레이션(번호는 합칠 때 정해짐)"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


"""시험 몸통"""
MS = migr_has('mtr_appeals')
CM = rd('src/modules/mtr/common.ts')
AP = rd('src/modules/mtr/appeal.ts')
CT = rd('src/modules/mtr/mtr.controller.ts')
D715 = doc('715_')
pat_ts = dict(re.findall(r"'(mtr\.[a-z_]+)': '([^']+)'", CM))
pat_db = dict(re.findall(r"\('(mtr\.[a-z_]+)', '[^']*', 'ADMIN', '(?:[^']|'')*', false, '([^']+)'", MS))
ok('① 코드 — 이의 제기 표 · 대상마다 한 번(고유 색인) · 결정 뒤 못 바꿈(트리거) · 설정 정규식 서버 = DB · 스위치 처음 off · 문서 715 · 판',
   'CREATE TABLE IF NOT EXISTS public.mtr_appeals' in MS and 'uq_mtr_appeal_target' in MS and 'fn_mtr_appeal_guard' in MS
   and len(pat_ts) == 14 and pat_ts == pat_db and "('mtr.appeal', 'off'" in MS and "('mtr.review_watch', 'off'" in MS and "('mtr.trust', 'off'" in MS and "('mtr.dormant', 'off'" in MS
   and 'createAppeal' in AP and "'IN_REVIEW'" in AP and "state = 'DISMISSED'" in AP and 'MTR_APPEAL_OVERDUE' in AP
   and "Post('me/mtr/appeals')" in CT and "Post('admin/mtr/appeals/:id/decide')" in CT and '이의' in D715 and VT >= (10, 573),
   f"{VER} {len(pat_ts)} {set(pat_ts.items()) ^ set(pat_db.items())}")
ok('① 화면 목록 · 연결 — SB-ADM-MTR-010 · SB-MYP-MTR-010 · 위험감지 탭 · 내 신고 내역 아래 안내',
   'SB-ADM-MTR-010' in SJ and 'SB-MYP-MTR-010' in SJ and "'mtr-appeals'" in rd('web/src/lib/adminMenu.ts') and '/my/appeals' in rd('site/src/app/my/reports/page.tsx'),
   '')

STAMP = int(time.time()) % 1000000
if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    TB = login('buyer@x.com')
    tag = f'시험1573-{STAMP}'
    T0 = psql("SELECT now()::text")
    buyer = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
    seller = psql("SELECT id FROM accounts WHERE email = 'seller@x.com'")
    reason = psql("SELECT code FROM report_reasons WHERE gwan_code IS NULL AND code <> 'OTHER' ORDER BY sort_order LIMIT 1")
    old_on = getset('mtr.appeal')
    CLEAN = (f"SET session_replication_role = replica; "
             f"DELETE FROM notifications WHERE event_code IN ('MTR_APPEAL_DECIDED', 'REPORT_RESOLVED') AND created_at >= '{T0}' AND account_id IN ('{buyer}', '{seller}'); "
             f"DELETE FROM mtr_appeals WHERE target_id IN (SELECT id FROM posts WHERE title LIKE '시험1573-%'); "
             f"DELETE FROM reports WHERE target_id IN (SELECT id FROM posts WHERE title LIKE '시험1573-%'); "
             f"DELETE FROM posts WHERE title LIKE '시험1573-%'; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'MTR_APPEAL_OVERDUE' AND raised_at >= '{T0}';")
    psql("SET session_replication_role = replica; DELETE FROM mtr_appeals WHERE target_id IN (SELECT id FROM posts WHERE title LIKE '시험1573-%'); "
         "DELETE FROM reports WHERE target_id IN (SELECT id FROM posts WHERE title LIKE '시험1573-%'); DELETE FROM posts WHERE title LIKE '시험1573-%';")

    def hidden_post(title):
        pid = psql(f"SET session_replication_role = replica; INSERT INTO posts (board, author_id, title, body) VALUES ('QNA', '{buyer}', '{title}', '시험 글입니다({title}). 열 글자를 넘깁니다.') RETURNING id").split('\n')[0]   # 글 가드(같은 본문 · 하루 5개)는 이 시험 대상이 아님
        psql(f"UPDATE posts SET state = 'HIDDEN', hidden_at = now(), hidden_reason = '신고 3건 — 운영 확인 대기' WHERE id = '{pid}'")
        psql(f"INSERT INTO reports (target_type, target_id, reason_code, detail, reporter_id, state) VALUES ('POST', '{pid}', '{reason}', '시험 신고 1573', '{seller}', 'OPEN')")
        return pid
    try:
        setting('mtr.appeal', 'on', '1573')
        p1 = hidden_post(f'{tag} 첫 글')
        p2 = hidden_post(f'{tag} 둘째 글')
        g = call('GET', '/me/mtr/appeals', None, TB)
        it = next((x for x in (g.get('down') or []) if x.get('targetId') == p1), None)
        raw = json.dumps(g, ensure_ascii=False)
        ok('② 회원 — 내려간 글 · 신고 사유 이름 · 건수 · 이의 낼 수 있음 · 신고한 사람 정보 없음(seller 이메일 · 번호 안 보임)',
           g.get('on') is True and it is not None and it.get('canAppeal') is True and it.get('targetState') == 'HIDDEN' and len(it.get('reasons') or []) >= 1
           and 'seller@x.com' not in raw and seller not in raw, f"{g.get('on')} {it and {k: it.get(k) for k in ('canAppeal', 'targetState', 'reasons')}}")
        s1 = call('POST', '/me/mtr/appeals', {'targetType': 'POST', 'targetId': p1, 'body': '짧음'}, TB)
        c1 = call('POST', '/me/mtr/appeals', {'targetType': 'POST', 'targetId': p1, 'body': '광고 글이 아니라 질문 글입니다. 다시 봐 주십시오.'}, TB)
        c2 = call('POST', '/me/mtr/appeals', {'targetType': 'POST', 'targetId': p1, 'body': '한 번 더 이의를 냅니다. 열 글자 넘김.'}, TB)
        nf = call('POST', '/me/mtr/appeals', {'targetType': 'LISTING', 'targetId': p1, 'body': '남의 것 · 없는 매물에 이의를 냅니다.'}, TB)
        ok('② 이의 내기 — 10자 미만 400 · 첫 이의 됨 · 두 번째 409 MTR_APPEAL_DONE · 내려간 내 것이 아니면 404',
           s1.get('_err') == 400 and c1.get('ok') is True and c2.get('_err') == 409 and c2.get('code') == 'MTR_APPEAL_DONE' and nf.get('_err') == 404,
           f"{s1.get('_err')} {c1.get('ok') or c1} {c2.get('_err')} {c2.get('code')} {nf.get('_err')}")
        lst = call('GET', '/admin/mtr/appeals?state=OPEN', None, TS)
        row = next((r for r in (lst.get('rows') or []) if r.get('targetId') == p1), None)
        aid = row.get('id') if row else None
        bad = call('POST', f'/admin/mtr/appeals/{aid}/decide', {'accept': True, 'note': ''}, TS) if aid else {}
        dec = call('POST', f'/admin/mtr/appeals/{aid}/decide', {'accept': True, 'note': '질문 글이 맞아 다시 올립니다'}, TS) if aid else {}
        again = call('POST', f'/admin/mtr/appeals/{aid}/decide', {'accept': False, 'note': '다시 결정'}, TS) if aid else {}
        st = psql(f"SELECT p.state || '|' || p.report_count || '|' || (SELECT string_agg(r.state, ',') FROM reports r WHERE r.target_id = p.id) FROM posts p WHERE p.id = '{p1}'")
        nt = psql(f"SELECT (SELECT count(*) FROM notifications WHERE account_id = '{buyer}' AND event_code = 'MTR_APPEAL_DECIDED' AND created_at >= '{T0}') || '|' || (SELECT count(*) FROM notifications WHERE account_id = '{seller}' AND event_code = 'REPORT_RESOLVED' AND created_at >= '{T0}')")
        ok('② 운영 결정 — 목록에 신고 목록 · 사유 없으면 400 · 받아들임 → 글 다시 보임 · 신고 수 0 · 신고 기각 · 작성자 · 신고한 사람 알림 · 다시 결정 409',
           row is not None and len(row.get('reports') or []) >= 1 and bad.get('_err') == 400 and dec.get('ok') is True and dec.get('restored') == 'PUBLISHED' and dec.get('dismissedReports', 0) >= 1
           and st.startswith('PUBLISHED|0|DISMISSED') and nt.split('|')[0] != '0' and nt.split('|')[1] != '0' and again.get('_err') == 409,
           f"{bool(row)} {bad.get('_err')} {dec.get('restored') or dec} {st} {nt} {again.get('_err')}")
        g1 = psql(f"UPDATE mtr_appeals SET state = 'OPEN' WHERE id = {aid}") if aid else '!'
        g2 = psql(f"DELETE FROM mtr_appeals WHERE id = {aid}") if aid else '!'
        ok('② DB — 결정한 이의는 되돌릴 수 없음 · 지울 수 없음(MTR_APPEAL)', 'MTR_APPEAL' in g1 and 'MTR_APPEAL' in g2, f"{g1[-50:]} {g2[-50:]}")
        setting('mtr.appeal', 'off', '1573')
        off = call('POST', '/me/mtr/appeals', {'targetType': 'POST', 'targetId': p2, 'body': '꺼진 때 이의를 냅니다. 열 글자 넘김.'}, TB)
        g2v = call('GET', '/me/mtr/appeals', None, TB)
        it2 = next((x for x in (g2v.get('down') or []) if x.get('targetId') == p2), None)
        ok('② 꺼짐 — 이의 422 MTR_APPEAL_OFF · 목록은 보이되 낼 수 없음',
           off.get('_err') == 422 and off.get('code') == 'MTR_APPEAL_OFF' and g2v.get('on') is False and it2 is not None and it2.get('canAppeal') is False,
           f"{off.get('_err')} {off.get('code')} {g2v.get('on')} {it2 and it2.get('canAppeal')}")
        psql(f"INSERT INTO mtr_appeals (target_type, target_id, author_id, body, target_state, due_at, created_at) VALUES ('POST', '{p2}', '{buyer}', '기한 시험 이의입니다. 열 글자.', 'HIDDEN', now() - interval '1 hour', now() - interval '80 hours')")
        jb = call('POST', '/admin/jobs', {'job': 'mtr_hourly'}, TS)
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'MTR_APPEAL_OVERDUE' AND resolved_at IS NULL")
        ok('② 기한 — 매시간 작업이 기한 넘긴 이의에 운영 알림 MTR_APPEAL_OVERDUE(열린 것 하나)',
           (jb.get('detail') or {}).get('appeal', {}).get('overdue', 0) >= 1 and al not in ('', '0') and not al.startswith('!'), f"{jb.get('detail') or jb} {al}")
    finally:
        setting('mtr.appeal', old_on or 'off', '1573 되돌림')
        psql(CLEAN)
        psql(f"UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험 1573 정리' WHERE alert_code = 'MTR_APPEAL_OVERDUE' AND resolved_at IS NULL AND NOT EXISTS (SELECT 1 FROM mtr_appeals WHERE state = 'OPEN' AND due_at < now())")

    if ADMIN_WEB:
        r = admin_page('/#/mtr-appeals', lambda pg, seen: seen.update(n=pg.locator('[data-mtr-appeals]').count(), s=pg.locator('[data-mtr-appeal-state]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 위험감지 › 이의 제기(상태 단추 3 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('s') == 3 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
