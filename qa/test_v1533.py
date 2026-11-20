"""v10.533 (docs/671) 리뷰 작성 적립 — 대표 11/20 「(51) ② 리뷰 작성 적립」
  ① (코드) D281 리뷰 사진 칸 · 사진 지킴 · 적립금 근거 REVIEW · hlt_review_rewards(주문 고유) · 주기 · 회수 함수 · 리뷰 트리거 3 · 기록 EARN · REVOKE(전표 그대로) · 설정 off · 운영 화면 · 메뉴 · 화면 · 문서
  ② (API · DB) 새 회원 직판 주문 확정 · 꺼짐 0 · 남의 사진 422 · 사진 리뷰 800(글 500 + 사진 300) · 묶음 · 기록 · 한 주문 한 번 · 사진 주소 · 운영 회수 · 409 · 지움 · 다시 써도 0 · 기록 지우기 막음 · 권한 주소(끝에 주문 · 리뷰 · 적립 · 파일 replica 로 지움 · 재고 되돌림 · 설정 되돌림)
  ③ (화면) 소개몰 › 리뷰 적립
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


def first(s):
    return (s or '').splitlines()[0] if s and not s.startswith('!') else ''


def direct_product():
    """직판 · 판매 중 · 켠 옵션 하나(재고 5 넘음) 상품 코드 · 옵션 번호 · 재고"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 "
                "AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= 5) ORDER BY p.code LIMIT 1")
    opt = psql(f"SELECT o.id || '|' || o.stock FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") if code else ''
    return code, (opt.split('|') + ['', ''])[:2]


def new_member(tag):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id')
    return em, aid, tok, adr


def photo_file(owner, tag):
    """올리기를 마친 회원 사진 줄(REQUEST_IMAGE · READY) — 바이트는 없음(사진 주소 응답은 보지 않음)"""
    fid = psql("SELECT gen_random_uuid()")
    psql(f"INSERT INTO files (id, owner_account_id, purpose, original_name, content_type, size_bytes, storage_provider, storage_key, status, completed_at) "
         f"VALUES ('{fid}', '{owner}', 'REQUEST_IMAGE', 'r{tag}.jpg', 'image/jpeg', 1000, 'LOCAL', 'request_image/2026/11/{fid}.jpg', 'READY', now())")
    return fid


M81 = migr('D281_')
stamp = int(time.time()) % 1000000
T0 = psql("SELECT now()::text") if (API and DB) else ''
RP, CT, UI, MN, AP, RS, RC, HB = (rd('src/modules/slx/review-points.ts'), rd('src/modules/slx/slx.controller.ts'), rd('web/src/app/admin/Slx.tsx'),
                                  rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('src/modules/health/health-review.service.ts'),
                                  rd('src/modules/health/health-review.controller.ts'), rd('src/modules/health/health-benefit.ts'))

