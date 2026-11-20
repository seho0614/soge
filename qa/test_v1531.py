"""v10.531 (D280 · docs/669) ㊿ 고객센터 · 회원 ④ 중복 계정 합치기
  ① (코드) 막는 까닭 19 · 본인인증 NICE(점검판 MOCK)만 · stub-ci 제외 · SUPER · 다른 사람 승인 · 옮김(매물 · 요청 · 문의 · 관심 · 포인트 옮김 줄) · 거래 · 정산은 안 옮김 · 되돌릴 수 없음 트리거 · 문서
  ② (DB · API) 미리 확인(IDENTITY · stub · STAFF_ROLE · 통과) · 꺼짐 422 · 요청 · 열린 요청 422 · 운영 관리자 승인 403 · 확인 글자 422 · 승인 → 합침 · 409 · 결과 · 되돌릴 수 없음 · 자기 요청 승인 422 · 취소 — 시험 계정 자료 지움(replica)
  ③ (화면) 회원 › 계정 합치기
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


M80 = migr('D280_')
MG, CT = rd('src/modules/csx/merge.ts'), rd('src/modules/csx/csx.controller.ts')
stamp = int(time.time()) % 1000000

BLOCK = ('SAME', 'SOURCE_STATUS', 'TARGET_STATUS', 'IDENTITY', 'ALREADY_MERGED', 'OPEN_REQUEST', 'STAFF_ROLE', 'SOURCE_BUSINESS', 'DEAL_OPEN', 'DISPUTE_OPEN',
         'SETTLE_OPEN', 'CASHOUT_OPEN', 'SUBSCRIPTION', 'MALL_SELLER', 'MALL_ORDER_OPEN', 'MALL_POINTS', 'IN_REVIEW', 'POSTING_SUSPENDED', 'POINT_NEGATIVE')
ok(f'① 막는 까닭 {len(BLOCK)}가지 · 본인인증은 NICE(점검판 MOCK)만 · 시험용 stub-ci 제외 · 운영 서버 MOCK 막음',
   all(f"'code', '{b}'" in M80 for b in BLOCK) and "v.adapter IN ('NICE', 'MOCK') AND v.ci_hash IS NOT NULL AND v.ci_hash <> 'stub-ci'" in M80
   and "c.identity?.adapter === 'MOCK'" in MG and "'IDENTITY_MOCK'" in MG, '')
ok('① 실행 — SUPER · 요청한 사람이 아닌 사람 · 스위치 · 다시 확인 · 매물 · 요청 · 문의 · 관심 옮김 · 포인트는 옮김 줄(기록 안 고침) · 옛 계정 SUSPENDED · 되돌릴 수 없음(트리거 셋)',
   "RAISE EXCEPTION 'CSX_MERGE_SUPER:" in M80 and "RAISE EXCEPTION 'CSX_MERGE_SELF:" in M80 and "RAISE EXCEPTION 'CSX_MERGE_OFF:" in M80
   and 'UPDATE listings SET owner_account_id = m.target_id' in M80 and 'UPDATE requests SET owner_account_id = m.target_id' in M80
   and 'UPDATE inquiries SET account_id = m.target_id' in M80 and "'CSX_MERGE_OUT', -v_cash, true" in M80 and "UPDATE accounts SET status = 'SUSPENDED'" in M80
   and 'CREATE TRIGGER trg_csx_merged_source_guard' in M80 and 'CREATE TRIGGER trg_csx_merge_point_guard' in M80 and 'CREATE TRIGGER trg_csx_merge_row_guard' in M80
   and 'UPDATE deals' not in M80 and 'UPDATE settlements' not in M80 and 'UPDATE point_ledger' not in M80, '')
ok('① 서버 · 화면 — 확인 글자 「합치기」 · 승인 · 반려 SUPER · 실패하면 FAILED · 메뉴 · 화면 ID · 문서 669 · 판 v10.531',
   "MERGE_CONFIRM = '합치기'" in MG and "@Post('admin/csx/merges/:id/approve')\n  @HttpCode(200)\n  @Roles('SUPER')" in CT and "state = 'FAILED'" in MG
   and "['csx-merge', '계정 합치기']" in rd('web/src/lib/adminMenu.ts') and '"SB-ADM-CSX-040"' in SJ and doc('669_') and VT >= (10, 531), VER)


def mk_member(tag, ci):
    em = f"t1531{tag}{stamp}@x.com"
    h = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{em}', '시험1531{tag}', '{h}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{em}'")
    if ci:
        psql(f"INSERT INTO identity_verifications (account_id, provider, result, ci_hash, completed_at, adapter) VALUES ('{aid}', 'PASS', 'SUCCESS', '{ci}', now(), 'MOCK')")
    return em, aid


if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    sw0 = getset('csx.account_merge')
    ci1, ci2 = f't1531ci{stamp}a', f't1531ci{stamp}b'
    eA, A = mk_member('a', ci1)
    eB, B = mk_member('b', ci1)
    eC, Cc = mk_member('c', ci2)
    eD, D = mk_member('d', ci1)
    eS, Sx = mk_member('s', 'stub-ci')
    eX, X = mk_staff('1531', 'ADMIN')
    psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 1531', true); INSERT INTO account_roles (account_id, role) VALUES ('{D}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
    ids = [x for x in (A, B, Cc, D, Sx, X) if x]
    lid = psql("SELECT id FROM listings WHERE status = 'PUBLISHED' ORDER BY published_at DESC NULLS LAST LIMIT 1")
    try:
        iq = psql(f"INSERT INTO inquiries (account_id, category, title, body) VALUES ('{A}', (SELECT code FROM code_labels WHERE domain = 'inquiry.category' ORDER BY sort_order LIMIT 1), '시험 1531 문의', '시험 1531 본문') RETURNING id").split('\n')[0]
        if lid:
            psql(f"INSERT INTO favorites (account_id, target_type, target_id) VALUES ('{A}', 'LISTING', '{lid}') ON CONFLICT DO NOTHING")
        psql(f"INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo) VALUES ('{A}', 'PROFILE_COMPLETE', 700, false, '시험 1531')")
        pB0 = int(psql(f"SELECT coalesce(sum(points), 0) FROM point_ledger WHERE account_id = '{B}'") or 0)
        c_bad = call('POST', '/admin/csx/merges/check', {'sourceId': A, 'targetId': Cc}, TS)
        c_stub = call('POST', '/admin/csx/merges/check', {'sourceId': A, 'targetId': Sx}, TS)
        c_staff = call('POST', '/admin/csx/merges/check', {'sourceId': A, 'targetId': D}, TS)
        c_ok = call('POST', '/admin/csx/merges/check', {'sourceId': A, 'targetId': B}, TS)
        codes = lambda c: [b.get('code') for b in c.get('blockers') or []]
        ok('② 미리 확인 — 본인인증 다르면 IDENTITY · 시험용 stub-ci 는 일치 아님 · 운영 역할이면 STAFF_ROLE · 같은 사람이면 막는 것 없음 · 옮길 것(문의 1 · 포인트 700)',
           'IDENTITY' in codes(c_bad) and 'IDENTITY' in codes(c_stub) and 'STAFF_ROLE' in codes(c_staff) and c_ok.get('ok') is True and not codes(c_ok)
           and (c_ok.get('moves') or {}).get('inquiries') == 1 and (c_ok.get('moves') or {}).get('pointsNonCash') == 700 and (c_ok.get('identity') or {}).get('match') is True,
           f"{codes(c_bad)} {codes(c_stub)} {codes(c_staff)} {c_ok.get('blockers')} {c_ok.get('moves')}")
        setting('csx.account_merge', 'off', '1531')
        consent_ok.agree(eX, PW)
        TX = login(eX)
        r_off = call('POST', '/admin/csx/merges', {'sourceId': A, 'targetId': B, 'reason': '시험 1531 꺼짐'}, TX)
        setting('csx.account_merge', 'on', '1531')
        rq = call('POST', '/admin/csx/merges', {'sourceId': A, 'targetId': B, 'reason': '시험 1531 회원 요청'}, TX)
        rq2 = call('POST', '/admin/csx/merges', {'sourceId': A, 'targetId': B, 'reason': '시험 1531 두 번째'}, TX)
        mid = rq.get('id')
        ap_admin = call('POST', f'/admin/csx/merges/{mid}/approve', {'confirm': '합치기'}, TX)
        ap_word = call('POST', f'/admin/csx/merges/{mid}/approve', {'confirm': '네'}, TS)
        ap = call('POST', f'/admin/csx/merges/{mid}/approve', {'confirm': '합치기', 'note': '시험 1531'}, TS)
        ap2 = call('POST', f'/admin/csx/merges/{mid}/approve', {'confirm': '합치기'}, TS)
        ok('② 꺼짐 422 CSX_MERGE_OFF · 요청(운영 관리자) · 열린 요청 있으면 422(OPEN_REQUEST) · 운영 관리자 승인 403 · 확인 글자 틀리면 422 · SUPER 승인 → 합침 · 다시 409',
           r_off.get('code') == 'CSX_MERGE_OFF' and isinstance(mid, int) and rq2.get('code') == 'CSX_MERGE_BLOCKED' and ap_admin.get('_err') == 403
           and ap_word.get('code') == 'CSX_MERGE_CONFIRM' and ap.get('ok') is True and ap2.get('code') == 'CSX_MERGE_STATE',
           f"{r_off.get('code')} {rq} {rq2.get('code')} {ap_admin.get('_err')} {ap_word.get('code')} {ap} {ap2.get('code')}")
        st = psql(f"SELECT a.status || '|' || (SELECT account_id FROM inquiries WHERE id = '{iq}') || '|' || coalesce((SELECT sum(points) FROM point_ledger WHERE account_id = a.id), 0) "
                  f"|| '|' || coalesce((SELECT sum(points) FROM point_ledger WHERE account_id = '{B}'), 0) || '|' || (SELECT state FROM csx_account_merges WHERE id = {int(mid or 0)}) "
                  f"|| '|' || (SELECT count(*) FROM csx_account_merge_items WHERE merge_id = {int(mid or 0)}) FROM accounts a WHERE a.id = '{A}'")
        exp_items = 2 + (1 if lid else 0)   # 문의 1 · 포인트 1 · 관심 1
        back = psql(f"UPDATE accounts SET status = 'ACTIVE' WHERE id = '{A}'")
        edit = psql(f"UPDATE csx_account_merges SET reason = '고침' WHERE id = {int(mid or 0)}")
        pt = psql(f"INSERT INTO point_ledger (account_id, rule_code, points, redeemable, memo) VALUES ('{B}', 'CSX_MERGE_IN', 1, false, '시험 1531 밖에서')")
        ok('② 결과 — 옛 계정 SUSPENDED · 문의는 남길 계정으로 · 포인트 옛 0 · 남길 +700 · DONE · 옮긴 항목 기록',
           st == f"SUSPENDED|{B}|0|{pB0 + 700}|DONE|{exp_items}", f'{st} (기대 항목 {exp_items})')
        ok('② 되돌릴 수 없음 — 옛 계정 ACTIVE 못 됨 · 끝난 요청 고치기 막음 · 합치기 밖 포인트 옮김 줄 막음',
           'CSX_MERGED_SOURCE' in back and 'CSX_IMMUTABLE' in edit and 'CSX_MERGE_POINT' in pt, f"{back[-50:]} {edit[-50:]} {pt[-50:]}")
        # SUPER 가 요청한 것은 자기가 승인 못 함 → 취소
        eA2, A2 = mk_member('e', f't1531ci{stamp}c')
        eB2, B2 = mk_member('f', f't1531ci{stamp}c')
        ids += [x for x in (A2, B2) if x]
        rq3 = call('POST', '/admin/csx/merges', {'sourceId': A2, 'targetId': B2, 'reason': '시험 1531 SUPER 요청'}, TS)
        self_ = call('POST', f"/admin/csx/merges/{rq3.get('id')}/approve", {'confirm': '합치기'}, TS)
        cc = call('POST', f"/admin/csx/merges/{rq3.get('id')}/cancel", None, TS)
        lst = call('GET', '/admin/csx/merges', None, TS)
        row = next((r for r in lst.get('rows') or [] if str(r.get('id')) == str(mid)), {})
        ok('② 요청한 SUPER 는 자기 요청 승인 못 함(422 CSX_MERGE_SELF) · 취소 · 목록은 가린 메일',
           self_.get('code') == 'CSX_MERGE_SELF' and cc.get('ok') is True and row.get('state') == 'DONE' and eA not in json.dumps(row, ensure_ascii=False)
           and '***@' in (row.get('source') or ''), f"{self_.get('code')} {cc} {row.get('source')}")
    finally:
        setting('csx.account_merge', sw0 or 'off', '1531 되돌림')
        if ids:
            inl = ','.join(f"'{x}'" for x in ids)
            psql(f"BEGIN; SET LOCAL session_replication_role = replica; "
                 f"DELETE FROM csx_account_merge_items WHERE merge_id IN (SELECT id FROM csx_account_merges WHERE source_id IN ({inl}) OR target_id IN ({inl})); "
                 f"DELETE FROM csx_account_merges WHERE source_id IN ({inl}) OR target_id IN ({inl}); "
                 f"DELETE FROM point_ledger WHERE account_id IN ({inl}); DELETE FROM favorites WHERE account_id IN ({inl}); "
                 f"DELETE FROM inquiries WHERE account_id IN ({inl}); DELETE FROM identity_verifications WHERE account_id IN ({inl}); "
                 f"DELETE FROM notification_deliveries WHERE notification_id IN (SELECT id FROM notifications WHERE account_id IN ({inl}) AND event_code = 'CSX_ACCOUNT_MERGED'); "
                 f"DELETE FROM notifications WHERE account_id IN ({inl}) AND event_code = 'CSX_ACCOUNT_MERGED'; COMMIT;")
        for x in (D, X):
            if x:
                rm_role(x, '1531')
    if ADMIN_WEB:
        r = admin_page('/#/csx-merge', lambda pg, seen: seen.update(n=pg.locator('[data-csx-merges]').count(), w=pg.locator('[data-csx-merge-warn]').count(), f=pg.locator('[data-csx-merge-form]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 회원 › 계정 합치기(되돌릴 수 없음 안내 · 요청 상자 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('w') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
