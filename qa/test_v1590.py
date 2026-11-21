"""v10.590 (docs/732) ⑥ 운영자 이상 행동 감지 — 15차 보안 · 기반(앞머리 sec2_)
  ① (코드) 표 · 쌓기 트리거 · 하루 셈 함수(감사 · 개인정보 접속기록 · 내려받기 승인 · 로그인 기록 재사용) · 설정 무늬 = 서버 · 정기 작업 sec2_tick · 화면 · 메뉴 · 권한 시드 · 문서 732 · 판
  ② (DB · API) 시험 운영자 열람 120 → 다시 셈 VIEW 한 줄 · 다시 셈해도 한 줄 · 화면 자료 · ADMIN 403 · 본인 줄 422 · 확인 · 두 번 409 · 없는 줄 404 · 지우기 막힘 · 설정 422 · 400 · 403 · 꺼짐이면 정기 작업 OFF
  (두 번 돌아도 통과 — 「시험1590」 열람 기록 · 2000-01-01 줄 · 시험 계정은 시작 · 끝에 replica 로 지움)
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


"""시험 몸통 — 15차 보안 · 기반 공통 도우미"""
def migs_all():
    d = os.path.join(K, 'prisma', 'migrations')
    if not os.path.isdir(d):
        return ''
    return '\n'.join(open(os.path.join(d, x, 'migration.sql'), encoding='utf-8').read() for x in sorted(os.listdir(d)) if os.path.exists(os.path.join(d, x, 'migration.sql')))


MIG = migs_all()
SJ = rd('spec/screens.json')
STAMP = int(time.time()) % 1000000


def sec2_set(tok, body, tag):
    """설정은 API 로(서버 30초 메모리를 그 자리에서 지움)"""
    return call('PUT', '/admin/sec2/settings', {**body, 'reason': f'시험 {tag}'}, tok)


def mk_member(tag):
    em, aid = mk_staff(tag, None)
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 {tag}', true); INSERT INTO account_roles (account_id, role) VALUES ('{aid}', 'MEMBER') ON CONFLICT DO NOTHING; COMMIT;")
    return em, aid


def rm_accounts(like):
    """시험 계정과 딸린 보안 줄을 지움(replica — 쌓기만 표 · 외래 키 트리거를 건너뜀)"""
    ids = f"(SELECT id FROM accounts WHERE email LIKE '{like}')"
    return psql("SET session_replication_role = replica; "
                f"DELETE FROM sec2_login_alerts WHERE account_id IN {ids}; DELETE FROM sec2_mfa_tickets WHERE account_id IN {ids}; "
                f"DELETE FROM sec2_staff_anomalies WHERE account_id IN {ids}; DELETE FROM account_mfa WHERE account_id IN {ids}; "
                f"DELETE FROM login_sessions WHERE account_id IN {ids}; DELETE FROM login_history WHERE account_id IN {ids}; "
                f"DELETE FROM notifications WHERE account_id IN {ids}; DELETE FROM term_agreements WHERE account_id IN {ids}; "
                f"DELETE FROM account_roles WHERE account_id IN {ids}; DELETE FROM accounts WHERE email LIKE '{like}';")


AN, CM, CT, JB = rd('src/modules/sec2/anomaly.ts'), rd('src/modules/sec2/common.ts'), rd('src/modules/sec2/sec2.controller.ts'), rd('src/modules/sec2/jobs.ts')
WK, SC = rd('src/worker/worker.controller.ts'), rd('src/worker/scheduler.service.ts')
AM, AP, W = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/ScxWatch.tsx')
DBP = dict(re.findall(r"\('(sec2\.[a-z_]+)', '[^']*', 'ADMIN', '(?:[^']|'')*', false, '([^']+)'", MIG))
SVP = dict(re.findall(r"'(sec2\.[a-z_]+)': /(.+?)/,", CM))
ok('① 코드 — 표 sec2_staff_anomalies · 쌓기 트리거 · 하루 셈 함수(감사 · 개인정보 접속기록 · 내려받기 승인 · 로그인 기록 재사용) · 알림 STAFF_ANOMALY · 본인 줄 확인 못 함 · 문서 732 · 판 v10.590',
   'CREATE TABLE IF NOT EXISTS public.sec2_staff_anomalies' in MIG and 'trg_sec2_staff_anomalies_guard' in MIG and 'sec2_staff_day_counts' in MIG
   and 'audit.pii_access_logs' in MIG and 'export_requests' in MIG and 'login_history' in MIG and "'STAFF_ANOMALY'" in AN and 'SEC2_SELF_REVIEW' in AN
   and 'sec2.anomaly_watch' in doc('732_') and VT >= (10, 590), VER)
ok('① 설정 무늬 — DB value_pattern = 서버 SEC2_PATTERNS(계약 2) · 열 개 · 스위치 처음 off',
   len(DBP) == 10 and DBP == SVP and "('sec2.anomaly_watch', 'off'" in MIG and "('sec2.pwned_check', 'off'" in MIG and "('sec2.member_mfa', 'off'" in MIG,
   f"{len(DBP)} {sorted(set(DBP.items()) ^ set(SVP.items()))[:3]}")
ok('① 정기 작업 sec2_tick — JOBS · JobName · case · job_schedules 10분 · 07시 뒤 하루 한 번',
   "'sec2_tick'," in WK and "| 'sec2_tick'" in SC and "case 'sec2_tick'" in SC and "('sec2_tick', 10, NULL" in MIG and 't.h < 7' in AN, '')
ok('① 화면 · 메뉴 — 위험감지 › 이상 행동 감지(scx-watch · SUPER 만) · PAGE SB-ADM-SCX-010 · 화면 목록 · 권한 시드',
   "['scx-watch', '이상 행동 감지']" in AM and "'sec-geo', ['scx-watch']" in AM and 'SB-ADM-SCX-010' in AM and "'scx-watch': ['SUPER']" in AP
   and '<ScxWatch />' in AP and 'data-scx-watch' in W and '"SB-ADM-SCX-010"' in SJ and "('scx-watch', '이상 행동 감지', 'admrsk'" in MIG
   and "@Roles('SUPER')" in CT, '')

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    SID = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
    LIKE = 't1590%@x.com'
    rm_accounts(LIKE)
    CLEAN = (f"SET session_replication_role = replica; DELETE FROM audit.pii_access_logs WHERE reason = '시험1590'; "
             f"DELETE FROM sec2_staff_anomalies WHERE day = DATE '2000-01-01'; ")
    psql(CLEAN)
    try:
        se, sid = mk_staff(f'1590v{STAMP % 97}', 'ADMIN')
        ae, aid = mk_staff(f'1590a{STAMP % 97}', 'ADMIN'); consent_ok.agree(ae, PW); TA = login(ae)
        y = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date - 1, 'YYYY-MM-DD')")
        ins = psql(f"INSERT INTO audit.pii_access_logs (actor_account_id, target_type, target_account_id, access_type, reason, occurred_at) "
                   f"SELECT '{sid}', 'ACCOUNT', NULL, 'VIEW', '시험1590', (DATE '{y}' + time '12:00') AT TIME ZONE 'Asia/Seoul' FROM generate_series(1, 120)")
        r1 = call('POST', '/admin/sec2/anomalies/scan', {'day': y}, TS)
        n1 = psql(f"SELECT count(*) || '|' || coalesce(max(n), 0) || '|' || coalesce(max(threshold), 0) FROM sec2_staff_anomalies WHERE account_id = '{sid}' AND day = DATE '{y}' AND kind = 'VIEW'")
        r2 = call('POST', '/admin/sec2/anomalies/scan', {'day': y}, TS)
        n2 = psql(f"SELECT count(*) FROM sec2_staff_anomalies WHERE account_id = '{sid}' AND day = DATE '{y}'")
        ok('② 다시 셈 — 하루 열람 120(기준 100 · 평소 0) → VIEW 한 줄 · 다시 셈해도 한 줄 · 알림 없음 · 셈 기록',
           ('!' not in ins) and r1.get('found', 0) >= 1 and n1.startswith('1|120|') and n2 == '1' and r1.get('alerted') is False
           and psql(f"SELECT count(*) FROM sec2_anomaly_runs WHERE day = DATE '{y}'") == '1', f"{ins[-60:]} {r1} {n1} {r2.get('added')} {n2}")
        xid = psql(f"SELECT id FROM sec2_staff_anomalies WHERE account_id = '{sid}' AND day = DATE '{y}' AND kind = 'VIEW'")
        w = call('GET', '/admin/sec2/watch', None, TS)
        row = next((x for x in (w.get('items') or []) if x.get('id') == xid), {})
        ok('② 화면 자료 — 줄(가린 이메일 · 종류 글 · 확인 안 함) · 설정 · 회원 보안 숫자 · SUPER 만(ADMIN 403)',
           row.get('kindKo') == '개인정보 열람' and '***@' in (row.get('email') or '') and row.get('reviewedAt') is None
           and isinstance(w.get('settings'), dict) and 'pwnedBlock30' in (w.get('member') or {}) and call('GET', '/admin/sec2/watch', None, TA).get('_err') == 403,
           f"{row} {list((w.get('member') or {}).keys())[:3]}")
        own = psql(f"INSERT INTO sec2_staff_anomalies (day, account_id, kind, n, avg30, threshold) VALUES (DATE '2000-01-01', '{SID}', 'NIGHT', 99, 0, 10) RETURNING id")
        rv0 = call('POST', f'/admin/sec2/anomalies/{own}/review', {'note': '시험1590 본인'}, TS)
        rv1 = call('POST', f'/admin/sec2/anomalies/{xid}/review', {'note': '시험1590 확인 — 설명 들음'}, TS)
        rv2 = call('POST', f'/admin/sec2/anomalies/{xid}/review', {'note': '시험1590 두 번'}, TS)
        rv3 = call('POST', '/admin/sec2/anomalies/999999999999/review', {'note': '시험1590 없음'}, TS)
        de = psql(f"DELETE FROM sec2_staff_anomalies WHERE id = {xid}")
        ok('② 확인 — 본인 줄 422 SEC2_SELF_REVIEW · 확인 ok · 두 번 409 · 없는 줄 404 · 지우기는 DB 가 막음(SEC2_ANOMALY_RO) · 감사 SEC2_ANOMALY_REVIEW',
           rv0.get('code') == 'SEC2_SELF_REVIEW' and rv1.get('ok') is True and rv2.get('_err') == 409 and rv3.get('_err') == 404 and 'SEC2_ANOMALY_RO' in de
           and psql(f"SELECT count(*) > 0 FROM audit.audit_logs WHERE action = 'SEC2_ANOMALY_REVIEW' AND target_id = '{sid}'") == 't',
           f"{rv0.get('code')} {rv1} {rv2.get('_err')} {rv3.get('_err')} {de[-50:]}")
        s1 = sec2_set(TS, {}, '1590')
        s2 = call('PUT', '/admin/sec2/settings', {'factor': 11, 'reason': '시험1590'}, TS)
        s3 = sec2_set(TA, {'viewMin': 50}, '1590')
        jb = call('POST', '/admin/jobs', {'job': 'sec2_tick'}, TS)
        off = psql("SELECT value FROM site_settings WHERE key = 'sec2.anomaly_watch'")
        ok('② 설정 · 정기 작업 — 바꿀 값 없음 422 SEC2_NOTHING · 범위 밖 400 · ADMIN 403 · 꺼져 있으면 정기 작업은 셈 안 함(OFF) · 정리 단계',
           s1.get('code') == 'SEC2_NOTHING' and s2.get('_err') == 400 and s3.get('_err') == 403
           and (off != 'off' or ((jb.get('detail') or {}).get('anomaly') or {}).get('skipped') == 'OFF') and 'purge' in (jb.get('detail') or {}),
           f"{s1.get('code')} {s2.get('_err')} {s3.get('_err')} {off} {str(jb)[:160]}")
    finally:
        psql(CLEAN)
        rm_accounts(LIKE)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