ok('① 코드 — D281 리뷰 사진 칸 · 사진 지킴(본인 REQUEST_IMAGE) · 적립금 근거 REVIEW(CHECK 넓힘 · 주문마다 하나) · 리뷰 적립 표(주문 고유) · 주기 · 회수 함수 · 리뷰 트리거 3(넣기 · 상태 · 지움) · 기록 EARN · REVOKE 그대로(전표 MALL_POINT_EARN · LAPSE 손대지 않음) · mall.review_points off · 금액 500 · 500 · 최소 20자 · 30일 · 운영 보기 · 회수 · 사진 공개 주소 · 리뷰 쓰기 photoFileId · pointAmount · 메뉴 slx-review-points · 화면 SLX-020 · 문서 671 · 판 v10.533',
   'ALTER TABLE public.hlt_reviews ADD COLUMN IF NOT EXISTS photo_file_id' in M81 and 'trg_hlt_review_photo_guard' in M81
   and "CHECK (source IN ('EARN', 'ADMIN', 'RESTORE', 'REVIEW'))" in M81 and 'ux_hlt_point_lot_review' in M81 and 'CREATE TABLE IF NOT EXISTS public.hlt_review_rewards' in M81
   and 'CONSTRAINT ux_hlt_review_reward_order UNIQUE (order_id)' in M81 and 'FUNCTION public.fn_hlt_review_reward(' in M81 and 'FUNCTION public.fn_hlt_review_reward_revoke(' in M81
   and 'trg_hlt_review_reward_ins' in M81 and 'trg_hlt_review_reward_upd' in M81 and 'trg_hlt_review_reward_del' in M81
   and "VALUES (r.account_id, 'EARN', v_amt" in M81 and "VALUES (w.account_id, 'REVOKE', v_back" in M81 and "name: 'MALL_POINT_EARN'" in HB
   and "('mall.review_points', 'off'" in M81 and "('mall.review_points_text', '500'" in M81 and "('mall.review_points_photo', '500'" in M81
   and "('mall.review_points_min_len', '20'" in M81 and "('mall.review_points_days', '30'" in M81
   and 'export async function reviewPointsView' in RP and 'export async function reviewPhoto' in RP and "@Post('review-points/:id/revoke')" in CT and "@Get(':id/photo')" in CT
   and 'photo_file_id' in RS and 'pointAmount' in RS and 'photoFileId?: string;' in RC and 'export function SlxReviewPoints' in UI
   and "['slx-review-points', '리뷰 적립']" in MN and "{tab === 'slx-review-points' && <SlxReviewPoints />}" in AP and '"SB-ADM-SLX-020"' in SJ
   and '대가성' in doc('671_') and VT >= (10, 533), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'mall.points', 'mall.review_points', 'mall.review_points_text', 'mall.review_points_photo', 'mall.review_points_min_len', 'mall.review_points_days', 'mall.tiers')
    s0 = {k: getset(k) for k in keys}
    no, aid, oid, opt, files = '', '', '', ['', ''], []
    try:
        em, aid, TM, adr = new_member('1533')
        setting('mall.order_open', 'on', '1533'); setting('mall.points', 'off', '1533'); setting('mall.review_points', 'off', '1533'); setting('mall.tiers', 'off', '1533')
        setting('mall.review_points_text', '500', '1533'); setting('mall.review_points_photo', '300', '1533')
        setting('mall.review_points_min_len', '20', '1533'); setting('mall.review_points_days', '30', '1533')
        dp, opt = direct_product()
        o1 = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': dp, 'qty': 1}]}, TM)
        no = o1.get('orderNo') or ''
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no}'") if no else ''
        dlv = psql(f"UPDATE hlt_orders SET status = 'DELIVERED', paid_at = coalesce(paid_at, now()), shipped_at = coalesce(shipped_at, now()), delivered_at = now() WHERE order_no = '{no}'") if no else '!'
        cnf = psql(f"UPDATE hlt_orders SET status = 'CONFIRMED' WHERE order_no = '{no}'") if no else '!'
        body = '시험 1533 리뷰 — 잘 받았고 포장도 깔끔했습니다. 다음에도 살게요.'
        r0 = call('POST', '/me/health/reviews', {'orderNo': no, 'productCode': dp, 'rating': 5, 'body': body}, TM)
        w0 = psql(f"SELECT count(*) FROM hlt_review_rewards WHERE order_id = '{oid}'") if oid else ''
        d0 = call('DELETE', f"/me/health/reviews/{r0.get('id')}", None, TM) if r0.get('id') else {}
        setting('mall.points', 'on', '1533'); setting('mall.review_points', 'on', '1533')
        mine_f = photo_file(aid, '1533'); files.append(mine_f)
        admin_id = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")
        other_f = photo_file(admin_id, '1533o'); files.append(other_f)
        bad = call('POST', '/me/health/reviews', {'orderNo': no, 'productCode': dp, 'rating': 5, 'body': body, 'photoFileId': other_f}, TM)
        r1 = call('POST', '/me/health/reviews', {'orderNo': no, 'productCode': dp, 'rating': 4, 'body': body, 'photoFileId': mine_f}, TM)
        rid = r1.get('id') or ''
        w1 = psql(f"SELECT w.amount || '|' || w.photo || '|' || w.state || '|' || l.source || '|' || l.remaining FROM hlt_review_rewards w JOIN hlt_point_lots l ON l.id = w.lot_id WHERE w.order_id = '{oid}'") if oid else ''
        tx1 = psql(f"SELECT string_agg(kind || ':' || amount || ':' || coalesce(reason, ''), ',' ORDER BY id) FROM hlt_point_txns WHERE account_id = '{aid}'") if aid else ''
        twice = psql(f"SELECT fn_hlt_review_reward('{rid}')") if rid else ''
        pr = call('GET', f'/health/products/{dp}/reviews', None)
        purl = next((x.get('photoUrl') for x in (pr.get('items') or []) if x.get('id') == rid), None)
        uuid_none = psql("SELECT gen_random_uuid()")
        nf = call('GET', f'/health/reviews/{uuid_none}/photo', None)
        v403 = call('GET', '/admin/health/review-points', None, TM)
        av = call('GET', '/admin/health/review-points', None, TS)
        wid = psql(f"SELECT id FROM hlt_review_rewards WHERE order_id = '{oid}'") if oid else ''
        row = next((x for x in (av.get('rows') or []) if x.get('id') == wid), {})
        short = call('POST', f'/admin/health/review-points/{wid}/revoke', {'reason': 'x'}, TS) if wid else {}
        rv = call('POST', f'/admin/health/review-points/{wid}/revoke', {'reason': '시험 1533 회수'}, TS) if wid else {}
        rv2 = call('POST', f'/admin/health/review-points/{wid}/revoke', {'reason': '시험 1533 회수'}, TS) if wid else {}
        w2 = psql(f"SELECT w.state || '|' || w.revoked_amount || '|' || l.closed_reason || '|' || l.remaining FROM hlt_review_rewards w JOIN hlt_point_lots l ON l.id = w.lot_id WHERE w.order_id = '{oid}'") if oid else ''
        bal = psql(f"SELECT fn_hlt_point_balance('{aid}')") if aid else ''
        d1 = call('DELETE', f'/me/health/reviews/{rid}', None, TM) if rid else {}
        r2 = call('POST', '/me/health/reviews', {'orderNo': no, 'productCode': dp, 'rating': 5, 'body': body}, TM)
        w3 = psql(f"SELECT count(*) || '|' || string_agg(state, ',') FROM hlt_review_rewards WHERE order_id = '{oid}'") if oid else ''
        delg = psql(f"DELETE FROM hlt_review_rewards WHERE order_id = '{oid}'") if oid else ''
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE task_key = 'slx-review-points'")
        ok('② 리뷰 적립 — 직판 주문 확정 · 꺼짐이면 적립 없음(0) · 남의 사진 422 · 사진 리뷰 = 글 500 + 사진 300 · 묶음 REVIEW · 기록 EARN 「리뷰 작성 적립」 · 같은 주문 다시 0 · 목록 사진 주소 · 없는 사진 404 · 회원 403 · 운영 기록 · 짧은 사유 400 · 운영 회수 800 · 다시 409 · 묶음 REVOKED · 남은 0 · 지움 · 다시 써도 적립 없음(한 주문 한 번) · 기록 지우기 막음 · 권한 주소 2',
           bool(dp) and bool(no) and '!' not in dlv and '!' not in cnf and r0.get('pointAmount') == 0 and w0 == '0' and d0.get('deleted') is True
           and bad.get('code') == 'HLT_REVIEW_PHOTO' and r1.get('pointAmount') == 800 and w1 == '800|true|GRANTED|REVIEW|800'
           and 'EARN:800:리뷰 작성 적립' in tx1 and twice == '0' and purl == f'/api/v1/health/reviews/{rid}/photo' and nf.get('_err') == 404
           and v403.get('_err') == 403 and row.get('amount') == 800 and row.get('photo') is True and short.get('_err') == 400
           and rv.get('revoked') == 800 and rv2.get('_err') == 409 and rv2.get('code') == 'HLT_REVIEW_POINT_REVOKED' and w2 == 'REVOKED|800|REVOKED|0' and bal == '0'
           and d1.get('deleted') is True and r2.get('pointAmount') == 0 and w3 == '1|REVOKED' and '!' in delg and rmap == '2',
           f"{dp} {no or o1} {dlv[-30:]} {cnf[-30:]} · {r0.get('pointAmount')} {w0} {d0.get('deleted')} · {bad.get('code')} {r1.get('pointAmount') or r1} {w1} · {tx1} {twice} · {purl} {nf.get('_err')} · "
           f"{v403.get('_err')} {row.get('amount')} {row.get('photo')} {short.get('_err')} · {rv.get('revoked') or rv} {rv2.get('code')} {w2} {bal} · {d1.get('deleted')} {r2.get('pointAmount')} {w3} {delg[-30:]} {rmap}")
    finally:
        if oid:
            psql(f"SET session_replication_role = replica; "
                 f"DELETE FROM hlt_review_rewards WHERE order_id = '{oid}'; DELETE FROM hlt_reviews WHERE order_id = '{oid}'; "
                 f"DELETE FROM hlt_point_uses WHERE order_id = '{oid}'; DELETE FROM hlt_point_txns WHERE order_id = '{oid}'; DELETE FROM hlt_point_lots WHERE order_id = '{oid}'; "
                 f"DELETE FROM hlt_payments WHERE order_id = '{oid}'; DELETE FROM hlt_shipments WHERE order_id = '{oid}'; DELETE FROM hlt_order_items WHERE order_id = '{oid}'; DELETE FROM hlt_orders WHERE id = '{oid}';")
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM hlt_point_txns WHERE account_id = '{aid}'; DELETE FROM hlt_point_lots WHERE account_id = '{aid}'; "
                 f"DELETE FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_REVIEW_POINT';")
        for f_ in files:
            psql(f"SET session_replication_role = replica; DELETE FROM files WHERE id = '{f_}';")
        if opt and opt[0] and opt[1]:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(opt[1])} WHERE id = '{opt[0]}';")
        if T0:
            psql(f"SET session_replication_role = replica; DELETE FROM ops_alerts WHERE alert_code IN ('MALL_REVIEW_POINT_SHORT', 'MALL_REVIEW_POINT_FAIL') AND raised_at >= '{T0}'::timestamptz;")
        for k, x in s0.items():
            setting(k, x or None, '1533 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/slx-review-points', lambda pg, seen: seen.update(n=pg.locator('[data-slx-review-points]').count(), f=pg.locator('[data-slx-rp-filter]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 리뷰 적립(요약 · 거르기 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
