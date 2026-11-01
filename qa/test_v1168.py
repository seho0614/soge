"""v10.168 시험 — 소개몰 입점 4단계: 주 1회 자동 정산 마감 · 정산 항목 · 환불 조정 · 판매수수료 계산서 틀(D157 · docs/259)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1168.py

  ① 코드 — D157(마감 함수 · 항목 SALE · REFUND · 이월 · 월요일 · 정기 작업 · 계산서 칸 · 설정 · 지우는 문장 없음) · 서버 · 실행기 · 화면 · 사전 · 명세 · 영어 · docs/259 · 판
  ② (API · DB) 마감 → 정산서 · 항목 · 수수료 · 계산서 요청 · 같은 주 다시 0 · 다음 주에 같은 주문 다시 안 셈(고친 결함) · 정산 뒤 반품 → REFUND · 음수 이월 ·
     판매자 정산서 · 명세 · 계산서 발행 · 두 번 409 · 월요일 아님 422 · 수수료율 · 되돌림
  ③ (화면) 판매자센터 「정산」 · 오류 없음
"""
import datetime, json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
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
M = rd('prisma/migrations/D157_mall_tenant_settle/migration.sql')
ok('① D157 — 마감 함수(월요일 · SALE · REFUND · 이월 · 한 번만) · 정기 작업 월 03:20 · 계산서 칸 · 방향 설정 · 지우는 문장 없음 · 195 이상',
   'CREATE OR REPLACE FUNCTION public.fn_hlt_settle_close(p_from date)' in M and "extract(isodow FROM p_from) <> 1" in M and "'SALE' FROM v_hlt_settle_ready" in M
   and "'REFUND'" in M and "status = 'CARRIED'" in M and "('hlt_settle_weekly', 10080, 3, 20, 2," in M and 'ADD COLUMN IF NOT EXISTS invoice_state' in M
   and "('mall.invoice_direction', 'COMPANY_TO_SELLER'," in M and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M)
   and len(mig) >= 195 and 'D157_mall_tenant_settle' in mig, f'{len(mig)} · {mig[-1]}')
ST = rd('src/modules/health/health-settle.service.ts'); SS = rd('src/modules/health/health-seller.service.ts'); SC = rd('src/modules/health/health-seller.controller.ts')
SH = rd('src/worker/scheduler.service.ts'); WC = rd('src/worker/worker.controller.ts')
ok('① 서버 — 마감은 DB 함수 · 계산서 기록 · 수수료율 · 판매자 정산서 · 명세(내 것만) · 정기 작업 실행기 · 감사 2',
   'fn_hlt_settle_close($1::date)' in ST and "invoice_state = 'ISSUED'" in ST and 'INSERT INTO hlt_commission_rates' in ST
   and 'WHERE st.seller_id = $1' in SS and 'WHERE id::text = $1 AND seller_id = $2' in SS and "case 'hlt_settle_weekly':" in SH and "'hlt_settle_weekly'" in WC
   and "@Audit('HLT_SETTLE_INVOICE'" in SC and "@Audit('HLT_COMMISSION_RATE'" in SC, '')
