"""v10.208 시험 — 소개몰 개봉 반품 재고 대장(보관 · 폐기 · 판매자 반송 · 재판매 없음)(D185 · docs/333)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1208.py

  ① 코드 — D185(대장 · 처리 HOLD · DISCARDED · TO_SELLER · 판매 상태 없음 · 한 방향 · 지우지 못함 · 입점은 반송) · 반품 승인 openAction · 대장 기록 ·
     API 2(ADMIN · SUPER · 감사) · 판매 경로 없음(할인 판매 · 스위치 · 상품 복제 없음) · 운영 화면 탭 · 반품 승인 보관 / 폐기 · DB 오류 → 422 · 영어 · 명세 · 문서 333 · 판
  ② (DB) 223 · D185 · 대장 지우기 · 거꾸로 · 판매 상태 막음
  ③ (API) 직판 주문 → 배송 완료 → 개봉 반품 승인(보관) → 대장 HOLD · 재고 안 돌아옴 · 틀린 처리 400 · 폐기 · 폐기된 것 다시 폐기 422 · 바로 폐기 반품 · 회원 403 · 감사
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
ok('① D185 — 대장(HOLD · DISCARDED · TO_SELLER · 주문 줄마다 한 행) · 판매 상태 없음 · 지우지 못함 · 보관 → 폐기만 · 입점은 반송 · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.hlt_open_stock' in M and "CHECK (state IN ('HOLD', 'DISCARDED', 'TO_SELLER'))" in M
   and 'CONSTRAINT ux_hlt_open_stock_item UNIQUE (order_item_id)' in M and "'HLTOS: 개봉 반품 재고 기록은 지울 수 없습니다.'" in M
   and "IF OLD.state <> 'HOLD' OR (NEW.state IS DISTINCT FROM OLD.state AND NEW.state <> 'DISCARDED')" in M and "v_type = 'TENANT' AND NEW.state <> 'TO_SELLER'" in M
   and 'FOR_SALE' not in M and 'open_stock_sale' not in M and 'hlt_products ADD COLUMN' not in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M), '')
RS = rd('src/modules/health/health-return.service.ts'); DTO = rd('src/modules/health/health-shop.dto.ts'); SHC = rd('src/modules/health/health-shop.controller.ts')
OC = rd('src/modules/health/health-open-stock.controller.ts'); OS = rd('src/modules/health/health-open-stock.service.ts'); AM = rd('src/app.module.ts')
FIL = rd('src/common/db-error.filter.ts'); EN = rd('src/common/i18n/server-text.en.ts'); SP = rd('spec/screens.json'); CS = rd('src/modules/health/health-catalog.sql.ts')
ok('① 반품 승인 openAction(보관 · 폐기 · 입점은 반송) · 대장 기록 · API 2(ADMIN · SUPER · 감사 HLT_OPEN_DISCARD) · DTO 가 컨트롤러 앞 · 판매 경로 없음 · HLTOS → 422 · 영어 · 명세',
   "@IsIn(['HOLD', 'DISCARDED']) openAction?: string;" in DTO and 'dto.sellerFault, dto.openAction);' in SHC
   and 'INSERT INTO hlt_open_stock (return_id, order_id, order_item_id, product_id, option_id, qty, state, decided_at, decided_by)' in RS
   and "CASE WHEN s.type = 'TENANT' THEN 'TO_SELLER' ELSE $3 END" in RS
   and "@Controller('api/v1/admin/health/open-stock')" in OC and "@Roles('ADMIN', 'SUPER')" in OC and "@Audit('HLT_OPEN_DISCARD', 'HLT_PRODUCT')" in OC
   and OC.index('export class OpenStockDiscardResultDto') < OC.index('export class HealthOpenStockController')
   and "@Post('sell')" not in OC and 'sell(' not in OS and 'open_from_product_id' not in CS
   and 'HealthOpenStockController,' in AM and 'HealthOpenStockService,' in AM and "code: 'OPEN_STOCK_RULE'" in FIL
   and '"보관 중인 것만 폐기로 옮길 수 있습니다 — 식품 · 화장품 개봉품은 다시 팔 수 없습니다."' in EN
   and '"SB-ADM-HOS-010"' in SP and '"GET /admin/health/open-stock"' in SP and '"POST /admin/health/open-stock/{id}/discard"' in SP and 'open-stock/sell' not in SP, '')
HO = rd('web/src/app/admin/HealthOpenStock.tsx'); HS = rd('web/src/app/admin/HealthSettle.tsx'); MN = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx')
ok('① 운영 화면 — 개봉 반품 재고 탭(보관 · 폐기 · 반송 · 폐기 단추 · 재판매 금지 안내) · 반품 승인 보관 / 바로 폐기',
   "useApi<List>(`/admin/health/open-stock" in HO and 'data-open-discard' in HO and '다시 팔 수 없습니다' in HO and '할인' not in HO
   and "'hlt-open'" in MN and '<HealthOpenStock />' in APP and "openAction: openAct[r.id] ?? 'HOLD'" in HS and 'data-open-action' in HS, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('333_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 333 · 판 v10.208 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 208), f'{DOC} · {rd("VERSION").strip()}')


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
    opt = None; used = 0; oo0 = None; hold = None
    try:
        # ② DB
        mig = psql("SELECT count(*) || '|' || max(name) FROM schema_migrations")
        ok('② 마이그레이션 223 · 끝 D185(v10.209 ~ 211 부터 226 · D188 — test_v1209 ~ 1211)', mig in ('223|D185_hlt_open_stock', '224|D186_mail_suppression', '225|D187_town_verify_guard', '226|D188_town_pick_ai', '227|D189_member_recommend', '228|D190_point_cashout', '229|D191_security_watch', '230|D192_partner_notice', '231|D193_seller_manage', '232|D194_partner_withdraw', '233|D195_staff_ip_verify', '234|D196_staff_sms', '235|D197_staff_ip_alert', '236|D198_ops_alert_pending_recent', '237|D199_mall_biz_report', '238|D200_ops_alert_slack', '239|D201_owner_todo_marks'), mig)

        consent_ok.agree(SUPU, PW); consent_ok.agree(BUY, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
        psql(f"UPDATE accounts SET identity_verified_at = coalesce(identity_verified_at, now()) WHERE id = '{bid}'")
        oo0 = psql("SELECT value FROM site_settings WHERE key = 'mall.order_open'")
        if oo0 == 'off': psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.order_open'")
        row = psql("SELECT p.code || '|' || o.id || '|' || o.price || '|' || o.stock FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id "
                   "JOIN hlt_product_options o ON o.product_id = p.id AND o.is_active "
                   "WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' AND o.stock > 5 "
                   "AND (SELECT count(*) FROM hlt_product_options x WHERE x.product_id = p.id AND x.is_active) = 1 "
                   "ORDER BY p.code LIMIT 1")
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
        mb = call('GET', '/admin/health/open-stock', None, TB)
        e0 = call('POST', f'/admin/health/open-stock/{kid}/discard', {'note': 'x'}, TS) if kid else {}
        dz = call('POST', f'/admin/health/open-stock/{kid}/discard', {'note': '시험 1208 폐기 — 유통기한 확인'}, TS) if kid else {}
        st_dz = psql(f"SELECT state || '|' || (decided_at IS NOT NULL)::text || '|' || coalesce(note, '') FROM hlt_open_stock WHERE id = '{kid}'") if kid else ''
        dz2 = call('POST', f'/admin/health/open-stock/{kid}/discard', {'note': '시험 1208 다시'}, TS) if kid else {}
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'HLT_OPEN_DISCARD' AND occurred_at > now() - interval '10 minutes'")
        ok('③ 대장 목록(HOLD · 상품 · 옵션 · 주문) · 회원 403 · 폐기 짧은 사유 400/422 · 폐기 → DISCARDED(처리 시각 · 사유) · 폐기된 것 다시 폐기 422 · 감사 HLT_OPEN_DISCARD',
           bool(mine) and mine[0].get('productCode') == dp and mb.get('_err') == 403 and e0.get('_err') in (400, 422)
           and dz.get('ok') is True and st_dz.startswith('DISCARDED|true|시험 1208 폐기') and dz2.get('code') == 'OPEN_STOCK_RULE' and au.isdigit() and int(au) >= 1,
           f'{len(mine)} · {mb.get("_err")} · {e0.get("_err")} · {dz} · {st_dz} · {dz2.get("code")} · 감사 {au}')

        no2, _ = delivered(1); used += 1
        rq2 = call('POST', '/me/health/returns', {'orderNo': no2, 'kind': 'RETURN', 'reason': 'CHANGE_MIND', 'opened': True}, TB) if no2 else {}
        dc2 = call('POST', f'/admin/health/returns/{rq2.get("id")}/decide', {'state': 'APPROVED', 'opened': True, 'openAction': 'DISCARDED'}, TS) if rq2.get('id') else {}
        led2 = psql(f"SELECT state || '|' || (decided_at IS NOT NULL)::text FROM hlt_open_stock WHERE return_id = '{rq2.get('id')}'") if rq2.get('id') else ''
        ok('③ 바로 폐기로 승인한 반품 → 대장 DISCARDED(처리 시각)', dc2.get('_err') is None and led2 == 'DISCARDED|true', f'{dc2.get("_err") or dc2.get("code")} · {led2}')

        hold = psql("SELECT id FROM hlt_open_stock WHERE state = 'HOLD' LIMIT 1")
        dl = psql(f"BEGIN; DELETE FROM hlt_open_stock WHERE id = '{kid}'; ROLLBACK;") if kid else '!'
        bk = psql(f"BEGIN; UPDATE hlt_open_stock SET state = 'HOLD' WHERE id = '{kid}'; ROLLBACK;") if kid else '!'
        fs = psql(f"BEGIN; UPDATE hlt_open_stock SET state = 'FOR_SALE' WHERE id = '{hold or kid}'; ROLLBACK;") if (hold or kid) else '!'
        ok('② 대장 지우기 막음 · 거꾸로(폐기 → 보관) 막음 · 판매 상태(FOR_SALE) 없음',
           dl.startswith('!') and '지울 수 없습니다' in dl and bk.startswith('!') and '다시 팔 수 없습니다' in bk and fs.startswith('!'),
           f'{dl[:60]} · {bk[:60]} · {fs[:60]}')

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
                seen['hint'] = pg.evaluate("() => document.querySelector('[data-open-stock] .hint')?.textContent ?? ''")
                pg.click('[data-open-state="ALL"]'); pg.wait_for_timeout(1500)
                seen['rows'] = pg.evaluate("() => document.querySelectorAll('[data-open-stock] [data-open-item]').length")
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:120])
        ok('④ 화면 — 개봉 반품 재고 탭 · 재판매 금지 안내 · 전체 2줄 이상 · 오류 없음', '다시 팔 수 없습니다' in seen.get('hint', '') and seen.get('rows', 0) >= 2 and not errs, f'{seen} · {errs[:2]}')
    finally:
        if oo0 == 'off': psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.order_open'")
        if opt and used: psql(f"UPDATE hlt_product_options SET stock = stock + {used} WHERE id = '{opt}'")   # 개봉 반품이라 재고로 안 돌아온 만큼 되돌림

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
