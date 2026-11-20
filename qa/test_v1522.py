"""v10.522 (D278 · docs/660) 파트너 직원 일괄 등록 CSV — email · can_settle 두 칸 · 미리보기 → 확정 · 가입 회원 초대 · 미가입 가입 대기 · 짝 맞춤 · 줄마다 감사 · 초대 메일 처음 꺼짐
  ① (코드) D278 표 · 원문 이메일 CHECK · 줄 지킴 · 설정 · 정규식 같음 · 계정 안 만듦 · 컨트롤러 · 메뉴 · 화면 OAPI-020 · 문서 660
  ② (API · DB) 회원 403 · 칸 더 있음 422 · 미리보기 결과 7종 · 확정(확인 글자 · 초대 · 가입 대기 · 감사 · OFF · 다시 409) · 같은 이메일 가입 → MATCHED · 취소 · DB 막음 · 권한 주소
  ③ (화면) 파트너사 › 직원 일괄 등록
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


# ① 코드
SQL = rd('prisma/migrations/D278_partner_api_bulk_invite_ja_zh/migration.sql')
BK = rd('src/modules/papi/bulk.ts'); PC = rd('src/modules/papi/papi.controller.ts'); MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
W = rd('web/src/app/admin/PartnerOpenApi.tsx')
ok('① D278 — 묶음 · 줄(원문 이메일은 가입 대기 동안만 CHECK) · 줄 지킴(앞으로만 · 지우지 않음) · 설정 3(초대 메일 처음 off) · 정기 작업 pbulk_match',
   all(x in SQL for x in ('CREATE TABLE IF NOT EXISTS public.ptn_bulk_invites', 'CREATE TABLE IF NOT EXISTS public.ptn_bulk_invite_rows', 'ck_pbulk_row_email_kept',
       "email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'", 'trg_pbulk_row_guard', "('pbulk.invite_mail', 'off'", "('pbulk_match', 15,")), '')
ok('① 서버 정규식 = DB CHECK · 받는 칸 email · can_settle 둘뿐 · 계정을 만들지 않음 · 줄마다 감사(PBULK_ROW · PBULK_MATCH) · 기존 직원 초대와 같은 줄',
   "PBULK_EMAIL_RE = /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/" in BK and 'PBULK_COLUMNS' in BK and 'INSERT INTO accounts' not in BK
   and "rowAudit(db, 'PBULK_ROW'" in BK and "rowAudit(db, 'PBULK_MATCH'" in BK and "INSERT INTO business_members (business_id, account_id, member_role, can_settle, invited_by)" in BK, '')
ok('① 컨트롤러 · 메뉴 · 화면', "@Post('pbulk/:id/confirm')" in PC and "['ptn-bulk', '직원 일괄 등록']" in MN and "{tab === 'ptn-bulk' && <PtnBulkInvite />}" in APP
   and 'data-pbulk-preview' in W and 'data-pbulk-confirm' in W, '')
scr = {x['id']: x for x in json.loads(SJ or '{"screens":[]}')['screens']}
ok('① 화면 SB-ADM-OAPI-020 — API 7', len(scr.get('SB-ADM-OAPI-020', {}).get('apis', [])) == 7, '')
D660 = doc('660_')
ok('① 문서 660 — 처리방침 고칠 곳 · 법무 확인 · 개인정보 최소', all(x in D660 for x in ('처리방침 고칠 곳', '법무 확인', '개인정보 최소')), '')
ok('① 판 v10.522 이상', VT >= (10, 522), VER)

if API and DB:
    TAG = 'v1522-' + str(int(time.time()))
    stamp = int(time.time()) % 100000
    made_emails, batches = [], []
    pid = psql("SELECT id FROM partners WHERE status = 'ACTIVE' ORDER BY applied_at LIMIT 1")
    if not re.match(r'^[0-9a-f-]{36}$', pid or ''):
        print('  (활동 중 파트너 없음 — ② 건너뜀)')
    else:
        bid_ = psql(f"SELECT business_id FROM partners WHERE id = '{pid}'")
        owner = psql(f"SELECT lower(a.email::text) FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.id = '{bid_}'")
        old_mail = getset('pbulk.invite_mail')
        try:
            TS, TB = login('admin@x.com'), login('buyer@x.com')
            setting('pbulk.invite_mail', 'off', TAG)
            em_m, aid_m = mk_staff('pb', role=None)
            made_emails.append(em_m)
            em_p = f'pb{stamp}new@example.com'
            made_emails.append(em_p)
            csv = f"email,can_settle\n{em_m},Y\n{em_p},N\n{em_p},N\nnot-an-email,N\n{owner},N\n"
            mb = call('POST', '/admin/pbulk/preview', {'partnerId': pid, 'csv': csv}, TB)
            badc = call('POST', '/admin/pbulk/preview', {'partnerId': pid, 'csv': 'email,name\na@example.com,kim\n'}, TS)
            pv = call('POST', '/admin/pbulk/preview', {'partnerId': pid, 'csv': csv, 'fileName': TAG + '.csv'}, TS)
            if pv.get('id'):
                batches.append(pv['id'])
            c = pv.get('counts') or {}
            kept = psql(f"SELECT count(*) FILTER (WHERE email IS NOT NULL) || '|' || count(*) FROM ptn_bulk_invite_rows WHERE batch_id = {int(pv.get('id') or 0)}")
            ok('② 회원 403 · 칸 더 있으면 422 PBULK_COLUMNS · 미리보기 — 가입 회원 1 · 가입 대기 1 · 중복 1 · 모양 아님 1 · 대표 1 · 원문 이메일은 가입 대기 1줄만 · 응답은 가린 이메일',
               mb.get('_err') == 403 and badc.get('code') == 'PBULK_COLUMNS' and c.get('MEMBER') == 1 and c.get('PENDING') == 1 and c.get('DUPLICATE') == 1
               and c.get('INVALID') == 1 and c.get('SELF') == 1 and kept == '1|5' and not any(em_m == (x.get('email') or '') for x in pv.get('rows') or []),
               f"{mb.get('_err')} {badc.get('code')} {c} {kept}")
            cf_bad = call('POST', f"/admin/pbulk/{pv.get('id')}/confirm", {'confirm': '네'}, TS)
            cf = call('POST', f"/admin/pbulk/{pv.get('id')}/confirm", {'confirm': '등록'}, TS)
            cf2 = call('POST', f"/admin/pbulk/{pv.get('id')}/confirm", {'confirm': '등록'}, TS)
            bm = psql(f"SELECT count(*) FROM business_members WHERE business_id = '{bid_}' AND account_id = '{aid_m}' AND joined_at IS NULL AND removed_at IS NULL AND can_settle")
            aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'PBULK_ROW' AND after_data->>'batch' = '{pv.get('id')}'")
            mst = psql(f"SELECT string_agg(DISTINCT coalesce(mail_state, '-'), ',') FROM ptn_bulk_invite_rows WHERE batch_id = {int(pv.get('id') or 0)} AND state IN ('INVITED', 'PENDING')")
            ok('② 확정 — 확인 글자 틀림 422 · 초대 1 · 가입 대기 1 · 건너뜀 3 · 직원 초대 줄(정산 권한) · 줄마다 감사 5 · 메일 꺼짐 OFF · 다시 409',
               cf_bad.get('code') == 'PBULK_CONFIRM' and cf.get('invited') == 1 and cf.get('pending') == 1 and cf.get('skipped') == 3 and bm == '1' and aud == '5' and mst == 'OFF' and cf2.get('_err') == 409,
               f"{cf_bad.get('code')} {cf.get('invited')} {cf.get('pending')} {cf.get('skipped')} {bm} {aud} {mst} {cf2.get('_err')}")
            h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
            psql(f"INSERT INTO accounts(email, name, password_hash) VALUES ('{em_p}', '시험pb', '{h}') ON CONFLICT DO NOTHING")
            aid_p = psql(f"SELECT id FROM accounts WHERE email = '{em_p}'")
            run = call('POST', '/admin/pbulk/run', None, TS)
            rowp = psql(f"SELECT state || '|' || (email IS NULL) || '|' || coalesce(account_id::text, '-') FROM ptn_bulk_invite_rows WHERE batch_id = {int(pv.get('id') or 0)} AND result = 'PENDING'")
            bm2 = psql(f"SELECT count(*) FROM business_members WHERE business_id = '{bid_}' AND account_id = '{aid_p}' AND removed_at IS NULL")
            ok('② 짝 맞춤 — 같은 이메일로 가입 → MATCHED · 원문 이메일 지움 · 직원 초대 줄', int(run.get('matched') or 0) >= 1 and rowp == f'MATCHED|true|{aid_p}' and bm2 == '1', f"{run} {rowp} {bm2}")
            pv2 = call('POST', '/admin/pbulk/preview', {'partnerId': pid, 'csv': f"email\npb{stamp}x2@example.com\n"}, TS)
            if pv2.get('id'):
                batches.append(pv2['id'])
            cn = call('POST', f"/admin/pbulk/{pv2.get('id')}/cancel", {'reason': '시험 취소 ' + TAG}, TS)
            cst = psql(f"SELECT i.state || '|' || count(r.*) FILTER (WHERE r.email IS NOT NULL) FROM ptn_bulk_invites i JOIN ptn_bulk_invite_rows r ON r.batch_id = i.id WHERE i.id = {int(pv2.get('id') or 0)} GROUP BY i.state")
            dbdel = psql(f"DELETE FROM ptn_bulk_invite_rows WHERE batch_id = {int(pv.get('id') or 0)}")
            dbback = psql(f"UPDATE ptn_bulk_invite_rows SET state = 'PREVIEW' WHERE batch_id = {int(pv.get('id') or 0)} AND result = 'PENDING'")
            rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'ptn-bulk'")
            ok('② 취소 — CANCELED · 원문 이메일 0 · DB 가 지우기 · 되돌리기 막음 · 권한 주소 7', cn.get('ok') and cst == 'CANCELED|0' and 'PBULK' in dbdel and 'PBULK' in dbback and rmap == '7',
               f"{cn.get('ok')} {cst} {dbdel[-30:]} {dbback[-30:]} {rmap}")
        finally:
            if old_mail != '':
                setting('pbulk.invite_mail', old_mail, TAG)
            for b in batches:
                psql(f"SET session_replication_role = replica; DELETE FROM ptn_bulk_invite_rows WHERE batch_id = {int(b)}; DELETE FROM ptn_bulk_invites WHERE id = {int(b)};")
            for e in made_emails:
                psql(f"SET session_replication_role = replica; DELETE FROM business_members WHERE account_id IN (SELECT id FROM accounts WHERE email = '{e}'); DELETE FROM accounts WHERE email = '{e}';")
    if ADMIN_WEB:
        r = admin_page('/#/ptn-bulk', lambda pg, seen: seen.update(n=pg.locator('[data-pbulk]').count(), pv=pg.locator('[data-pbulk-preview]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 파트너사 › 직원 일괄 등록(미리보기 단추 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('pv') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
