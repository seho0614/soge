"""v10.208 시험 — 소개몰 개봉 반품 재고 · 할인 판매(스위치 처음 꺼짐)(D185 · docs/333)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1208.py

  ① 코드 — D185(대장 · 처리 한 방향 · 지우지 못함 · 입점은 반송 · 판매 상품 복제 · 스위치 처음 off · 꺼짐에 판매 막음 · 끄면 멈춤 · 켜면 멈춘 것만) ·
     반품 승인 openAction · 대장 기록 · API 3(ADMIN · SUPER · 감사) · 스위치 켜기 SUPER · 목록에서 뺌(CARD_FROM) · 상품 상세 안내 · 운영 화면 탭 ·
     반품 승인 보관 / 폐기 · 회원 화면 안내(한 · 영) · DB 오류 → 422 · 영어 사전 · 명세 · 문서 333 · 판
  ② (DB) 223 · D185 · 스위치 off · 대장 지우기 · 거꾸로 옮기기 막음
  ③ (API) 직판 주문 → 배송 완료 → 개봉 반품 승인(보관) → 대장 HOLD · 재고 안 돌아옴 · 틀린 처리 400 ·
         할인 판매(값 · 유통기한 규칙) → 꺼짐이면 멈춤 · 상세 404 · 켜면 판매 중 · 원래 상품 안내 · 목록에 없음 · 끄면 멈춤 ·
         폐기 처리 반품 · 보관 아닌 것 폐기 422 · 회원 403
  ④ (화면) 개봉 반품 재고 탭
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
M = rd('prisma/migrations/D185_hlt_open_stock/migration.sql')
ok('① D185 — 대장(HOLD · FOR_SALE · DISCARDED · TO_SELLER · 주문 줄마다 한 행) · 지우지 못함 · 한 방향 · 입점은 반송 · 판매 상품 복제(성분 · 옵션 하나) · 값 · 유통기한 규칙 · 스위치 처음 off · 꺼짐에 판매 막음 · 끄면 멈춤 · 켜면 멈춘 것만 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.hlt_open_stock' in M and "CHECK (state IN ('HOLD', 'FOR_SALE', 'DISCARDED', 'TO_SELLER'))" in M
   and 'CONSTRAINT ux_hlt_open_stock_item UNIQUE (order_item_id)' in M and "'HLTOS: 개봉 반품 재고 기록은 지울 수 없습니다.'" in M
   and "NOT (OLD.state = 'HOLD' AND NEW.state IN ('FOR_SALE', 'DISCARDED'))" in M and "v_type = 'TENANT' AND NEW.state <> 'TO_SELLER'" in M
   and "('hlt.open_stock_sale', 'off', 'GLOBAL'" in M and 'INSERT INTO public.hlt_products SELECT (v_new).*;' in M
   and "v_new.name := '[개봉 반품] ' || v_src.name;" in M and 'p_price >= o.price' in M and 'p_expires <= (now() AT TIME ZONE' in M
   and "SET status = 'STOPPED', open_paused = true" in M and 'WHERE open_from_product_id IS NOT NULL AND open_paused' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M), '')
RS = rd('src/modules/health/health-return.service.ts'); DTO = rd('src/modules/health/health-shop.dto.ts'); SHC = rd('src/modules/health/health-shop.controller.ts')
OC = rd('src/modules/health/health-open-stock.controller.ts'); OS = rd('src/modules/health/health-open-stock.service.ts'); AM = rd('src/app.module.ts')
ADS = rd('src/modules/admin/admin.service.ts'); FIL = rd('src/common/db-error.filter.ts'); EN = rd('src/common/i18n/server-text.en.ts'); SP = rd('spec/screens.json')
ok('① 반품 승인 openAction(보관 · 폐기 · 입점은 반송) · 대장 기록 · API 3(ADMIN · SUPER · 감사 HLT_OPEN_SELL · HLT_OPEN_DISCARD) · DTO 가 컨트롤러 앞 · 스위치 켜기 SUPER · HLTOS → 422 · 영어 · 명세',
   "@IsIn(['HOLD', 'DISCARDED']) openAction?: string;" in DTO and 'dto.sellerFault, dto.openAction);' in SHC
   and 'INSERT INTO hlt_open_stock (return_id, order_id, order_item_id, product_id, option_id, qty, state, decided_at, decided_by)' in RS
   and "CASE WHEN s.type = 'TENANT' THEN 'TO_SELLER' ELSE $3 END" in RS
   and "@Controller('api/v1/admin/health/open-stock')" in OC and "@Roles('ADMIN', 'SUPER')" in OC and "@Audit('HLT_OPEN_SELL', 'HLT_PRODUCT')" in OC
   and "@Audit('HLT_OPEN_DISCARD', 'HLT_PRODUCT')" in OC and OC.index('export class OpenStockDiscardResultDto') < OC.index('export class HealthOpenStockController')
   and 'fn_hlt_open_stock_sell($1::uuid[], $2, $3, $4::date, $5)' in OS and 'HealthOpenStockController,' in AM and 'HealthOpenStockService,' in AM
   and "key === 'hlt.open_stock_sale' && (value ?? '').trim() === 'on'" in ADS and "Forbidden('OPEN_STOCK_SETTING_SUPER'" in ADS
   and "code: 'OPEN_STOCK_RULE'" in FIL and '"할인 판매 값은 원래 값보다 낮아야 합니다."' in EN and '"개봉 반품 할인 판매를 켜는 것은 최고 관리자(SUPER)만 할 수 있습니다."' in EN
   and '"SB-ADM-HOS-010"' in SP and all(f'"{a}"' in SP for a in ('GET /admin/health/open-stock', 'POST /admin/health/open-stock/sell', 'POST /admin/health/open-stock/{id}/discard')), '')
SQ = rd('src/modules/health/health-catalog.sql.ts'); CS = rd('src/modules/health/health-catalog.service.ts'); HA = rd('src/modules/health/health-admin.service.ts')
PG = rd('site/src/app/health/p/[code]/page.tsx'); KO = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); ENW = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
HO = rd('web/src/app/admin/HealthOpenStock.tsx'); HS = rd('web/src/app/admin/HealthSettle.tsx'); MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
ok('① 목록 · 검색 · 같은 성분에서 뺌(CARD_FROM) · 상세 · 운영 화면은 모두(CARD_FROM_ALL) · 상세 안내(원래 상품 · 상태 · 유통기한 · 반품 제한 / 원래 상품의 할인 상품) · 한 · 영 · 운영 화면 탭 · 반품 승인 보관 / 폐기',
   '(SELECT * FROM hlt_products WHERE open_from_product_id IS NULL) p' in SQ and 'export const CARD_FROM_ALL' in SQ and 'FROM ${CARD_FROM_ALL}' in CS
   and 'CARD_FROM_ALL as CARD_FROM' in HA and 'openReturn: !!_openFrom, openFrom: openFrom ?? null, openOffers,' in CS and 'fn_hlt_open_sale_on()' in CS
   and 'data-open-return' in PG and 'data-open-offers' in PG and all(k in KO.get('product', {}) and k in ENW.get('product', {}) for k in ('openTitle', 'openWhat', 'openLaw', 'openOffersTitle'))
   and "useApi<List>(`/admin/health/open-stock" in HO and "'hlt-open'" in MN and '<HealthOpenStock />' in APP
   and "openAction: openAct[r.id] ?? 'HOLD'" in HS and 'data-open-action' in HS, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('333_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 333 · 판 v10.208', bool(DOC) and rd('VERSION').strip() == 'v10.208', f'{DOC} · {rd("VERSION").strip()}')


# ── ② · ③ · ④ ─────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


SUPU = 'admin@x.com'; BUY = 'buyer@x.com'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    opt = None; used = 0; sw0 = None; oo0 = None; sale_code = None
    try:
        # ② DB
        mig = psql("SELECT count(*) || '|' || max(name) FROM schema_migrations")
        sw0 = psql("SELECT value FROM site_settings WHERE key = 'hlt.open_stock_sale'")
        ok('② 마이그레이션 223 · 끝 D185 · 스위치 처음 off', mig.startswith('223|') and mig.endswith('D185_hlt_open_stock') and sw0 == 'off', f'{mig} · {sw0}')

        consent_ok.agree(SUPU, PW); consent_ok.agree(BUY, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
        psql(f"UPDATE accounts SET identity_verified_at = coalesce(identity_verified_at, now()) WHERE id = '{bid}'")
        oo0 = psql("SELECT value FROM site_settings WHERE key = 'mall.order_open'")
        if oo0 == 'off': psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.order_open'")
        row = psql("SELECT p.code || '|' || o.id || '|' || o.price || '|' || o.stock FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id "
                   "JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active "
                   "WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' AND p.open_from_product_id IS NULL AND o.stock > 5 "
                   "AND (SELECT count(*) FROM hlt_product_options x WHERE x.product_id = p.id AND x.is_active) = 1 "
                   "AND NOT EXISTS (SELECT 1 FROM hlt_products z WHERE z.open_from_option_id = o.id) ORDER BY p.code LIMIT 1")
        dp, opt, oprice, ostock = (row.split('|') + ['', '', '0', '0'])[:4]
        oprice, ostock = int(oprice or 0), int(ostock or 0)
        addr = call('GET', '/me/health/addresses', t=TB)
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')

        def delivered(qty):
            o = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': dp, 'qty': qty}]}, TB)
            no = o.get('orderNo')
            if not no: return None, o
            psql(f"UPDATE hlt_orders SET status = 'PAID', paid_at = now() WHERE order_no = '{no}'")
            call('POST', f'/admin/health/orders/{no}/ship', {'carrier': 'CJ대한통운', 'trackingNo': '123456789012'}, TS)
            call('POST', f'/admin/health/orders/{no}/advance', {'state': 'DELIVERED'}, TS)
            return no, o

        no1, o1 = delivered(2); used += 2
        st1 = psql(f"SELECT status FROM hlt_orders WHERE order_no = '{no1}'")
        rq = call('POST', '/me/health/returns', {'orderNo': no1, 'kind': 'RETURN', 'reason': 'CHANGE_MIND', 'opened': True}, TB)
        rid = rq.get('id')
        bad = call('POST', f'/admin/health/returns/{rid}/decide', {'state': 'APPROVED', 'opened': True, 'openAction': 'TO_SELLER'}, TS) if rid else {}
        dc = call('POST', f'/admin/health/returns/{rid}/decide', {'state': 'APPROVED', 'opened': True, 'openAction': 'HOLD'}, TS) if rid else {}
        led = psql(f"SELECT k.state || '|' || k.qty || '|' || (k.option_id = '{opt}')::text FROM hlt_open_stock k WHERE k.return_id = '{rid}'") if rid else ''
        stock_after = psql(f"SELECT stock FROM hlt_product_options WHERE id = '{opt}'")
        ok('③ 직판 주문 → 배송 완료 → 개봉 반품 승인(보관) → 대장 HOLD 2개 · 같은 옵션 · 재고 안 돌아옴 · 틀린 처리(TO_SELLER) 400',
           dp and no1 and st1 == 'DELIVERED' and rid and bad.get('_err') == 400 and dc.get('_err') is None and led == 'HOLD|2|true'
           and stock_after == str(ostock - 2), f'{dp} {no1} {st1} · {rq.get("code")} · {bad.get("_err")} · {dc.get("_err") or dc.get("code")} · {led} · {ostock} → {stock_after}')

        lst = call('GET', '/admin/health/open-stock?state=HOLD', None, TS)
        mine = [x for x in lst.get('items') or [] if x.get('orderNo') == no1]
        kid = mine[0]['id'] if mine else None
        e1 = call('POST', '/admin/health/open-stock/sell', {'ids': [kid], 'price': oprice}, TS) if kid else {}
        e2 = call('POST', '/admin/health/open-stock/sell', {'ids': [kid], 'price': max(1, oprice - 1000), 'expiresOn': '2020-01-01'}, TS) if kid else {}
        sl = call('POST', '/admin/health/open-stock/sell', {'ids': [kid], 'price': max(1, oprice - 1000), 'note': '외부 상자만 개봉 · 시험 1208', 'expiresOn': '2031-12-31'}, TS) if kid else {}
        sale_code = sl.get('code')
        pd_off = call('GET', f'/health/products/{sale_code}') if sale_code else {}
        mb = call('GET', '/admin/health/open-stock', None, TB)
        ok('③ 대장 목록(HOLD · 상품 · 옵션 · 판매 스위치 꺼짐) · 할인 판매 — 원래 값 이상 422 · 지난 유통기한 422 · 옮김 → [개봉 반품] 상품 멈춤(STOPPED · 재고 2) · 꺼짐이면 상세 없음 · 회원 403',
           bool(mine) and lst.get('saleOn') is False and e1.get('code') == 'OPEN_STOCK_RULE' and e2.get('code') == 'OPEN_STOCK_RULE'
           and sl.get('ok') is True and sl.get('status') == 'STOPPED' and sl.get('stock') == 2 and (sale_code or '').endswith('-OR' + (psql(f"SELECT coalesce(months, 0) FROM hlt_product_options WHERE id = '{opt}'") or 'x'))
           and pd_off.get('_err') in (404, 409) and mb.get('_err') == 403,
           f'{len(mine)} · {lst.get("saleOn")} · {e1.get("code")} · {e2.get("code")} · {sl} · {pd_off.get("_err")} · {mb.get("_err")}')

        on = call('PATCH', '/admin/site-settings', {'key': 'hlt.open_stock_sale', 'value': 'on'}, TS)
        st_on = psql(f"SELECT status || '|' || open_paused FROM hlt_products WHERE code = '{sale_code}'")
        pd_on = call('GET', f'/health/products/{sale_code}')
        pd_src = call('GET', f'/health/products/{dp}')
        lst_all = call('GET', '/health/products')
        in_list = any((x.get('code') == sale_code) for x in (lst_all if isinstance(lst_all, list) else lst_all.get('items') or []))
        ok('③ 스위치 켬(SUPER) → 판매 중 · 상세에 개봉 반품 안내(원래 상품 · 상태 메모 · 유통기한) · 원래 상품 상세에 할인 상품 · 상품 목록에는 없음',
           on.get('_err') is None and st_on == 'ON_SALE|false' and pd_on.get('openReturn') is True and (pd_on.get('openFrom') or {}).get('code') == dp
           and (pd_on.get('openNote') or '').startswith('외부 상자만') and pd_on.get('openExpiresOn') == '2031-12-31' and pd_on.get('price') == max(1, oprice - 1000)
           and any(o.get('code') == sale_code for o in pd_src.get('openOffers') or []) and not in_list,
           f'{on.get("_err")} · {st_on} · {pd_on.get("openReturn")} {pd_on.get("openFrom")} · {[o.get("code") for o in pd_src.get("openOffers") or []]} · 목록 {in_list}')

        off = call('PATCH', '/admin/site-settings', {'key': 'hlt.open_stock_sale', 'value': 'off'}, TS)
        st_off = psql(f"SELECT status || '|' || open_paused FROM hlt_products WHERE code = '{sale_code}'")
        pd_src2 = call('GET', f'/health/products/{dp}')
        ok('③ 스위치 끔 → 멈춤(STOPPED · open_paused) · 원래 상품 상세의 할인 상품 사라짐',
           off.get('_err') is None and st_off == 'STOPPED|true' and not (pd_src2.get('openOffers') or []), f'{st_off} · {pd_src2.get("openOffers")}')

        no2, _ = delivered(1); used += 1
        rq2 = call('POST', '/me/health/returns', {'orderNo': no2, 'kind': 'RETURN', 'reason': 'CHANGE_MIND', 'opened': True}, TB) if no2 else {}
        dc2 = call('POST', f'/admin/health/returns/{rq2.get("id")}/decide', {'state': 'APPROVED', 'opened': True, 'openAction': 'DISCARDED'}, TS) if rq2.get('id') else {}
        led2 = psql(f"SELECT state || '|' || (decided_at IS NOT NULL)::text FROM hlt_open_stock WHERE return_id = '{rq2.get('id')}'") if rq2.get('id') else ''
        dz = call('POST', f'/admin/health/open-stock/{kid}/discard', {'note': '시험 1208 폐기'}, TS) if kid else {}
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action IN ('HLT_OPEN_SELL') AND occurred_at > now() - interval '10 minutes'")
        ok('③ 폐기 처리 반품 → 대장 DISCARDED(처리 시각) · 할인 판매 중인 것 폐기 422 · 감사 HLT_OPEN_SELL',
           dc2.get('_err') is None and led2 == 'DISCARDED|true' and dz.get('code') == 'OPEN_STOCK_RULE' and au.isdigit() and int(au) >= 1,
           f'{dc2.get("_err") or dc2.get("code")} · {led2} · {dz.get("code")} · 감사 {au}')

        dl = psql(f"BEGIN; DELETE FROM hlt_open_stock WHERE id = '{kid}'; ROLLBACK;") if kid else '!'
        bk = psql(f"BEGIN; UPDATE hlt_open_stock SET state = 'HOLD', sale_product_id = NULL WHERE id = '{kid}'; ROLLBACK;") if kid else '!'
        gd = psql(f"BEGIN; UPDATE hlt_products SET status = 'ON_SALE' WHERE code = '{sale_code}'; ROLLBACK;") if sale_code else '!'
        ok('② 대장 지우기 막음 · 거꾸로(할인 판매 → 보관) 막음 · 스위치 꺼짐에 개봉 반품 상품 판매 중으로 막음',
           dl.startswith('!') and '지울 수 없습니다' in dl and bk.startswith('!') and '보관 중인 것만' in bk and gd.startswith('!') and '꺼져 있습니다' in gd,
           f'{dl[:60]} · {bk[:60]} · {gd[:60]}')

        # ④ 화면
        errs, seen = [], {}
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.on('dialog', lambda d: d.dismiss())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/hlt-open', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['switch'] = pg.evaluate("() => document.querySelector('[data-open-switch]')?.textContent ?? ''")
                pg.click('[data-open-state="ALL"]'); pg.wait_for_timeout(1500)
                seen['rows'] = pg.evaluate("() => document.querySelectorAll('[data-open-stock] [data-open-item]').length")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 개봉 반품 재고 탭 · 스위치 꺼짐 표시 · 전체 2줄 이상 · 오류 없음', '꺼짐' in seen.get('switch', '') and seen.get('rows', 0) >= 2 and not errs, f'{seen} · {errs[:2]}')
    finally:
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'hlt.open_stock_sale'")
        if oo0 == 'off': psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
        if opt and used: psql(f"UPDATE hlt_product_options SET stock = stock + {used} WHERE id = '{opt}'")   # 개봉 반품이라 재고로 안 돌아온 만큼 되돌림

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
