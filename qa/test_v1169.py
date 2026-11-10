"""v10.169 시험 — 소개몰 입점 5단계: 결제대행사 하위가맹점 · 정산 확정 · 지급 요청 틀(간주 모드 · 실제 호출 없음 · D158 · docs/260)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1169.py

  ① 코드 — D158(지급 요청 표 · 지우기 금지 · 금액 = 지급액 · 직판 안 됨 · 하위가맹점 시각) · 공급자 틀(시험만 · 간주 아니면 없음 · 외부 호출 없음) · 서버 · 화면 · 명세 · 영어 · docs/260 · 판
  ② (API · DB) 하위가맹점(간주 꺼짐 422 · 번호 적기 · 간주 켜면 시험 번호) · 확정 전 지급 409 · 확정 · 간주 꺼짐 지급 422 · 간주 켜면 지급 DONE · 정산서 PAID ·
     다시 409 · 지급 요청 지우기 DB 가 막음 · 판매자 정산서에 지급 상태 · 되돌림(지급 기록은 지울 수 없어 판매자만 막아 둠)
"""
import datetime, json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
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
M = rd('prisma/migrations/D158_mall_tenant_payout/migration.sql')
ok('① D158 — 지급 요청 표(정산서마다 하나 · 금액 > 0) · 지우기 금지 · 금액 = 지급액 · 직판 안 됨 · 끝난 요청 못 바꿈 · submerchant_at · 지우는 문장 없음 · 196 이상',
   'CREATE TABLE IF NOT EXISTS public.hlt_payout_requests' in M and 'settlement_id uuid NOT NULL UNIQUE' in M and "IF TG_OP = 'DELETE' THEN" in M
   and 'NEW.amount <> st.net_amount' in M and "st.type = 'DIRECT'" in M and "OLD.state = 'DONE'" in M and 'ADD COLUMN IF NOT EXISTS submerchant_at' in M
   and 'BEFORE INSERT OR UPDATE OR DELETE ON public.hlt_payout_requests' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 196 and 'D158_mall_tenant_payout' in mig, f'{len(mig)} · {mig[-1]}')
PV = rd('src/modules/health/submerchant.provider.ts'); ST = rd('src/modules/health/health-settle.service.ts'); SC = rd('src/modules/health/health-seller.controller.ts')
ok('① 공급자 · 서버 — 시험 공급자만 · 간주 아니면 null · fetch · http 없음 · 하위가맹점 · 확정 · 지급(확정만 · 직판 안 됨 · 하위가맹점 · 간주) · 감사 3',
   'class StubSubmerchantProvider' in PV and 'return assumeOn ? new StubSubmerchantProvider() : null;' in PV and not re.search(r'fetch\(|https?://', PV)
   and "'PG_SUBMERCHANT_NOT_READY'" in ST and "'PG_PAYOUT_NOT_READY'" in ST and "'NOT_CONFIRMED'" in ST and "'DIRECT_NO_PAYOUT'" in ST and "'NO_SUBMERCHANT'" in ST
   and "key = 'assume.payment'" in ST and sum(SC.count(f"@Audit('{a}'") for a in ('HLT_SELLER_SUBMERCHANT', 'HLT_SETTLE_CONFIRM', 'HLT_SETTLE_PAYOUT')) == 3, '')