WS = rd('web/src/app/admin/HealthSettle.tsx'); SE = rd('site/src/components/health/SellerSettlements.tsx'); CP = rd('site/src/app/health/seller/center/page.tsx')
flat = lambda d, p='': {k for kk, v in d.items() for k in (flat(v, p + kk + '.') if isinstance(v, dict) else {p + kk})}
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
scr = {x.get('id'): x for x in SPEC}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 — 운영 계산서 · 수수료율 단추 · 판매자센터 정산 · 사전 ko · en · 명세 4 · 영어 · docs/259 · 판',
   '/invoice`' in WS and '/admin/health/commission-rates/' in WS and 'data-seller-settlements' in SE and '<SellerSettlements' in CP
   and flat(ko.get('ssettle', {})) == flat(en.get('ssettle', {})) and ko.get('ssettle')
   and 'GET /me/health/seller/settlements/{id}' in (scr.get('SB-HLT-SEL-020') or {}).get('apis', [])
   and 'PATCH /admin/health/commission-rates/{categoryCode}' in (scr.get('SB-ADM-HST-010') or {}).get('apis', [])
   and '"정산 시작일은 월요일이어야 합니다":' in EN
   and any(f.startswith('259_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 168), rd('VERSION').strip())


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


MEM = 'seller@x.com'; BUY = 'buyer@x.com'
setting = lambda: psql("SELECT value FROM site_settings WHERE key = 'mall.tenant'")
today = datetime.date.today(); P1 = today - datetime.timedelta(days=today.weekday() + 7 * 20)   # 20주 전 월요일(다른 시험 정산과 겹치지 않게)
P2 = P1 + datetime.timedelta(days=7); P3 = P2 + datetime.timedelta(days=7)
if API and DB:
    s0 = setting(); mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'"); bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    rate0 = psql("SELECT coalesce((SELECT rate::text FROM hlt_commission_rates WHERE category_code = '*'), '')")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
    sid = None; ono = None
    try:
        psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND'))")
        psql(f"DELETE FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND') AND NOT EXISTS (SELECT 1 FROM hlt_orders o WHERE o.seller_id = hlt_sellers.id)")
        psql(f"UPDATE hlt_sellers SET account_id = NULL WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant'")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'")
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at, submerchant_id, commission_rate, ship_fee, return_ship_fee) "
                   f"VALUES ('TN-T1168-' || to_char(now(), 'HH24MISS'), '{mid}', 'TENANT', '시험 판매자 4', true, 'ACTIVE', now(), now(), 'SUB-T1168', 12, 0, 6000) RETURNING id").splitlines()[0]
        scode = psql(f"SELECT code FROM hlt_sellers WHERE id = '{sid}'"); code = f'{scode}-TEA'
        call('POST', '/me/health/seller/products', {'code': 'TEA', 'name': '시험 차 4', 'categoryCode': 'HLT_FOOD', 'notice': {'제조사': '시험식품'}, 'options': [{'price': 25000, 'stock': 10}]}, TM)
        call('POST', f'/me/health/seller/products/{code}/submit', t=TM); call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, T_)
        call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        addr = call('GET', '/me/health/addresses', t=TB)
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        o1 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': code, 'qty': 2}]}, TB); ono = o1.get('orderNo')
        psql(f"UPDATE hlt_orders SET status = 'DELIVERED', created_at = now() - interval '13 days', paid_at = now() - interval '12 days', shipped_at = now() - interval '10 days', delivered_at = now() - interval '9 days' WHERE order_no = '{ono}'")
        bad = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1 + datetime.timedelta(days=2))}, T_)
        c1 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        st1 = psql(f"SELECT gross_amount || '|' || commission || '|' || net_amount || '|' || invoice_state || '|' || (SELECT count(*) FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'SALE') "
                   f"FROM hlt_settlements s WHERE seller_id = '{sid}' AND period_from = '{P1}'")
        ok('② 마감 — 월요일 아님 422 · 정산서(매출 50,000 · 수수료 12% 6,000 · 지급 44,000) · 계산서 요청 · 항목 SALE 1', bad.get('_err') == 422 and c1.get('created', 0) >= 1
           and st1 == '50000|6000|44000|REQUESTED|1', f"{bad.get('_err')} · {c1} · {st1}")
        c1b = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        c2 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P2)}, T_)
        n2 = psql(f"SELECT count(*) FROM hlt_settlements WHERE seller_id = '{sid}'")
        ok('② 같은 주 다시 마감 0 · 다음 주 마감에 같은 주문을 다시 세지 않음(고친 결함) — 이 판매자 정산서 1개', n2 == '1' and psql(
            f"SELECT count(*) FROM hlt_settlement_items i JOIN hlt_orders o ON o.id = i.order_id WHERE o.order_no = '{ono}' AND i.kind = 'SALE'") == '1', f"{c1b} · {c2} · {n2}")
        oid = psql(f"SELECT id FROM hlt_orders WHERE order_no = '{ono}'")
        psql(f"INSERT INTO hlt_returns (order_id, kind, reason, state, decided_at) VALUES ('{oid}', 'RETURN', 'DEFECT', 'APPROVED', now())")
        c3 = call('POST', '/admin/health/settlements/close', {'periodFrom': str(P3)}, T_)
        st3 = psql(f"SELECT refund_amount || '|' || net_amount || '|' || status || '|' || carried_out || '|' || (SELECT count(*) FROM hlt_settlement_items i WHERE i.settlement_id = s.id AND i.kind = 'REFUND') "
                   f"FROM hlt_settlements s WHERE seller_id = '{sid}' AND period_from = '{P3}'")
        ok('② 정산 뒤 반품 → 다음 회차 REFUND(판매자 몫 44,000 뺌) · 지급액 음수 → 이월', st3 == '44000|-44000|CARRIED|-44000|1', f"{c3} · {st3}")
        ms = call('GET', '/me/health/seller/settlements', t=TM); rows = ms if isinstance(ms, list) else []
        first = next((x for x in rows if str(x.get('from', ''))[:10] == str(P1)), {})
        ln = call('GET', f"/me/health/seller/settlements/{first.get('id')}", t=TM) if first else []
        other = call('GET', f"/me/health/seller/settlements/{first.get('id')}", t=TB) if first else {}
        ok('② 판매자 정산서 2 · 명세(주문 · 판매) · 판매자 아니면 403', len(rows) == 2 and isinstance(ln, list) and len(ln) == 1 and ln[0].get('orderNo') == ono
           and other.get('_err') == 403, f"{len(rows)} · {ln if isinstance(ln, list) else ln} · {other.get('_err')}")
        sid1 = psql(f"SELECT id FROM hlt_settlements WHERE seller_id = '{sid}' AND period_from = '{P1}'")
        iv1 = call('POST', f'/admin/health/settlements/{sid1}/invoice', {'invoiceNo': '20261101-T1168'}, T_)
        iv2 = call('POST', f'/admin/health/settlements/{sid1}/invoice', {'invoiceNo': '20261101-T1168'}, T_)
        ok('② 계산서 발행 번호 → ISSUED · 두 번째 409 NOT_REQUESTED', iv1.get('invoiceState') == 'ISSUED' and iv2.get('code') == 'NOT_REQUESTED', f"{iv1} · {iv2.get('code')}")
        ch0 = psql("SELECT count(*) FROM hlt_commission_changes WHERE target = '*'")
        r1 = call('PATCH', '/admin/health/commission-rates/*', {'rate': 11, 'note': '시험'}, T_)
        rbad = call('PATCH', '/admin/health/commission-rates/*', {'rate': 51}, T_)
        ok('② 수수료율 — 기본 11% 로 바꿈 · 기록 1 · 51 은 400', any(x.get('categoryCode') == '*' and float(x.get('rate')) == 11 for x in (r1 if isinstance(r1, list) else []))
           and int(psql("SELECT count(*) FROM hlt_commission_changes WHERE target = '*'")) == int(ch0) + 1 and rbad.get('_err') == 400, f"{rbad.get('_err')}")
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch(); pg = b_.new_context(viewport={'width': 1300, 'height': 1000}).new_page(); errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', MEM); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(3000)
                    pg.goto(SITE + '/health/seller/center', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    box = pg.locator('[data-seller-settlements]').count(); rws = pg.locator('[data-seller-settlement]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1168_site_settle.png'), full_page=True)
                    b_.close()
                ok('③ 사용자 웹 판매자센터 「정산」 — 정산서 2줄 · 오류 없음', box == 1 and rws == 2 and not errs, f'{box} · {rws} · {errs[:2]}')
    finally:
        if rate0: psql(f"UPDATE hlt_commission_rates SET rate = {rate0} WHERE category_code = '*'")
        # 20주 전 세 주에 만든 정산서는 모두(직판 포함) 지움 — 다른 시험의 정산 대상이 줄지 않게
        psql(f"DELETE FROM hlt_settlement_items WHERE settlement_id IN (SELECT id FROM hlt_settlements WHERE period_from IN ('{P1}', '{P2}', '{P3}'))")
        psql(f"DELETE FROM hlt_settlements WHERE period_from IN ('{P1}', '{P2}', '{P3}')")
        if sid:
            psql(f"DELETE FROM hlt_settlement_items WHERE settlement_id IN (SELECT id FROM hlt_settlements WHERE seller_id = '{sid}')")
            psql(f"DELETE FROM hlt_settlements WHERE seller_id = '{sid}'")
            psql(f"DELETE FROM hlt_returns WHERE order_id IN (SELECT id FROM hlt_orders WHERE seller_id = '{sid}')")
            psql(f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE seller_id = '{sid}')")
            psql(f"DELETE FROM hlt_payments WHERE order_id IN (SELECT id FROM hlt_orders WHERE seller_id = '{sid}')")
            psql(f"DELETE FROM hlt_orders WHERE seller_id = '{sid}'")
            psql(f"UPDATE hlt_products SET status = 'STOPPED' WHERE seller_id = '{sid}'")
            psql(f"UPDATE hlt_sellers SET status = 'BLOCKED', account_id = NULL WHERE id = '{sid}'")
        psql(f"UPDATE site_settings SET value = '{s0 or 'off'}' WHERE key = 'mall.tenant'")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
    ok('끝 — 되돌림(설정 · 기본 수수료율 · 시험 정산서 · 주문 없음 · 판매자 막음)', setting() == (s0 or 'off')
       and (not sid or psql(f"SELECT count(*) FROM hlt_settlements WHERE seller_id = '{sid}'") == '0')
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')") == '0', setting())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
