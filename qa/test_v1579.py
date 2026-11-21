"""v10.579 (docs/721) 12차 ③ 판매자 평가 · 패널티 — 대표 11/21 「16개 모두 동시에」
  ① (코드) 평가 · 노출 제한 표 · 상태 지킴 · 노출 보기 · 달 셈 · 기준 무늬 = 서버 무늬 · 스위치 off · 목록 · 고민별 · 순위 NOT EXISTS · 기준 SUPER 만 · 메뉴 · 화면 · 문서 721(INV-11)
  ② (API · DB) 2001-01 · 02 시험 주문으로 셈 · 등급 D · C · 잇달아 경고 LIMIT · 이번 달 저장 422 · 기준 SUPER · 무늬 · 노출 제한 승인 · 실제 적용 꺼짐 · 켬(목록에서 빠짐 · 상세 그대로) · 풀기 · 409 · 404 · 403 · 권한 주소
  ③ (화면) 소개몰 › 판매자 평가 · 패널티
  (두 번 돌아도 통과 — 판매자 「시험1579 …」 · 주문 T1579-… · 2001-01 · 02 평가 줄 · 노출 제한은 시작 · 끝에 replica 로 지움 · 설정 되돌림)
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


def migr_has(marker):
    """마이그레이션 번호를 메인이 정하므로(D292 ~) 글자로 찾음 — 그 글자가 든 migration.sql"""
    d = os.path.join(K, 'prisma', 'migrations')
    for n in (sorted(os.listdir(d)) if os.path.isdir(d) else []):
        p = os.path.join(d, n, 'migration.sql')
        if os.path.exists(p):
            s = open(p, encoding='utf-8').read()
            if marker in s:
                return s
    return ''


def first(x):
    return (x or '').splitlines()[0] if x and not x.startswith('!') else ''


SJ = rd('spec/screens.json')
M = migr_has('CREATE TABLE IF NOT EXISTS public.smq_seller_grades')
STAMP = int(time.time()) % 1000000
RP = 'SET session_replication_role = replica; '

"""시험 몸통"""
GR, CM, CT, CAT, RS, ADM, UI, MN, AP, PG = (rd('src/modules/smq/grades.ts'), rd('src/modules/smq/common.ts'), rd('src/modules/smq/smq.controller.ts'),
    rd('src/modules/health/health-catalog.service.ts'), rd('src/modules/health/health-review.service.ts'), rd('src/modules/admin/admin.service.ts'),
    rd('web/src/app/admin/Smq.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('site/src/app/health/seller/center/grade/page.tsx'))
pats = re.findall(r"\('(smq\.(?:penalty_[a-z_]+|qna_due_hours))', '[0-9]+', 'ADMIN', '[^']*', false, '([^']+)'", M)
same = bool(pats) and all(f"'{k}':" in CM and f"/{p}/" in CM for k, p in pats)
ok('① 코드 — 평가 표 · 노출 제한 표(상태 지킴) · 노출 보기 v_smq_exposure_limited(smq.penalty_exposure) · 달 셈 함수 · 기준 무늬 = 서버 무늬(규칙 2) · 스위치 셋 off · 목록 · 고민별 · 순위 NOT EXISTS · 기준 SUPER 만 · 판정 한 곳 · 메뉴 · 화면 · 판매자센터 · 문서 721(INV-11) · 판',
   'CREATE TABLE IF NOT EXISTS public.smq_seller_grades' in M and 'CREATE TABLE IF NOT EXISTS public.smq_seller_limits' in M and 'trg_smq_limit_guard' in M
   and 'CREATE OR REPLACE VIEW public.v_smq_exposure_limited' in M and 'fn_smq_grade_calc' in M and same and len(pats) == 8
   and "('smq.penalty', 'off'" in M and "('smq.penalty_exposure', 'off'" in M
   and CAT.count('v_smq_exposure_limited') == 2 and 'v_smq_exposure_limited' in RS and "key.startsWith('smq.penalty')" in ADM
   and 'export function smqJudge' in GR and "@Roles('SUPER')" in CT and 'export function SmqGrades' in UI and "{tab === 'smq-grades' && <SmqGrades />}" in AP
   and "['smq-grades', '판매자 평가 · 패널티']" in MN and '"SB-ADM-SMQ-020"' in SJ and '"SB-HLT-SMQ-020"' in SJ and '/me/health/seller/grade' in PG
   and 'INV-11' in doc('721_') and VT >= (10, 579), f"{VER} {len(pats)} {same}")

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('smq.penalty', 'smq.penalty_exposure', 'smq.penalty_late_pct')
    s0 = {k: getset(k) for k in keys}
    YM1, YM2 = '2001-01', '2001-02'   # 아주 먼 지난 달 — 다른 시험 · 정기 작업과 겹치지 않음 · 끝에 이 두 달 줄을 모두 지움
    ON = "SELECT id FROM hlt_orders WHERE order_no LIKE 'T1579-%'"
    CLEAN = (RP + f"DELETE FROM smq_seller_limits WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE name LIKE '시험1579%'); "
             f"DELETE FROM smq_seller_grades WHERE ym IN ('{YM1}', '{YM2}') OR seller_id IN (SELECT id FROM hlt_sellers WHERE name LIKE '시험1579%'); "
             f"DELETE FROM hlt_returns WHERE order_id IN ({ON}); DELETE FROM hlt_orders WHERE order_no LIKE 'T1579-%'; "
             "DELETE FROM hlt_products WHERE code LIKE 'T1579-%'; DELETE FROM hlt_sellers WHERE name LIKE '시험1579%';")
    psql(CLEAN)
    aid = ''
    try:
        em, aid = mk_staff('1579s', role=None); consent_ok.agree(em, PW); TSel = login(em)
        ema, aida = mk_staff('1579a', role='ADMIN'); consent_ok.agree(ema, PW); TA = login(ema)
        bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")
        sid = first(psql(RP + "INSERT INTO hlt_sellers (code, type, name, personal, status, applied_at, reviewed_at, account_id, commission_rate, ship_fee, return_ship_fee) "
                     f"VALUES ('TN-T1579-{STAMP}', 'TENANT', '시험1579 입점', true, 'ACTIVE', now(), now(), '{aid}', 12, 0, 6000) RETURNING id"))
        cat = first(psql("SELECT c.id || '|' || c.code FROM categories c JOIN hlt_products p ON p.category_id = c.id GROUP BY c.id, c.code ORDER BY count(*) DESC LIMIT 1"))
        cid, ccode = (cat.split('|') + ['', ''])[:2]
        PCODE = f'T1579-{STAMP}'
        pid = first(psql(RP + "INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) "
                     f"VALUES ('{PCODE}', '시험 상품 1579', 10000, 5, 'ON_SALE', '{sid}', 'APPROVED', {repr(cid) if cid else 'NULL'}) RETURNING id"))

        def orders(ym, n, late, defect):
            """그달 결제 주문 n 건 — 앞 late 건은 발송 5일 뒤(기한 3일 넘음) · 그 밖 1일 뒤 · 앞 defect 건은 불량 반품 신청"""
            for k in range(n):
                ship = 5 if k < late else 1
                o = first(psql(RP + "INSERT INTO hlt_orders (order_no, account_id, goods_amount, ship_fee, total, status, pay_method, paid_at, shipped_at, delivered_at, created_at, seller_id) "
                               f"VALUES ('T1579-{STAMP}-{ym}-{k}', '{bid}', 10000, 0, 10000, 'DELIVERED', 'CARD', '{ym}-10 10:00+09', '{ym}-10 10:00+09'::timestamptz + interval '{ship} days', "
                               f"'{ym}-10 10:00+09'::timestamptz + interval '{ship + 1} days', '{ym}-10 09:00+09', '{sid}') RETURNING id"))
                if k < defect and o:
                    psql(RP + f"INSERT INTO hlt_returns (order_id, kind, reason, state) VALUES ('{o}', 'RETURN', 'DEFECT', 'REQUESTED')")
        orders(YM1, 12, 3, 1)    # 지연 25% · 판매자 사정 8.3% → 둘 다 넘음 → D · 경고
        orders(YM2, 12, 3, 0)    # 지연 25% → C · 잇달아 경고 → 노출 제한 제안(LIMIT)
        calc = psql(f"SELECT orders || '|' || late_ship || '|' || seller_cancels || '|' || qna_total FROM fn_smq_grade_calc('{YM1}', 3) WHERE seller_id = '{sid}'")
        bad = psql("SELECT count(*) FROM fn_smq_grade_calc('2001-13', 3)")
        r1 = call('POST', '/admin/smq/grades/recalc', {'ym': YM1}, TS)
        r2 = call('POST', '/admin/smq/grades/recalc', {'ym': YM2}, TS)
        g1 = call('GET', f'/admin/smq/grades?ym={YM1}', None, TS)
        g2 = call('GET', f'/admin/smq/grades?ym={YM2}', None, TS)
        i1 = next((x for x in (g1.get('items') or []) if x.get('sellerId') == sid), {})
        i2 = next((x for x in (g2.get('items') or []) if x.get('sellerId') == sid), {})
        kst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
        cur = call('POST', '/admin/smq/grades/recalc', {'ym': kst.strftime('%Y-%m')}, TS)
        prev = call('GET', '/admin/smq/grades', None, TS)
        ok('② 평가 — 달 셈(주문 12 · 지연 3 · 판매자 사정 1 · 문의 0) · 잘못된 달 막음 · 다시 셈 저장 · 1월 D · 경고(지연 · 취소 넘음) · 2월 C · 잇달아 경고라 노출 제한 제안 · 이번 달 저장 422 · 비우면 지난달(미리보기 또는 저장)',
           bool(sid) and bool(pid) and calc == '12|3|1|0' and 'SMQ_GRADE' in bad and (r1.get('saved') or 0) >= 1 and (r2.get('saved') or 0) >= 1
           and i1.get('grade') == 'D' and i1.get('level') == 'WARN' and sorted(i1.get('over') or []) == ['cancel', 'late'] and i1.get('latePct') == 25.0
           and i2.get('grade') == 'C' and i2.get('level') == 'LIMIT' and cur.get('code') == 'SMQ_YM_OPEN' and isinstance(prev.get('items'), list) and prev.get('ym') < kst.strftime('%Y-%m'),
           f"{sid} {pid} {calc} {bad[-40:]} {r1.get('saved') or r1} {r2.get('saved') or r2} · {i1.get('grade')} {i1.get('level')} {i1.get('over')} {i1.get('latePct')} · {i2.get('grade')} {i2.get('level')} · {cur.get('code')} {prev.get('ym')}")

        # 기준 — SUPER 만 · 무늬 밖 400 · 고침 · ADMIN 은 전체 설정에서도 막힘
        ru = call('GET', '/admin/smq/rules', None, TS)
        pa = call('PUT', '/admin/smq/rules', {'latePct': '15'}, TA)
        pb = call('PUT', '/admin/smq/rules', {'latePct': '200'}, TS)
        pc = call('PUT', '/admin/smq/rules', {'latePct': '15'}, TS)
        ps_ = call('PATCH', '/admin/site-settings', {'key': 'smq.penalty_late_pct', 'value': '12', 'reason': '시험 1579'}, TA)
        ok('② 기준 — 읽기 · ADMIN 은 고치기 403 · 무늬 밖 400 · SUPER 고침(바뀐 키) · 전체 설정에서도 ADMIN 403',
           (ru.get('rules') or {}).get('latePct') in (10, 15) and pa.get('_err') == 403 and pb.get('_err') == 400 and 'smq.penalty_late_pct' in (pc.get('changed') or [])
           and (pc.get('rules') or {}).get('latePct') == 15 and ps_.get('_err') == 403,
           f"{(ru.get('rules') or {}).get('latePct')} {pa.get('_err')} {pb.get('_err')} {pc.get('changed')} {ps_.get('_err')} {ps_.get('code')}")
        setting('smq.penalty_late_pct', s0.get('smq.penalty_late_pct') or '10', '1579 되돌림')

        # 노출 제한 — 제안(시험이 직접 넣음) → 승인 · 꺼짐이면 목록 그대로 · 켜면 목록에서 빠짐(상세는 그대로) · 풀기 → 다시 보임
        gid = psql(f"SELECT id FROM smq_seller_grades WHERE seller_id = '{sid}' AND ym = '{YM2}'")
        lid = first(psql(f"INSERT INTO smq_seller_limits (seller_id, grade_id, reason) VALUES ('{sid}', {gid or 'NULL'}, '시험 1579 제안') RETURNING id"))
        setting('smq.penalty_exposure', 'off', '1579')
        ap = call('POST', f'/admin/smq/limits/{lid}/decide', {'action': 'APPROVE', 'note': '시험 1579 승인'}, TS) if lid else {}
        ntf = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'SMQ_SELLER_LIMIT'")
        v_off = psql(f"SELECT count(*) FROM v_smq_exposure_limited WHERE seller_id = '{sid}'")
        listed = lambda: any(x.get('code') == PCODE for x in (call('GET', f'/health/products?category={ccode}', None) or []) if isinstance(x, dict)) if ccode else None
        l_off = listed()
        setting('smq.penalty_exposure', 'on', '1579')
        v_on = psql(f"SELECT count(*) FROM v_smq_exposure_limited WHERE seller_id = '{sid}'")
        l_on = listed()
        det = call('GET', f'/health/products/{PCODE}', None)
        sg = call('GET', '/me/health/seller/grade', None, TSel)
        lf0 = call('POST', f'/admin/smq/limits/{lid}/decide', {'action': 'LIFT'}, TS) if lid else {}
        lf = call('POST', f'/admin/smq/limits/{lid}/decide', {'action': 'LIFT', 'note': '시험 1579 풀기'}, TS) if lid else {}
        l_lift = listed()
        again = call('POST', f'/admin/smq/limits/{lid}/decide', {'action': 'APPROVE'}, TS) if lid else {}
        glock = psql(f"UPDATE smq_seller_limits SET state = 'ACTIVE' WHERE id = {lid}") if lid else ''
        nid = call('POST', '/admin/smq/limits/abc/decide', {'action': 'LIFT', 'note': '시험'}, TS)
        m403 = call('GET', '/admin/smq/grades', None, TSel)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'smq-grades'")
        ok('② 노출 제한 — 승인 ACTIVE · 판매자 알림 · 실제 적용 꺼짐이면 보기 0 · 목록에 보임 · 켜면 보기 1 · 목록에서 빠짐 · 상품 상세는 200 · 판매자 평가 화면에 제한 · 사유 없는 풀기 422 · 풀기 · 다시 보임 · 끝난 제한 승인 409 · DB 가 되돌리기 막음 · 숫자 아닌 번호 404 · 판매자 운영 403 · 권한 주소 5',
           bool(lid) and ap.get('state') == 'ACTIVE' and ap.get('inEffect') is False and ntf == '1' and v_off == '0' and l_off is not False and v_on == '1' and l_on is not True
           and det.get('_err') is None and (sg.get('limit') or {}).get('state') == 'ACTIVE' and lf0.get('code') == 'REASON_REQUIRED' and lf.get('state') == 'LIFTED' and l_lift is not False
           and again.get('code') == 'SMQ_LIMIT_STATE' and 'SMQ_LIMIT' in glock and nid.get('_err') == 404 and m403.get('_err') == 403 and rmap == '5',
           f"{lid} {ap.get('state')} {ap.get('inEffect')} {ntf} {v_off} {l_off} {v_on} {l_on} {det.get('_err')} {(sg.get('limit') or {}).get('state')} {lf0.get('code')} {lf.get('state')} {l_lift} {again.get('code')} {glock[-40:]} {nid.get('_err')} {m403.get('_err')} {rmap}")
    finally:
        psql(CLEAN)
        if aid:
            psql(RP + f"DELETE FROM notifications WHERE account_id = '{aid}' AND event_code IN ('SMQ_SELLER_LIMIT', 'SMQ_SELLER_WARN');")
        for k, x in s0.items():
            setting(k, x or None, '1579 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/smq-grades', lambda pg, seen: seen.update(n=pg.locator('[data-smq-grades]').count(), rl=pg.locator('[data-smq-rules]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 판매자 평가 · 패널티(기준 · 표 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('rl') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