WS = rd('web/src/app/admin/HealthSettle.tsx') + rd('web/src/app/admin/HealthSellers.tsx'); SE = rd('site/src/components/health/SellerSettlements.tsx')   # v10.223 — 판매자 표(하위가맹점)는 HealthSellers 로
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
apis = next((x.get('apis', []) for x in SPEC if x.get('id') == 'SB-ADM-HST-010'), [])
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 — 운영 하위가맹점 · 확정 · 지급 요청 · 판매자 지급 상태 · 사전 ko · en · 명세 3 · 영어 · docs/260 · 판',
   '/submerchant`' in WS and '/confirm`' in WS and '/payout`' in WS and 'data-payout' in SE
   and set((ko.get('ssettle') or {}).get('payout', {})) == {'READY', 'DONE', 'FAILED'} == set((en.get('ssettle') or {}).get('payout', {}))
   and all(a in apis for a in ('POST /admin/health/sellers/{id}/submerchant', 'POST /admin/health/settlements/{id}/confirm', 'POST /admin/health/settlements/{id}/payout'))
   and '"지급 요청 기록은 지울 수 없습니다":' in EN and '"확정된 정산서만 지급을 요청합니다.":' in EN
   and any(f.startswith('260_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 169), rd('VERSION').strip())


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


MEM = 'seller@x.com'; BUY = 'buyer@x.com'
today = datetime.date.today(); P1 = today - datetime.timedelta(days=today.weekday() + 7 * 30)   # 30주 전 월요일
sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")
if API and DB:
    t0 = sv('mall.tenant'); a0 = sv('assume.payment')
    mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'"); bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
    biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
    sid = None
    try:
        psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND'))")
        psql(f"DELETE FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND') AND NOT EXISTS (SELECT 1 FROM hlt_orders o WHERE o.seller_id = hlt_sellers.id)")
        psql(f"UPDATE hlt_sellers SET account_id = NULL WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql("UPDATE site_settings SET value = 'on' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'assume.payment'")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'")
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, status, applied_at, reviewed_at, commission_rate) "
                   f"VALUES ('TN-T1169-' || to_char(now(), 'HH24MISS'), '{mid}', 'TENANT', '시험 판매자 5', true, 'ACTIVE', now(), now(), 10) RETURNING id").splitlines()[0]
        scode = psql(f"SELECT code FROM hlt_sellers WHERE id = '{sid}'")
        s0 = call('POST', f'/admin/health/sellers/{sid}/submerchant', {}, T_)
        s1 = call('POST', f'/admin/health/sellers/{sid}/submerchant', {'submerchantId': 'PGCONSOLE-0001'}, T_)
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'assume.payment'")
        s2 = call('POST', f'/admin/health/sellers/{sid}/submerchant', {}, T_)
        ok('② 하위가맹점 — 간주 꺼짐이면 등록 422 · 번호 적기 · 간주 켜면 시험 번호 STUB-SUB-…', s0.get('code') == 'PG_SUBMERCHANT_NOT_READY' and s1.get('submerchantId') == 'PGCONSOLE-0001'
           and s2.get('submerchantId') == f'STUB-SUB-{scode}' and s2.get('stub') is True and psql(f"SELECT submerchant_at IS NOT NULL FROM hlt_sellers WHERE id = '{sid}'") == 't',
           f"{s0.get('code')} · {s1.get('submerchantId')} · {s2.get('submerchantId')}")
        code = f'{scode}-HONEY'
        call('POST', '/me/health/seller/products', {'code': 'HONEY', 'name': '시험 꿀 5', 'categoryCode': 'HLT_FOOD', 'notice': {'제조사': '시험식품'}, 'options': [{'price': 30000, 'stock': 10}]}, TM)
        call('POST', f'/me/health/seller/products/{code}/submit', t=TM); call('POST', f'/admin/health/product-reviews/{code}', {'decision': 'APPROVE'}, T_)
        call('POST', f'/me/health/seller/products/{code}/status', {'status': 'ON_SALE'}, TM)
        addr = call('GET', '/me/health/addresses', t=TB)
        aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
        ono = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': code, 'qty': 1}]}, TB).get('orderNo')
        psql(f"UPDATE hlt_orders SET status = 'DELIVERED', created_at = now() - interval '13 days', paid_at = now() - interval '12 days', shipped_at = now() - interval '10 days', delivered_at = now() - interval '9 days' WHERE order_no = '{ono}'")
        call('POST', '/admin/health/settlements/close', {'periodFrom': str(P1)}, T_)
        stl = psql(f"SELECT id FROM hlt_settlements WHERE seller_id = '{sid}' AND period_from = '{P1}'")
        p0 = call('POST', f'/admin/health/settlements/{stl}/payout', t=T_)
        cf = call('POST', f'/admin/health/settlements/{stl}/confirm', t=T_)
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'assume.payment'")
        p1 = call('POST', f'/admin/health/settlements/{stl}/payout', t=T_)
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'assume.payment'")
        p2 = call('POST', f'/admin/health/settlements/{stl}/payout', t=T_)
        row = psql(f"SELECT s.status || '|' || r.state || '|' || r.amount || '|' || r.stub || '|' || r.submerchant_id FROM hlt_settlements s JOIN hlt_payout_requests r ON r.settlement_id = s.id WHERE s.id = '{stl}'")
        ok('② 지급 — 확정 전 409 · 확정 · 간주 꺼짐 422 · 간주 켜면 DONE(시험) · 정산서 PAID · 금액 27,000 · 하위가맹점', p0.get('code') == 'NOT_CONFIRMED' and cf.get('status') == 'CONFIRMED'
           and p1.get('code') == 'PG_PAYOUT_NOT_READY' and p2.get('state') == 'DONE' and str(p2.get('ref', '')).startswith('STUB-PAYOUT-')
           and row == f'PAID|DONE|27000|true|STUB-SUB-{scode}', f"{p0.get('code')} · {cf} · {p1.get('code')} · {p2} · {row}")
        p3 = call('POST', f'/admin/health/settlements/{stl}/payout', t=T_)
        e_d, m_d = psql_err(f"DELETE FROM hlt_payout_requests WHERE settlement_id = '{stl}'")
        e_u, m_u = psql_err(f"UPDATE hlt_payout_requests SET amount = 1 WHERE settlement_id = '{stl}'")
        ok('② 다시 지급 409 · 지급 요청 지우기 · 바꾸기 DB 가 막음', p3.get('code') == 'NOT_CONFIRMED' and e_d != 0 and '지울 수 없습니다' in m_d and e_u != 0, f"{p3.get('code')} · {m_d[:50]} · {m_u[:50]}")
        dst = psql(f"SELECT s.id FROM hlt_settlements s JOIN hlt_sellers h ON h.id = s.seller_id WHERE h.type = 'DIRECT' AND s.period_from = '{P1}' LIMIT 1")
        pd = call('POST', f'/admin/health/settlements/{dst}/payout', t=T_) if dst else {'code': 'DIRECT_NO_PAYOUT'}
        ms = call('GET', '/me/health/seller/settlements', t=TM); me1 = next((x for x in (ms if isinstance(ms, list) else []) if x.get('id') == stl), {})
        ok('② 직판 정산서 지급 요청 409 · 판매자 정산서에 지급 상태 DONE', pd.get('code') == 'DIRECT_NO_PAYOUT' and me1.get('payoutState') == 'DONE' and me1.get('status') == 'PAID',
           f"{pd.get('code')} · {me1.get('payoutState')} · {me1.get('status')}")
    finally:
        psql(f"DELETE FROM hlt_settlement_items WHERE settlement_id IN (SELECT s.id FROM hlt_settlements s WHERE s.period_from = '{P1}' AND NOT EXISTS (SELECT 1 FROM hlt_payout_requests r WHERE r.settlement_id = s.id))")
        psql(f"DELETE FROM hlt_settlements s WHERE s.period_from = '{P1}' AND NOT EXISTS (SELECT 1 FROM hlt_payout_requests r WHERE r.settlement_id = s.id)")
        if sid:
            psql(f"UPDATE hlt_products SET status = 'STOPPED' WHERE seller_id = '{sid}'")
            psql(f"UPDATE hlt_sellers SET status = 'BLOCKED', status_reason = '시험 정리', account_id = NULL WHERE id = '{sid}'")   # 지급 기록은 지울 수 없어 판매자 · 상품만 막아 둠
        psql(f"UPDATE site_settings SET value = '{t0 or 'off'}' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        if a0: psql(f"UPDATE site_settings SET value = '{a0}' WHERE key = 'assume.payment'")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
    ok('끝 — 되돌림(입점 · 간주 설정 처음 값 · 판매자 막음 · 회원 연결 끊음)', sv('mall.tenant') == (t0 or 'off') and sv('assume.payment') == a0
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')") == '0', f"{sv('mall.tenant')} · {sv('assume.payment')}")
else:
    print('  (API · DB 없음 — ② 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
