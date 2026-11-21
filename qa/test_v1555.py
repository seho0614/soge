"""v10.555 (docs/693) 소개몰 리뷰 판매자 답글 — 대표 11/21 「(57) ③ 리뷰 판매자 답글」
  ① (코드) D287 답글 표 · 고치기 기록 · 지킴 · 금칙어 · smx.review_reply off · 공개 목록 · 판매자 · 운영 API · 상품 상세 · 판매자센터 화면 · 사전 · 메뉴 · 화면 · 문서
  ② (API · DB) 꺼짐 422 · 운영 답글 · 알림 한 번 · 공개 줄 · 고치기 기록 · 기록 못 바꿈 · 금칙어 대기 · 보이기 · 가림 · 가린 답글 409 · 판매자 아님 403 · DB 가 판매자 흉내 막음 · 끄면 안 보임 · 권한 주소(끝에 금칙어 · 주문 · 리뷰 · 답글 · 알림 지움 · 재고 · 설정 되돌림)
  ③ (화면) 소개몰 › 리뷰 답글
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
    """설정 바꾸기(시험만 · 설정 무늬 검사는 그대로 · 빈 값은 NULL — value_pattern 트리거)"""
    v = 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"
    return psql(f"BEGIN; SELECT set_config('app.setting_reason', '시험 {tag}', true); UPDATE site_settings SET value = {v} WHERE key = '{key}'; COMMIT;")


def getset(key):
    return psql(f"SELECT coalesce(value, '') FROM site_settings WHERE key = '{key}'")


def migr(prefix):
    d = os.path.join(K, 'prisma', 'migrations')
    n = next((x for x in sorted(os.listdir(d)) if x.startswith(prefix)), None) if os.path.isdir(d) else None
    return open(os.path.join(d, n, 'migration.sql'), encoding='utf-8').read() if n else ''


def direct_options(n=2):
    """직판 · 판매 중 · 켠 옵션(재고 5 넘음 · 값 1원 이상) — 서로 다른 상품에서 n개 · [(상품 코드, 옵션 번호, 재고, 값)]"""
    rows = psql("SELECT DISTINCT ON (p.id) p.code || '|' || o.id || '|' || o.stock || '|' || o.price FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id AND s.type = 'DIRECT' "
                "JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active AND o.stock > 5 AND o.price > 0 WHERE p.status = 'ON_SALE' ORDER BY p.id, o.sort LIMIT 20")
    out = []
    for line in (rows.splitlines() if rows and not rows.startswith('!') else []):
        c, oid, st, pr = (line.split('|') + ['', '', '', ''])[:4]
        if c and oid:
            out.append((c, oid, int(st), int(pr)))
    return out[:n]


def single_option_product():
    """직판 · 판매 중 · 켠 옵션이 하나뿐인 상품(재고 5 넘음) — 옵션 없이 주문할 수 있는 것 · (코드, 옵션 번호, 재고)"""
    code = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 "
                "AND NOT EXISTS (SELECT 1 FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock <= 5) ORDER BY p.code LIMIT 1")
    opt = psql(f"SELECT o.id || '|' || o.stock FROM hlt_product_options o JOIN hlt_products p ON p.id = o.product_id WHERE p.code = '{code}' AND o.is_active LIMIT 1") if code and not code.startswith('!') else ''
    oid, st = (opt.split('|') + ['', ''])[:2]
    return code, oid, (int(st) if st.isdigit() else None)


def new_member(tag, zipcode='06236'):
    """새 회원(본인인증 · 약관 동의) · 토큰 · 배송지 — 공유 회원(buyer)을 건드리지 않음"""
    import consent_ok
    em, aid = mk_staff(tag, role=None)
    consent_ok.agree(em, PW)
    tok = login(em)
    adr = call('POST', '/me/health/addresses', {'receiver': '시험', 'phone': '010-1234-5678', 'zipcode': zipcode, 'addr1': '서울 강남구 테헤란로 1'}, tok).get('id')
    return em, aid, tok, adr


def drop_order(oid):
    """시험 주문 지우기(replica — 지킴 트리거를 건너뜀) · 묶음 줄 · 품목 · 결제 · 배송 · 리뷰 · 답글"""
    if oid:
        psql(f"SET session_replication_role = replica; "
             f"DELETE FROM hlt_review_reply_edits WHERE reply_id IN (SELECT rp.id FROM hlt_review_replies rp JOIN hlt_reviews rv ON rv.id = rp.review_id WHERE rv.order_id = '{oid}'); "
             f"DELETE FROM hlt_review_replies WHERE review_id IN (SELECT id FROM hlt_reviews WHERE order_id = '{oid}'); DELETE FROM hlt_reviews WHERE order_id = '{oid}'; "
             f"DELETE FROM hlt_payments WHERE order_id = '{oid}'; DELETE FROM hlt_shipments WHERE order_id = '{oid}'; DELETE FROM hlt_order_items WHERE order_id = '{oid}'; "
             f"DELETE FROM hlt_order_bundles WHERE order_id = '{oid}'; DELETE FROM hlt_orders WHERE id = '{oid}';")


M87 = migr('D287_')
stamp = int(time.time()) % 1000000
RP, RS, RC, CT, UI, MN, AP, PNL, PG, SKO, SEN = (rd('src/modules/smx/replies.ts'), rd('src/modules/health/health-review.service.ts'), rd('src/modules/health/health-review.controller.ts'),
                                                rd('src/modules/smx/smx.controller.ts'), rd('web/src/app/admin/Smx.tsx'), rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'),
                                                rd('site/src/components/health/ReviewPanels.tsx'), rd('site/src/app/health/seller/center/reviews/page.tsx'),
                                                rd('site/src/i18n/messages/ko/smx.json'), rd('site/src/i18n/messages/en/smx.json'))
try:
    KJ, EJ = json.loads(SKO or '{}'), json.loads(SEN or '{}')
except Exception:
    KJ, EJ = {}, {}

ok('① 코드 — D287 답글 표(리뷰 고유 · 쓴 쪽 SELLER · STAFF) · 고치기 기록(쌓기만) · 지킴(입점 = 그 판매자 · 직판 = 운영 · 보이는 리뷰만 · 못 바꿈 · 가린 답글) · 금칙어(fn_check_banned_words HLT) · smx.review_reply off · 공개 목록에 붙임 · 판매자 · 운영 API · 상품 상세 줄 · 판매자센터 화면 · 사전 ko · en 같음 · 메뉴 smx-replies · 화면 SMX-030 · HLT SMX-010 · 문서 693 · 판 v10.555',
   'CREATE TABLE IF NOT EXISTS public.hlt_review_replies' in M87 and 'review_id      uuid NOT NULL UNIQUE' in M87 and 'CREATE TABLE IF NOT EXISTS public.hlt_review_reply_edits' in M87
   and 'trg_smx_reply_guard' in M87 and 'trg_smx_reply_edit_log' in M87 and 'trg_smx_reply_edits_lock' in M87 and "fn_check_banned_words(NEW.body, 'HLT')" in M87
   and "('smx.review_reply', 'off'" in M87 and 'export async function smxAttachReplies' in RP and 'await smxAttachReplies(this.db, items);' in RS and 'reply?: SmxReplyViewDto | null;' in RC
   and "@Controller('api/v1/me/health/seller/review-replies')" in CT and 'export function SmxReplies' in UI and '<SmxReplyLine' in PNL and 'SellerReplyBox' in PG
   and sorted((KJ.get('rp') or {}).keys()) == sorted((EJ.get('rp') or {}).keys()) and len(KJ.get('rp') or {}) == 20
   and "['smx-replies', '리뷰 답글']" in MN and "{tab === 'smx-replies' && <SmxReplies />}" in AP and '"SB-ADM-SMX-030"' in SJ and '"SB-HLT-SMX-010"' in SJ
   and '처리방침' in doc('693_') and VT >= (10, 555), VER)

if API and DB:
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    keys = ('mall.order_open', 'smx.review_reply', 'mall.points', 'mall.review_points', 'mall.tiers')
    s0 = {k: getset(k) for k in keys}
    code, opt, st0 = single_option_product()
    oid, aid, bw = '', '', f'zq{stamp}금칙'
    try:
        em, aid, TM, adr = new_member('1555')
        setting('mall.order_open', 'on', '1555'); setting('smx.review_reply', 'off', '1555'); setting('mall.review_points', 'off', '1555')
        o = call('POST', '/health/orders', {'addressId': adr, 'items': [{'productCode': code, 'qty': 1}]}, TM)
        no = o.get('orderNo') or ''
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{no}'") if no else ''
        psql(f"UPDATE hlt_orders SET status = 'DELIVERED', paid_at = coalesce(paid_at, now()), shipped_at = coalesce(shipped_at, now()), delivered_at = now() WHERE id = '{oid}'") if oid else ''
        psql(f"UPDATE hlt_orders SET status = 'CONFIRMED', confirmed_by = 'BUYER' WHERE id = '{oid}'") if oid else ''
        rv = call('POST', '/me/health/reviews', {'orderNo': no, 'productCode': code, 'rating': 5, 'body': '시험 1555 리뷰 — 잘 받았습니다. 포장이 꼼꼼했어요.'}, TM)
        rid = rv.get('id') or ''
        off = call('PUT', f'/admin/smx/review-replies/{rid}', {'body': '고맙습니다.'}, TS) if rid else {}
        setting('smx.review_reply', 'on', '1555')
        open_ = call('GET', '/admin/smx/review-replies?view=open', None, TS)
        listed = any(x.get('reviewId') == rid for x in (open_.get('items') or []))
        w1 = call('PUT', f'/admin/smx/review-replies/{rid}', {'body': '소중한 리뷰 고맙습니다. 다음에도 꼼꼼히 챙기겠습니다.'}, TS) if rid else {}
        rpid = w1.get('id') or ''
        ntf = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_REVIEW_REPLY'") if aid else ''
        pub = call('GET', f'/health/products/{code}/reviews', None)
        item = next((x for x in (pub.get('items') or []) if x.get('id') == rid), {})
        w2 = call('PUT', f'/admin/smx/review-replies/{rid}', {'body': '소중한 리뷰 고맙습니다. 다음 주문도 꼼꼼히 챙기겠습니다.'}, TS) if rid else {}
        eds = call('GET', f'/admin/smx/review-replies/{rpid}/edits', None, TS) if rpid else {}
        elock = psql(f"UPDATE hlt_review_reply_edits SET new_body = 'x' WHERE reply_id = '{rpid}'") if rpid else ''
        psql(f"INSERT INTO banned_words (word, match_type, gwan_code, is_active) VALUES ('{bw}', 'CONTAINS', 'HLT', true)")
        w3 = call('PUT', f'/admin/smx/review-replies/{rid}', {'body': f'고맙습니다 {bw} 다음에도'}, TS) if rid else {}
        pub3 = call('GET', f'/health/products/{code}/reviews', None)
        item3 = next((x for x in (pub3.get('items') or []) if x.get('id') == rid), {})
        show = call('POST', f'/admin/smx/review-replies/{rpid}/decide', {'action': 'SHOW'}, TS) if rpid else {}
        hide0 = call('POST', f'/admin/smx/review-replies/{rpid}/decide', {'action': 'HIDE'}, TS) if rpid else {}
        hide = call('POST', f'/admin/smx/review-replies/{rpid}/decide', {'action': 'HIDE', 'reason': '시험 1555 가림'}, TS) if rpid else {}
        w4 = call('PUT', f'/admin/smx/review-replies/{rid}', {'body': '다시 고칩니다.'}, TS) if rid else {}
        ntf2 = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{aid}' AND event_code = 'HLT_REVIEW_REPLY'") if aid else ''
        seller403 = call('GET', '/me/health/seller/review-replies', None, TM)
        sput = call('PUT', f'/me/health/seller/review-replies/{rid}', {'body': '판매자 아님'}, TM) if rid else {}
        dbseller = psql(f"SET session_replication_role = origin; INSERT INTO hlt_review_replies (review_id, author_kind, author_id, body) VALUES ('{rid}', 'SELLER', '{aid}', '판매자 흉내')") if rid else ''
        m403 = call('GET', '/admin/smx/review-replies', None, TM)
        setting('smx.review_reply', 'off', '1555')
        pub4 = call('GET', f'/health/products/{code}/reviews', None)
        item4 = next((x for x in (pub4.get('items') or []) if x.get('id') == rid), {})
        rmap = psql("SELECT count(*) FROM perm_route_map WHERE pattern <> '/admin/help/tab' AND task_key = 'smx-replies'")
        ok('② 리뷰 답글 — 꺼짐이면 422 · 켜면 답글 없는 직판 리뷰 목록 · 운영 답글 보임 · 알림 한 번 · 공개 줄 reply(STAFF) · 고치기 → 기록 1 · 기록 못 바꿈 · 금칙어면 대기(공개 줄 null) · 보이기 · 사유 없는 가림 422 · 가림 · 가린 답글 못 고침 409 · 알림 그대로 1 · 판매자 아님 403 · DB 가 직판 리뷰 판매자 답글 막음 · 회원 403 · 끄면 공개 줄에 답글 칸 없음 · 권한 주소 4',
           bool(code) and bool(rid) and off.get('code') == 'SMX_REPLY_OFF' and listed and w1.get('state') == 'VISIBLE' and w1.get('created') is True and ntf == '1'
           and (item.get('reply') or {}).get('kind') == 'STAFF' and w2.get('editCount') == 1 and len(eds.get('items') or []) == 1 and '!' in elock
           and w3.get('state') == 'PENDING' and w3.get('holdWord') == bw and item3.get('reply') is None and show.get('state') == 'VISIBLE'
           and hide0.get('code') == 'REASON_REQUIRED' and hide.get('state') == 'HIDDEN' and w4.get('code') == 'SMX_REPLY_HIDDEN' and ntf2 == '1'
           and seller403.get('code') == 'NOT_SELLER' and sput.get('_err') == 403 and '!' in dbseller and m403.get('_err') == 403 and 'reply' not in item4 and rmap == '4',
           f"{code} {rid or rv} {off.get('code')} {listed} {w1.get('state')} {w1.get('created')} {ntf} · {item.get('reply')} {w2.get('editCount')} {len(eds.get('items') or [])} {elock[-40:]} · "
           f"{w3.get('state')} {w3.get('holdWord')} {item3.get('reply')} {show.get('state')} {hide0.get('code')} {hide.get('state')} {w4.get('code')} {ntf2} · {seller403.get('code')} {sput.get('_err')} {dbseller[-40:]} {m403.get('_err')} {'reply' in item4} {rmap}")
    finally:
        psql(f"SET session_replication_role = replica; DELETE FROM banned_words WHERE word = '{bw}';")
        drop_order(oid)
        if aid:
            psql(f"SET session_replication_role = replica; DELETE FROM notifications WHERE account_id = '{aid}' AND event_code IN ('HLT_REVIEW_REPLY', 'HLT_REVIEW_HIDDEN');")
        if opt and st0 is not None:
            psql(f"SET session_replication_role = replica; UPDATE hlt_product_options SET stock = {int(st0)} WHERE id = '{opt}';")
        for k, x in s0.items():
            setting(k, x or None, '1555 되돌림')
    if ADMIN_WEB:
        r = admin_page('/#/smx-replies', lambda pg, seen: seen.update(n=pg.locator('[data-smx-replies]').count(), f=pg.locator('[data-smx-reply-filter]').count()))
        if r is not None:
            seen, perr = r
            ok('③ 화면 — 소개몰 › 리뷰 답글(거르기 · 목록 · 화면 오류 없음)', seen.get('n') == 1 and seen.get('f') == 1 and not perr, f"{seen} {perr[:2]}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

n_ok = sum(1 for r in RES if r[0])
print(f"\n결과: {n_ok} / {len(RES)}")
sys.exit(0 if n_ok == len(RES) else 1)
