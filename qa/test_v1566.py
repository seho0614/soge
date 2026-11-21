"""v10.566 (docs/708) 권한 정기 점검 자동화 — 분기 「거둘 후보」 · SUPER 한 번에 거두기 · 그대로 두기 · 업무 사용 기록
  ① (코드) 후보 6종 · 그룹 펼침 · 퇴사 알림 풀기 재사용 · 가드 한 줄 · API 4 · 메뉴 · 그리기 · 알림 이름 · SQL · 화면 목록 · 문서 708 · 판
  ② (DB · API) 후보 만들기(두 번 같음) · 종류별 · ADMIN 보기만 · 분기 검사 · 한 번에 거두기 · 두 번 · 그대로 두기 · DB 결정 잠금 · GONE · 업무 사용 기록 · 정기 작업
  ③ (화면) 직원 · 권한 › 거둘 후보
  (두 번 돌아도 통과 — 시험 계정은 실행마다 새로 · 후보 · 사용 기록 · 권한그룹 · 직원 · 이번에 생긴 PRR_REVIEW_OPEN 은 끝에 replica 로 지움 · prr.use_since 되돌림 · 권한 변경 기록(쌓기만)은 남음)
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


def mig_with(word):
    """마이그레이션 번호는 메인이 정하므로 글자로 찾음"""
    d = os.path.join(K, 'prisma', 'migrations')
    for x in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, x, 'migration.sql')
        if os.path.exists(p):
            t = open(p, encoding='utf-8').read()
            if word in t:
                return t
    return ''


RV, RU, RC, PG, MENU, APP, OA, MG = (rd('src/modules/admin/prr-review.ts'), rd('src/modules/admin/prr-use.ts'), rd('src/modules/admin/prr.controller.ts'), rd('src/core/perm.guard.ts'),
                                     rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/OpsAlerts.tsx'), mig_with('CREATE TABLE IF NOT EXISTS public.prr_review_items'))
SCR = rd('web/src/app/admin/PrrStaff.tsx')
ok('① 코드 — 후보 6종 · 그룹 펼침으로 안 쓴 업무 셈 · 퇴사 알림 풀기 재사용 · 업무 사용 기록(가드 한 줄) · API 4 · @ApiOkResponse · 메뉴 · 그리기 · 알림 이름 · SQL(표 · 트리거 · 설정 · 업무 시드 · 주소 4 · 정기 작업) · 화면 목록 · 문서 708 · 판',
   all(k in RV for k in ("'LEFT_STAFF'", "'LOGIN_IDLE'", "'GROUP_IDLE'", "'EXTERNAL_NO_EXPIRY'", "'ROLE_GONE'", "'EXPIRED_LEFTOVER'"))
   and 'fn_perm_group_expand(g.group_key)' in RV and 'resolveLeftAlert(db, acc' in RV and "'ops.role_idle_days'" in RV and 'perm_shadow_log' in RV
   and 'INSERT INTO prr_task_use' in RU and 'prrNoteUse(this.db, principal.accountId' in PG
   and all(k in RC for k in ("@Get('review')", "@Post('review/build')", "@Post('review/revoke')", "@Post('review/keep')")) and RC.count('@ApiOkResponse') >= 13
   and "['perm-review', '거둘 후보']" in MENU and "'SB-ADM-PRR-010'" in MENU and '<PermReview />' in APP and "PRR_REVIEW_OPEN:" in OA and 'export function PermReview' in SCR
   and 'trg_prr_review_item_guard' in MG and "'prr.review_auto', 'on'" in MG and "('perm-review', '거둘 후보', 'acl'" in MG and "('POST', '/admin/staff/review/revoke', 'perm-review', 'EDIT')" in MG
   and "('prr_daily', 1440, 9, 20" in MG
   and '"SB-ADM-PRR-010"' in SJ and '거둘 후보' in doc('708_') and VT >= (10, 566), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    stamp = int(time.time()) % 100000
    EMP = f'시험1566_{stamp}'
    t0 = psql("SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.US')")
    q_had = psql("SELECT count(*) FROM prr_reviews WHERE quarter = date_trunc('quarter', (now() AT TIME ZONE 'Asia/Seoul'))::date")
    since0 = getset('prr.use_since')
    ea, aa = mk_staff(f'1566a{stamp % 97}', 'ADMIN')          # ADMIN 보기만
    er, ar = mk_staff(f'1566r{stamp % 89}', 'REVIEWER')       # 오래 로그인 안 함
    el, al = mk_staff(f'1566l{stamp % 83}', 'REVIEWER')       # 퇴사자
    ex, ax = mk_staff(f'1566x{stamp % 79}', 'PARTNER_MAL')    # 외부 · 기한 없음
    eg, ag = mk_staff(f'1566g{stamp % 73}', None)             # 역할 없는데 권한그룹 남음
    eu, au = mk_staff(f'1566u{stamp % 71}', 'REVIEWER')       # 안 쓴 권한그룹
    ev, av = mk_staff(f'1566v{stamp % 67}', 'REVIEWER')       # 쓴 권한그룹(후보 아님)
    ACC = [aa, ar, al, ax, ag, au, av]
    inlist = "(" + ",".join(f"'{x}'" for x in ACC) + ")"
    try:
        consent_ok.agree(ea, PW)
        TA = login(ea)
        psql(f"UPDATE accounts SET last_login_at = now() - interval '200 days' WHERE id = '{ar}'")
        psql(f"UPDATE accounts SET last_login_at = now() WHERE id IN ('{au}', '{av}')")
        psql(f"INSERT INTO acct_employees (name, joined_on, left_on, monthly_base, account_id) VALUES ('{EMP}', current_date - 400, current_date - 2, 0, '{al}')")
        for a_ in (ag, au, av):
            psql(f"INSERT INTO perm_account_groups (account_id, group_key, granted_at) VALUES ('{a_}', 'R_REVIEWER', now() - interval '200 days') "
                 f"ON CONFLICT (account_id, group_key) DO UPDATE SET granted_at = now() - interval '200 days', expires_at = NULL")
        psql(f"INSERT INTO prr_task_use (account_id, task_key, last_on) SELECT '{av}', x.task_key, current_date FROM fn_perm_group_expand('R_REVIEWER') x LIMIT 1 ON CONFLICT DO NOTHING")
        setting('prr.use_since', '2000-01-01', '1566')
        b1 = call('POST', '/admin/staff/review/build', {}, TS)
        b2 = call('POST', '/admin/staff/review/build', {}, TS)
        v = call('GET', '/admin/staff/review', None, TS)
        mine = [x for x in (v.get('items') or []) if x.get('accountId') in ACC]
        kinds = {(x['accountId'], x['kind'], x['targetKind'], x['target']) for x in mine}
        ok('② 후보 만들기 — 두 번 해도 같음(두 번째 새 후보 0) · 오래 로그인 안 함 · 퇴사자 · 외부 기한 없음 · 역할 없는데 권한 남음 · 안 쓴 권한그룹 · 쓴 그룹은 아님 · 보기만 계정 없음',
           b1.get('ok') is True and b2.get('addedTotal') == 0 and (ar, 'LOGIN_IDLE', 'ROLE', 'REVIEWER') in kinds and (al, 'LEFT_STAFF', 'ROLE', 'REVIEWER') in kinds
           and (ax, 'EXTERNAL_NO_EXPIRY', 'ROLE', 'PARTNER_MAL') in kinds and (ag, 'ROLE_GONE', 'GROUP', 'R_REVIEWER') in kinds and (au, 'GROUP_IDLE', 'GROUP', 'R_REVIEWER') in kinds
           and not any(k[0] == av and k[1] == 'GROUP_IDLE' for k in kinds) and not any(k[0] == aa for k in kinds) and v.get('groupIdleReady') is True,
           f"{b1.get('addedTotal')} {b2.get('addedTotal')} · {sorted((k[1], k[2], k[3]) for k in kinds)}")
        va = call('GET', '/admin/staff/review', None, TA)
        ma = next((x for x in (va.get('items') or []) if x.get('accountId') == ax), {})
        ba = call('POST', '/admin/staff/review/build', {}, TA)
        bq = call('GET', '/admin/staff/review?quarter=2026-13', None, TS)
        bp = call('POST', '/admin/staff/review/build', {'quarter': '2001-Q1'}, TS)
        ok('② 보기 ADMIN(메일 가림 · 거두기 못함) · 만들기 ADMIN 403 · 분기 모양 422 PRR_QUARTER · 지난 분기 만들기 422 PRR_QUARTER_RANGE',
           '*' in str(ma.get('email') or '') and va.get('canRevoke') is False and ba.get('_err') == 403 and bq.get('code') == 'PRR_QUARTER' and bp.get('code') == 'PRR_QUARTER_RANGE',
           f"{ma.get('email')} {va.get('canRevoke')} {ba.get('_err')} {bq.get('code')} {bp.get('code')}")
        idx = {(x['accountId'], x['kind'], x['targetKind'], x['target']): x['id'] for x in mine}
        rids = [idx[(ax, 'EXTERNAL_NO_EXPIRY', 'ROLE', 'PARTNER_MAL')], idx[(ag, 'ROLE_GONE', 'GROUP', 'R_REVIEWER')], idx[(al, 'LEFT_STAFF', 'ROLE', 'REVIEWER')]]
        rv = call('POST', '/admin/staff/review/revoke', {'ids': rids, 'reason': f'시험 1566 거두기 {stamp}'}, TS)
        left = psql(f"SELECT (SELECT count(*) FROM account_roles WHERE account_id IN ('{ax}', '{al}') AND role <> 'MEMBER') || '|' || (SELECT count(*) FROM perm_account_groups WHERE account_id = '{ag}')")
        why = psql(f"SELECT reason FROM role_changes WHERE account_id = '{ax}' AND action = 'REVOKE' ORDER BY id DESC LIMIT 1")
        sts = psql(f"SELECT string_agg(DISTINCT state, ',') FROM prr_review_items WHERE id IN ({','.join(rids)})")
        rv2 = call('POST', '/admin/staff/review/revoke', {'ids': rids[:1], 'reason': '시험 1566 두 번'}, TS)
        rv3 = call('POST', '/admin/staff/review/revoke', {'ids': rids[:1], 'reason': ''}, TS)
        rva = call('POST', '/admin/staff/review/revoke', {'ids': rids[:1], 'reason': '시험 1566 ADMIN'}, TA)
        ok('② 한 번에 거두기 — 3건 됨 · 역할 · 권한그룹 지워짐 · 권한 변경 기록 사유 · REVOKED · 두 번이면 그 줄 PRR_NOT_OPEN(ok false) · 사유 없음 400 · ADMIN 403',
           rv.get('done') == 3 and rv.get('failed') == 0 and left == '0|0' and (why or '').startswith('권한 정기 점검 — 시험 1566') and sts == 'REVOKED'
           and rv2.get('ok') is False and (rv2.get('results') or [{}])[0].get('code') == 'PRR_NOT_OPEN' and rv3.get('_err') == 400 and rva.get('_err') == 403,
           f"{rv.get('done')}/{rv.get('failed')} · {left} · {why} · {sts} · {rv2.get('results')} · {rv3.get('_err')} {rva.get('_err')}")
        kid = idx[(ar, 'LOGIN_IDLE', 'ROLE', 'REVIEWER')]
        kp = call('POST', '/admin/staff/review/keep', {'ids': [kid], 'note': '시험 1566 둠'}, TS)
        kp2 = call('POST', '/admin/staff/review/keep', {'ids': [kid], 'note': '시험 1566 둠 두 번'}, TS)
        still = psql(f"SELECT count(*) FROM account_roles WHERE account_id = '{ar}' AND role = 'REVIEWER'")
        upd = psql(f"BEGIN; UPDATE prr_review_items SET state = 'OPEN' WHERE id = {int(kid)}; COMMIT;")
        ok('② 그대로 두기 — KEPT · 역할 그대로 · 두 번 409 PRR_NOT_OPEN · 결정한 줄은 DB 가 못 바꿈(PRR_ITEM_DECIDED)',
           kp.get('kept') == 1 and kp2.get('code') == 'PRR_NOT_OPEN' and still == '1' and 'PRR_ITEM_DECIDED' in upd, f"{kp} · {kp2.get('code')} · {still} · {upd[-80:]}")
        psql(f"DELETE FROM perm_account_groups WHERE account_id = '{au}'")
        b3 = call('POST', '/admin/staff/review/build', {}, TS)
        gst = psql(f"SELECT state FROM prr_review_items WHERE id = {int(idx[(au, 'GROUP_IDLE', 'GROUP', 'R_REVIEWER')])}")
        ok('② 다시 만들기 — 대상이 없어진 열린 줄은 GONE', (b3.get('gone') or 0) >= 1 and gst == 'GONE', f"{b3.get('gone')} {gst}")
        call('GET', '/admin/staff', None, TA)
        time.sleep(1.5)
        use = psql(f"SELECT count(*) FROM prr_task_use WHERE account_id = '{aa}' AND task_key = 'staff-list' AND last_on = (now() AT TIME ZONE 'Asia/Seoul')::date")
        ok('② 업무 사용 기록 — ADMIN 이 운영자 목록 API 를 부르면 (계정 · staff-list · 오늘) 한 줄 · 정기 작업 prr_daily 등록',
           use == '1' and psql("SELECT count(*) FROM job_schedules WHERE job = 'prr_daily' AND is_active") == '1', use)
    finally:
        setting('prr.use_since', since0 or None, '1566 되돌림')
        for a_ in ACC:
            rm_role(a_, '1566')
        psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
             f"DELETE FROM prr_review_items WHERE account_id IN {inlist}; DELETE FROM prr_task_use WHERE account_id IN {inlist}; "
             f"DELETE FROM perm_account_groups WHERE account_id IN {inlist}; DELETE FROM perm_account_overrides WHERE account_id IN {inlist}; "
             f"DELETE FROM ops_alerts WHERE alert_code IN ('STAFF_LEFT_ROLE') AND detail->>'accountId' IN {inlist}; "
             f"DELETE FROM ops_alerts WHERE alert_code = 'PRR_REVIEW_OPEN' AND raised_at >= '{t0}'::timestamp AT TIME ZONE current_setting('TimeZone'); "
             f"DELETE FROM acct_employees WHERE name = '{EMP}'; COMMIT;")
        if q_had == '0':
            psql("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM prr_reviews p WHERE p.quarter = date_trunc('quarter', (now() AT TIME ZONE 'Asia/Seoul'))::date "
                 "AND NOT EXISTS (SELECT 1 FROM prr_review_items i WHERE i.quarter = p.quarter); COMMIT;")
    ok('끝 — 시험 후보 · 사용 기록 · 권한그룹 · 직원 없음 · 설정 되돌림',
       psql(f"SELECT (SELECT count(*) FROM prr_review_items WHERE account_id IN {inlist}) + (SELECT count(*) FROM prr_task_use WHERE account_id IN {inlist}) "
            f"+ (SELECT count(*) FROM perm_account_groups WHERE account_id IN {inlist}) + (SELECT count(*) FROM acct_employees WHERE name = '{EMP}')") == '0'
       and getset('prr.use_since') == since0, getset('prr.use_since'))
else:
    print('  (API · DB 없음 — ② 건너뜀)')

if ADMIN_WEB:
    def chk(pg, seen):
        pg.wait_for_selector('[data-perm-review]', timeout=30000)
        seen['box'] = pg.locator('[data-perm-review]').count()
        seen['build'] = pg.locator('[data-perm-review-build]').count()
        seen['revoke'] = pg.locator('[data-perm-review-revoke]').count()
    r = admin_page('/#/perm-review', chk)
    if r is None:
        print('  (playwright 없음 — ③ 건너뜀)')
    else:
        seen, perr = r
        ok('③ 화면 — 직원 · 권한 › 거둘 후보 표 · 다시 만들기 · 한 번에 거두기 단추(SUPER) · 화면 오류 없음',
           seen.get('box') == 1 and seen.get('build') == 1 and seen.get('revoke') == 1 and not perr, f'{seen} {perr[:2]}')
else:
    print('  (ADMIN_WEB 없음 — ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
sys.exit(0 if passed == len(RES) else 1)
