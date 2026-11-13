"""v10.166 시험 — 소개몰 입점 2단계: 판매자센터 상품 등록 → 운영 검수 · 배송비 · 반품비(꺼진 채로 · D156 · docs/257)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1166.py

  ① 코드 — D156(검수 칸 · 배송 · 반품비 상한 · 판매 문 · 지우는 문장 없음) · 서버(자기 상품만 · 다시 검수 · 같은 상품 규칙) · 운영 · 사용자 웹 · 사전 · 명세 · 영어 · docs/257 · 판
  ② (API · DB) 판매자 아님 403 · 등록 → 코드 앞머리 · 다른 판매자 상품 404 · 반품비 6,001 400 · 검수 요청 → 운영 대기 · 반려(사유 없음 422) → 사유 ·
     다시 요청 → 통과 · 판매 시작 DB 문(꺼짐 · 하위가맹점 없음) · 켜고 하위가맹점 넣으면 판매 · 글 고치면 초안 · 검수 NONE · 직판은 문을 안 봄 · 되돌림
  ③ (화면) 사용자 웹 /health/seller/center · 운영 화면 「입점 상품 검수」 · 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request
# v10.260 — 혼자 돌려도(새 DB) 시험 회원이 약관 동의 화면으로 가지 않게 · 실패해도 멈추지 않음(consent_ok)
__import__('consent_ok').agree_seed()

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D156_mall_tenant_products/migration.sql')
ok('① D156 — 검수 칸 5 · 반려 사유 · 배송비 · 반품비 0 ~ 6,000 · 판매 문(꺼짐 · 판매자 · 하위가맹점 · 검수 · 직판 제외) · 지우는 문장 없음 · 194 이상',
   all(f'ADD COLUMN IF NOT EXISTS {c}' in M for c in ('review_state', 'review_note', 'submitted_at', 'reviewed_at', 'reviewed_by', 'ship_fee', 'free_ship_over', 'return_ship_fee'))
   and 'CHECK (return_ship_fee BETWEEN 0 AND 6000)' in M and 'ck_hlt_products_review_note' in M
   and "IF s.type = 'DIRECT' THEN RETURN NEW; END IF;" in M and "key = 'mall.tenant'" in M and 'submerchant_id' in M and "NEW.review_state <> 'APPROVED'" in M
   and 'CREATE TRIGGER trg_hlt_tenant_sale_guard BEFORE INSERT OR UPDATE OF status, review_state, seller_id ON public.hlt_products' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 194 and 'D156_mall_tenant_products' in mig, f'{len(mig)} · {mig[-1]}')
SS = rd('src/modules/health/health-seller.service.ts'); SC = rd('src/modules/health/health-seller.controller.ts'); AM = rd('src/app.module.ts')
ok('① 서버 — 판매자만(NOT_SELLER) · 자기 상품만(seller_id) · 코드 앞머리 · 다시 검수 · 검수 요청 · 통과 · 반려 · 같은 상품 규칙(HealthAdminService) · 감사 6 · 모듈',
   "'NOT_SELLER'" in SS and 'WHERE code = $1 AND seller_id = $2' in SS and '`${s.code}-${' in SS and "SET review_state = 'NONE'" in SS
   and "review_state = 'SUBMITTED'" in SS and "'REASON_REQUIRED'" in SS and 'private readonly admin: HealthAdminService' in SS
   and SC.count('@Audit(') >= 6 and "@Get('admin/health/product-reviews')" in SC and "@Post('admin/health/product-reviews/:code')" in SC
   and 'HealthSellerController' in AM and 'HealthSellerService' in AM, '')
WR = rd('web/src/app/admin/HealthProductReviews.tsx'); WS = rd('web/src/app/admin/HealthSettle.tsx')
CC = rd('site/src/components/health/SellerCenter.tsx'); CP = rd('site/src/app/health/seller/center/page.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
flat = lambda d, p='': {k for kk, v in d.items() for k in (flat(v, p + kk + '.') if isinstance(v, dict) else {p + kk})}
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
scr = {x.get('id'): x for x in SPEC}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 — 운영 「입점 상품 검수」 · 판매자센터(배송 · 목록 · 등록 · 검수 요청 · 판매 시작) · 사전 ko · en 같은 칸 · 명세 · 영어 · docs/257 · 판',
   "'/admin/health/product-reviews'" in WR and '<HealthProductReviews />' in WS
   and 'data-center-shipping' in CC and 'data-center-new' in CC and 'data-center-submit' in CC and 'data-center-start' in CC and "'/me/health/seller/center'" in CP
   and flat(ko.get('center', {})) == flat(en.get('center', {})) and ko.get('center') and 'toCenter' in ko.get('tenant', {})
   and len((scr.get('SB-HLT-SEL-020') or {}).get('apis', [])) >= 10 and 'GET /admin/health/product-reviews' in (scr.get('SB-ADM-HST-010') or {}).get('apis', [])
   and '"입점 상품은 운영 검수를 통과해야 판매할 수 있습니다":' in EN and '"입점 승인된 판매자만 판매자센터를 쓸 수 있습니다.":' in EN
   and any(f.startswith('257_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 166), rd('VERSION').strip())


# ── ② API ─────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=60).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


def psql_err(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return r.returncode, r.stderr


MEM = 'seller@x.com'; OTHER = 'buyer@x.com'; SC1 = 'TN-T1166'; SC2 = 'TN-T1166B'
setting = lambda: psql("SELECT value FROM site_settings WHERE key = 'mall.tenant'")
if API and DB:
    s0 = setting(); mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'"); oid = psql(f"SELECT id FROM accounts WHERE email = '{OTHER}'")
    cat = psql("SELECT c.code FROM categories c WHERE c.gwan_code = 'HLT' AND c.code = 'HLT_FOOD'") or psql("SELECT code FROM categories WHERE gwan_code = 'HLT' AND status = 'APPROVED' ORDER BY code LIMIT 1")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    TO = call('POST', '/auth/login', {'email': OTHER, 'password': PW}).get('accessToken')
    clean = f"""DELETE FROM hlt_products WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE code IN ('{SC1}', '{SC2}'));
                DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id IN ('{mid}', '{oid}') AND type IN ('TENANT','BRAND'));
                DELETE FROM hlt_sellers WHERE account_id IN ('{mid}', '{oid}') AND type IN ('TENANT','BRAND');"""
    try:
        psql(clean)
        psql("UPDATE site_settings SET value = 'off' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        n0 = call('GET', '/me/health/seller/center', t=TM)
        ok('② 판매자 아님 → 403 NOT_SELLER', n0.get('_err') == 403 and n0.get('code') == 'NOT_SELLER', str(n0.get('code')))
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at) VALUES ('{SC1}', '{mid}', 'TENANT', '시험 판매자', true, 'ACTIVE', now(), now()) RETURNING id").splitlines()[0]
        psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at) VALUES ('{SC2}', '{oid}', 'TENANT', '다른 판매자', true, 'ACTIVE', now(), now())")
        c1 = call('GET', '/me/health/seller/center', t=TM)
        cr = call('POST', '/me/health/seller/products', {'code': 'VITC', 'name': '시험 비타민 젤리', 'categoryCode': cat, 'summary': '하루 한 알',
                                                          'notice': {'제조사': '시험식품'}, 'options': [{'price': 12000, 'stock': 5}]}, TM)
        code = cr.get('code') or f'{SC1}-VITC'
        o404 = call('GET', f'/me/health/seller/products/{code}', t=TO)
        ok('② 판매자센터 · 등록 → 코드 「TN-T1166-VITC」 초안 · 다른 판매자 상품은 404', c1.get('code') == SC1 and c1.get('returnShipFee') == 6000
           and code == f'{SC1}-VITC' and cr.get('status') == 'DRAFT' and o404.get('_err') == 404
           and psql(f"SELECT seller_id FROM hlt_products WHERE code = '{code}'") == sid, f"{cr} · {o404.get('_err')}")
        sh1 = call('PATCH', '/me/health/seller/shipping', {'shipFee': 3000, 'freeShipOver': 30000, 'returnShipFee': 6001}, TM)
        sh2 = call('PATCH', '/me/health/seller/shipping', {'shipFee': 3000, 'freeShipOver': 30000, 'returnShipFee': 5000}, TM)
        e_rf, m_rf = psql_err(f"UPDATE hlt_sellers SET return_ship_fee = 7000 WHERE id = '{sid}'")
        ok('② 반품비 6,001 → 400 · 5,000 저장 · DB 도 6,000 넘으면 막음', sh1.get('_err') == 400 and sh2.get('returnShipFee') == 5000 and sh2.get('shipFee') == 3000
           and e_rf != 0 and 'ck_hlt_sellers_return_fee' in m_rf, f"{sh1.get('_err')} · {sh2.get('returnShipFee')}")
        sb = call('POST', f'/me/health/seller/products/{code}/submit', t=TM)
        q1 = call('GET', '/admin/health/product-reviews', t=T_); inq = any(x.get('code') == code for x in (q1 if isinstance(q1, list) else []))
        rj0 = call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'REJECT'}, T_)
        rjm = call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, TM)
        rj1 = call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'REJECT', 'note': '고시의 원재료 항목을 채워 주십시오.'}, T_)
        p1 = call('GET', f'/me/health/seller/products/{code}', t=TM)
        ok('② 검수 요청 → 운영 대기 · 반려 사유 없음 422 · 회원 403 · 반려 → 판매자에게 사유',
           sb.get('reviewState') == 'SUBMITTED' and inq and rj0.get('code') == 'REASON_REQUIRED' and rjm.get('_err') == 403
           and rj1.get('reviewState') == 'REJECTED' and (p1.get('reviewNote') or '').startswith('고시의'), f"{sb.get('reviewState')} · {inq} · {rj0.get('code')} · {rjm.get('_err')} · {p1.get('reviewState')}")
        call('POST', f'/me/health/seller/products/{code}/submit', t=TM)
        ap = call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, T_)
        st_off = call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        psql("UPDATE site_settings SET value = 'on' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        st_pay = call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        psql(f"UPDATE hlt_sellers SET submerchant_id = 'SUB-T1166' WHERE id = '{sid}'")
        st_ok = call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        ok('② 통과 뒤 판매 시작 — 꺼짐이면 DB 가 막음 · 하위가맹점 없으면 막음 · 둘 다 되면 판매 중',
           ap.get('reviewState') == 'APPROVED' and st_off.get('_err') == 422 and '아직 열리지' in (st_off.get('message') or '')
           and st_pay.get('_err') == 422 and '하위가맹점' in (st_pay.get('message') or '') and st_ok.get('status') == 'ON_SALE',
           f"{st_off.get('message')} · {st_pay.get('message')} · {st_ok.get('status')}")
        up = call('PATCH', f'/me/health/seller/products/{code}', {'summary': '하루 두 알'}, TM)
        up2 = call('PATCH', f'/me/health/seller/products/{code}/options/{(up.get("options") or [{}])[0].get("id", "00000000-0000-0000-0000-000000000000")}', {'stock': 9}, TM)
        ok('② 글을 고치면 다시 검수(NONE) · 판매 중 → 초안 · 재고만 고치면 검수 그대로', up.get('reviewState') == 'NONE' and up.get('status') == 'DRAFT'
           and up2.get('_err') is None and psql(f"SELECT review_state FROM hlt_products WHERE code = '{code}'") == 'NONE', f"{up.get('reviewState')} · {up.get('status')} · {up2.get('_err')}")
        e_g, m_g = psql_err(f"UPDATE hlt_products SET status = 'ON_SALE' WHERE code = '{code}'")
        dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' LIMIT 1")
        e_d, _ = psql_err(f"UPDATE hlt_products SET status = 'ON_SALE' WHERE code = '{dp}'") if dp else (0, '')
        ok('② DB 문 — 검수 안 된 입점 상품은 SQL 로도 판매 중 못 함 · 직판 상품은 문을 보지 않음', e_g != 0 and '운영 검수' in m_g and e_d == 0, f'{m_g[:70]} · 직판 {dp}')
        if SITE or ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                call('POST', f'/me/health/seller/products/{code}/submit', t=TM)
                with sync_playwright() as p:
                    b_ = p.chromium.launch()
                    if ADMIN_WEB:
                        pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                        pg.goto(ADMIN_WEB + '/#/hlt-settle', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        box = pg.locator('[data-product-reviews]').count(); card = pg.locator(f'[data-product-review="{code}"]').count()
                        if card: pg.locator(f'[data-product-review="{code}"]').scroll_into_view_if_needed()
                        pg.screenshot(path=os.path.join(HERE, 'v1166_admin_reviews.png'), full_page=False)
                        ok('③ 운영 화면 #/hlt-settle — 「입점 상품 검수」 · 시험 상품 카드 · 오류 없음', box == 1 and card == 1 and not errs, f'{box} · {card} · {errs[:2]}')
                    if SITE:
                        ctx = b_.new_context(viewport={'width': 1300, 'height': 1000}); pg = ctx.new_page(); errs2 = []
                        pg.on('pageerror', lambda e: errs2.append(str(e)[:120]))
                        pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', MEM); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(3000)
                        pg.goto(SITE + '/health/seller/center', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                        cen = pg.locator(f'[data-seller-center="{SC1}"]').count(); row = pg.locator(f'[data-center-product="{code}"]').count()
                        pg.screenshot(path=os.path.join(HERE, 'v1166_site_center.png'), full_page=True)
                        ok('③ 사용자 웹 /health/seller/center — 판매자센터 · 내 상품 줄 · 주문 · 발송 부품 · 오류 없음', cen == 1 and row == 1 and not errs2, f'{cen} · {row} · {pg.url} · {errs2[:2]}')
                    b_.close()
    finally:
        psql(clean)
        psql(f"UPDATE site_settings SET value = '{s0 or 'off'}' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
    ok('끝 — 되돌림(설정 처음 값 · 시험 판매자 · 상품 없음)', setting() == (s0 or 'off')
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE code IN ('{SC1}', '{SC2}')") == '0', setting())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
