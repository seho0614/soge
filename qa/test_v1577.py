"""v10.577 (docs/719) 12차 ① 상품 문의 Q&A 2차 — 대표 11/21 「16개 모두 동시에」
  ① (코드) 문의 넓힘(PENDING · 답 쪽 · 답 상태 · 기한 · 금칙어 · smq.qna off) · 판매자 · 운영 API · 공개 목록 answerBy · 판매자센터 화면 · 사전 · 메뉴 · 화면 목록 · 문서 719
  ② (API · DB) 기한 48 · 꺼짐 422 · 판매자 답 · 알림 · 공개 answerBy · 금칙어 답 대기 · 보이기 · 금칙어 문의 대기 · 가림 · 가린 문의 · 답 409 · 기한 못 바꿈 · 403 · 권한 주소 · 기한 넘김 정기 작업
  ③ (화면) 소개몰 › 상품 문의 답 관리
  (두 번 돌아도 통과 — 시험 판매자 「시험1577 …」 · 상품 T1577-… · 문의 · 알림 · 금칙어는 시작 · 끝에 replica 로 지움 · 설정 되돌림)
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
QN, CT, RS, RC, PNL, PG, BOX, UI, MN, AP, KJ_, EJ_ = (rd('src/modules/smq/qna.ts'), rd('src/modules/smq/smq.controller.ts'), rd('src/modules/health/health-review.service.ts'),
    rd('src/modules/health/health-review.controller.ts'), rd('site/src/components/health/ReviewPanels.tsx'), rd('site/src/app/health/seller/center/qna/page.tsx'),
    rd('site/src/components/smq/SellerQnaBox.tsx'), rd('web/src/app/admin/Smq.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
    rd('site/src/i18n/messages/ko/smx.json'), rd('site/src/i18n/messages/en/smx.json'))
try:
    KJ, EJ = json.loads(KJ_ or '{}'), json.loads(EJ_ or '{}')
except Exception:
    KJ, EJ = {}, {}
kq, eq = ((KJ.get('smq') or {}).get('qna') or {}), ((EJ.get('smq') or {}).get('qna') or {})
ok('① 코드 — 문의 넓힘(PENDING · 답 쪽 · 답 상태 · 기한 박음 · 금칙어 fn_check_banned_words HLT · 스위치 smq.qna off · 기한 48) · 판매자 · 운영 API · 공개 목록 answerBy · 판매자센터 화면 · 사전 ko · en 같음 · 메뉴 smq-qna · 화면 SMQ-010 · HLT SMQ-010 · 정기 작업 · 문서 719 · 판',
   'trg_smq_qna_guard' in M and "fn_check_banned_words(NEW.answer, 'HLT')" in M and "fn_check_banned_words(NEW.body, 'HLT')" in M and "CHECK (state IN ('VISIBLE', 'PENDING', 'HIDDEN'))" in M
   and "('smq.qna', 'off'" in M and "('smq.qna_due_hours', '48'" in M and "('smq_daily', 1440, 9, 20" in M
   and 'export async function sellerQnaAnswer' in QN and 'export async function smqQnaDueJob' in QN and "@Controller('api/v1/me/health/seller')" in CT and "@Get('qna')" in CT
   and 'AS "answerBy"' in RS and "q.answer_state <> 'VISIBLE'" in RS and 'answerBy?: string | null' in RC and 'x.answerBy ?? tc(' in PNL
   and 'SellerQnaBox' in PG and '/api/v1/me/health/seller/qna/' in BOX and 'export function SmqQna' in UI
   and len(kq) >= 20 and sorted(kq.keys()) == sorted(eq.keys()) and len((KJ.get('rp') or {})) == 20
   and "['smq-qna', '상품 문의 답 관리']" in MN and "{tab === 'smq-qna' && <SmqQna />}" in AP and '"SB-ADM-SMQ-010"' in SJ and '"SB-HLT-SMQ-010"' in SJ
   and '비밀글' in doc('719_') and VT >= (10, 577), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('smq.qna',)
    s0 = {k: getset(k) for k in keys}
    bw = f'zq{STAMP}금칙'
    PCODE = f'T1577-{STAMP}'
    t0 = psql("SELECT now()")
    CLEAN = (RP + f"DELETE FROM banned_words WHERE word LIKE 'zq%금칙' AND word = '{bw}'; "
             "DELETE FROM hlt_qna WHERE product_id IN (SELECT id FROM hlt_products WHERE code LIKE 'T1577-%'); "
             "DELETE FROM hlt_products WHERE code LIKE 'T1577-%'; DELETE FROM hlt_sellers WHERE name LIKE '시험1577%';")
    psql(CLEAN)
    aid_s = aid_m = ''
    try:
        em_s, aid_s = mk_staff('1577s', role=None); consent_ok.agree(em_s, PW); TSel = login(em_s)
        em_m, aid_m = mk_staff('1577m', role=None); consent_ok.agree(em_m, PW); TM = login(em_m)
        sid = first(psql(RP + "INSERT INTO hlt_sellers (code, type, name, personal, status, applied_at, reviewed_at, account_id, commission_rate, ship_fee, return_ship_fee, cs_tel, return_addr) "
                     f"VALUES ('TN-T1577-{STAMP}', 'TENANT', '시험1577 입점', true, 'ACTIVE', now(), now(), '{aid_s}', 12, 0, 6000, '02-000-1577', '서울 시험로 1577') RETURNING id"))
        cat = psql("SELECT category_id FROM hlt_products WHERE category_id IS NOT NULL LIMIT 1")
        pid = first(psql(RP + "INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) "
                     f"VALUES ('{PCODE}', '시험 상품 1577', 10000, 5, 'STOPPED', '{sid}', 'APPROVED', {('NULL' if not cat or cat.startswith('!') else repr(cat))}) RETURNING id"))
        setting('smq.qna', 'off', '1577')
        a1 = call('POST', f'/health/products/{PCODE}/qna', {'body': '시험 1577 문의 — 하루에 몇 알 먹나요?', 'isPrivate': False}, TM)
        q1 = a1.get('id') or ''
        due = psql(f"SELECT round(extract(epoch FROM due_at - created_at) / 3600) FROM hlt_qna WHERE id = '{q1}'") if q1 else ''
        off = call('PUT', f'/me/health/seller/qna/{q1}', {'body': '두 알 드세요.'}, TSel) if q1 else {}
        setting('smq.qna', 'on', '1577')
        a2 = call('POST', f'/health/products/{PCODE}/qna', {'body': '시험 1577 비밀 문의 — 배송은 언제 되나요?', 'isPrivate': True}, TM)
        q2 = a2.get('id') or ''
        sl = call('GET', '/me/health/seller/qna', None, TSel)
        seen = {x.get('id'): x for x in (sl.get('items') or [])}
        w1 = call('PUT', f'/me/health/seller/qna/{q1}', {'body': '하루 두 알 드시면 됩니다.'}, TSel) if q1 else {}
        n1 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid_m}' AND event_code = 'HLT_QNA_ANSWERED'")
        pub = call('GET', f'/health/products/{PCODE}/qna', None)
        p1 = next((x for x in (pub.get('items') or []) if x.get('id') == q1), {})
        psql(f"INSERT INTO banned_words (word, match_type, gwan_code, is_active) VALUES ('{bw}', 'CONTAINS', 'HLT', true)")
        w2 = call('PUT', f'/me/health/seller/qna/{q2}', {'body': f'내일 보냅니다 {bw} 고맙습니다'}, TSel) if q2 else {}
        mine = call('GET', f'/health/products/{PCODE}/qna', None, TM)
        p2 = next((x for x in (mine.get('items') or []) if x.get('id') == q2), {})
        pend = call('GET', '/admin/smq/qna?view=pending', None, TS)
        inpend = any(x.get('id') == q2 for x in (pend.get('items') or []))
        show = call('POST', f'/admin/smq/qna/{q2}/decide', {'target': 'ANSWER', 'action': 'SHOW'}, TS) if q2 else {}
        n2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid_m}' AND event_code = 'HLT_QNA_ANSWERED'")
        a3 = call('POST', f'/health/products/{PCODE}/qna', {'body': f'시험 1577 문의 {bw} 입니다', 'isPrivate': False}, TM)
        q3 = a3.get('id') or ''
        pub3 = call('GET', f'/health/products/{PCODE}/qna', None)
        hid0 = call('POST', f'/admin/smq/qna/{q3}/decide', {'target': 'QUESTION', 'action': 'HIDE'}, TS) if q3 else {}
        hid = call('POST', f'/admin/smq/qna/{q3}/decide', {'target': 'QUESTION', 'action': 'HIDE', 'reason': '시험 1577 가림'}, TS) if q3 else {}
        w3 = call('PUT', f'/me/health/seller/qna/{q3}', {'body': '가린 문의에 답'}, TSel) if q3 else {}
        ah = call('POST', f'/admin/smq/qna/{q1}/decide', {'target': 'ANSWER', 'action': 'HIDE', 'reason': '시험 1577 답 가림'}, TS) if q1 else {}
        w4 = call('PUT', f'/me/health/seller/qna/{q1}', {'body': '다시 고칩니다.'}, TSel) if q1 else {}
        dlock = psql(f"UPDATE hlt_qna SET due_at = due_at + interval '1 day' WHERE id = '{q1}'") if q1 else ''
        nsel = call('GET', '/me/health/seller/qna', None, TM)
        m403 = call('GET', '/admin/smq/qna', None, TM)
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'smq-qna'")
        ok('② 상품 문의 — 기한 48시간 박음 · 꺼짐이면 판매자 답 422 · 켜면 판매자 목록(비밀글 포함) · 판매자 답 SELLER · 보임 · 쓴 사람 알림 1 · 공개 줄 answerBy · 금칙어 답 대기(쓴 사람에게도 답 없음) · 운영 대기 목록 · 보이기 → 알림 2 · 금칙어 문의 대기(공개 목록에 없음) · 사유 없는 가림 422 · 가린 문의 답 409 · 가린 답 고치기 409 · 기한 못 바꿈 · 판매자 아님 403 · 회원 운영 403 · 권한 주소 3',
           bool(sid) and bool(pid) and bool(q1) and due == '48' and off.get('code') == 'SMQ_QNA_OFF' and q1 in seen and q2 in seen and (seen.get(q2) or {}).get('isPrivate') is True
           and w1.get('answerKind') == 'SELLER' and w1.get('answerState') == 'VISIBLE' and n1 == '1' and p1.get('answerBy') == '시험1577 입점' and p1.get('answered') is True
           and w2.get('answerState') == 'PENDING' and w2.get('holdWord') == bw and p2.get('answer') is None and inpend and show.get('state') == 'VISIBLE' and n2 == '2'
           and a3.get('state') == 'PENDING' and '운영 확인' in (a3.get('note') or '') and not any(x.get('id') == q3 for x in (pub3.get('items') or []))
           and hid0.get('code') == 'REASON_REQUIRED' and hid.get('state') == 'HIDDEN' and w3.get('code') == 'SMQ_QNA_STATE' and ah.get('state') == 'HIDDEN' and w4.get('code') == 'SMQ_QNA_HIDDEN'
           and '답 기한은 바꿀 수 없습니다' in dlock and nsel.get('code') == 'NOT_SELLER' and m403.get('_err') == 403 and rmap == '3',
           f"{sid} {pid} {q1 or a1} {due} {off.get('code')} · {list(seen)[:3]} · {w1.get('answerKind')} {w1.get('answerState')} {n1} {p1.get('answerBy')} · {w2.get('answerState')} {w2.get('holdWord')} {p2.get('answer')} {inpend} {show.get('state')} {n2} · "
           f"{a3.get('state')} {hid0.get('code')} {hid.get('state')} {w3.get('code')} {ah.get('state')} {w4.get('code')} · {dlock[-40:]} {nsel.get('code')} {m403.get('_err')} {rmap}")

        # 기한 넘김 정기 작업 — 시험 문의 하나를 기한 지난 것으로(replica · 기한 지킴 건너뜀) → 판매자 알림 한 번 · 두 번 돌려도 한 번
        a4 = call('POST', f'/health/products/{PCODE}/qna', {'body': '시험 1577 문의 — 기한 지남 시험입니다.', 'isPrivate': False}, TM)
        q4 = a4.get('id') or ''
        psql(RP + f"UPDATE hlt_qna SET due_at = now() - interval '1 hour' WHERE id = '{q4}'") if q4 else ''
        j1 = call('POST', '/admin/jobs', {'job': 'smq_daily'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'smq_daily'}, TS)
        nd = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid_s}' AND event_code = 'SMQ_QNA_DUE'")
        ov = call('GET', '/admin/smq/qna?view=overdue', None, TS)
        ok('② 기한 넘김 — 정기 작업 smq_daily 두 번 · 판매자 알림 SMQ_QNA_DUE 한 번 · 운영 목록 기한 넘김에 보임',
           j1.get('job') == 'smq_daily' and j2.get('job') == 'smq_daily' and nd == '1' and any(x.get('id') == q4 and x.get('overdue') is True for x in (ov.get('items') or [])),
           f"{j1.get('job') or j1} {nd} {len(ov.get('items') or [])}")
    finally:
        psql(CLEAN)
        for a_ in (aid_m, aid_s):
            if a_:
                psql(RP + f"DELETE FROM notifications WHERE account_id = '{a_}' AND event_code IN ('HLT_QNA_ANSWERED', 'SMQ_QNA_DUE');")
        psql(RP + f"DELETE FROM ops_alerts WHERE alert_code = 'SMQ_QNA_OVERDUE' AND raised_at >= '{t0}';") if t0 and not t0.startswith('!') else None
        for k, x in s0.items():
            setting(k, x or None, '1577 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/smq-qna', lambda pg, seen: seen.update(n=pg.locator('[data-smq-qna]').count(), f=pg.locator('[data-smq-qna-filter]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 상품 문의 답 관리(거르기 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')


n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
