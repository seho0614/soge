"""v10.223 (D193 · docs/358) — 소개몰 판매자 관리: 정지 · 다시 열기 · 이용 제한 · 폐점 · 정보 변경 요청 · 수수료율 · 서류 만료 알림 · 신청 스위치 나누기

  ① (코드) D193(상태 CLOSED · 사유 · 상품 따라 내림 · 되돌림 · 정보 변경 요청 · 수수료율 기록 · 서류 만료 함수 · 정기 작업 · mall.tenant_apply · 알림 8) ·
     판매자 관리 서비스 · 컨트롤러(ADMIN · SUPER) · 정기 작업 등록 · 신청 스위치(서비스 · 머리줄 · 운영 화면) · 운영 화면 판매자 표 · 판매자센터 「판매자 계정」 · 명세 · 문서 358
  ② (API · DB) 스위치 둘(config enabled · saleOpen) / 정지(사유 없음 400 · 회원 403) → 판매 중 상품 내림 · 알림 → 다시 열기 → 되돌림 /
     수수료율(기록 · 알림 · 같은 값 409) / 정보 변경 요청(대기 1건 409 · 반려 사유 422 · 승인 → 반영 · 서류 바뀜) / 서류 만료(7일 전 알림 1번 · 만료 운영 알림) /
     폐점(정산 남으면 409 · 끝나면 CLOSED · 상품 내림 · 판매자센터 403 · 다시 신청 가능) / DB — 사유 없는 정지 막음
  ③ (화면) 운영 화면 「소개몰 판매자」 — 판매자 줄 · 관리 단추 · 정보 변경 요청 카드 / 판매자센터 「판매자 계정」(정지 사유 · 변경 요청 · 폐점)
  자료: 시험 판매자 · 회원은 매번 새로 · 설정은 처음 값으로 · 만든 판매자 · 상품은 끝에 지움(두 번 돌려도 같음)
"""
import datetime, json, os, re, subprocess, time, urllib.error, urllib.request

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


# ── ① 코드 ──────────────────────────────────────────────────────────────
M = rd('prisma/migrations/D193_seller_manage/migration.sql')
ok('① D193 — 상태 CLOSED · 사유 필수 문 · 상품 따라 내림 · 하나씩 되돌림 · 정보 변경 요청(대기 1건) · 수수료율 기록 · 서류 만료 함수 · 정기 작업 09:00 · mall.tenant_apply(지금 값 옮김) · 알림 8',
   "'REJECTED'::text, 'CLOSED'::text" in M and "RAISE EXCEPTION 'HLTS: 판매자 정지 · 이용 제한 · 폐점에는 사유가 필요합니다'" in M
   and "UPDATE public.hlt_products SET status = 'STOPPED', off_by_seller_at = now()" in M and 'EXCEPTION WHEN raise_exception OR check_violation THEN' in M
   and "CREATE UNIQUE INDEX IF NOT EXISTS uq_hlt_change_pending ON public.hlt_seller_change_requests(seller_id) WHERE state = 'PENDING'" in M
   and 'CREATE TABLE IF NOT EXISTS public.hlt_seller_rate_changes' in M and 'CREATE OR REPLACE FUNCTION public.fn_hlt_license_watch()' in M
   and "VALUES ('seller_license_watch', 1440, 9, 0, NULL, true," in M and "SELECT 'mall.tenant_apply', coalesce((SELECT value FROM public.site_settings WHERE key = 'mall.tenant'), 'off')" in M
   and "'mall.tenant', 'mall.tenant_apply')" in M and all(f"('{c}'," in M for c in ('SELLER_PAUSED', 'SELLER_RESUMED', 'SELLER_BLOCKED', 'SELLER_CLOSED', 'SELLER_CHANGE_APPROVED', 'SELLER_CHANGE_REJECTED', 'SELLER_RATE_CHANGED'))
   and "('SELLER_LICENSE_EXPIRING'," in M and not re.search(r'\b(DROP TABLE|TRUNCATE)\b', M), '')
SV, CT = rd('src/modules/health/health-seller-manage.service.ts'), rd('src/modules/health/health-seller-manage.controller.ts')
ok('① 판매자 관리 — 상태 4가지 · 폐점 막는 것(주문 · 취소 · 반품 · 정산) · 수수료율 사유 · 정보 변경 승인 반영 · 운영 API 는 ADMIN · SUPER 만 · 감사 기록',
   all(f"{k}:" in SV for k in ('PAUSE', 'RESUME', 'BLOCK', 'CLOSE')) and "o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED')" in SV and "x.state IN ('REQUESTED','APPROVED')" in SV
   and 'INSERT INTO hlt_seller_rate_changes' in SV and 'DELETE FROM hlt_seller_licenses WHERE seller_id = $1' in SV
   and CT.count("@Roles('ADMIN', 'SUPER')") == 5 and all(f"@Audit('{a}'" in CT for a in ('HLT_SELLER_STATUS', 'HLT_SELLER_RATE', 'HLT_SELLER_CHANGE_DECIDE', 'HLT_SELLER_CLOSE_SELF', 'HLT_SELLER_CHANGE_REQUEST'))
   and 'HealthSellerManageController' in rd('src/app.module.ts'), str(CT.count("@Roles('ADMIN', 'SUPER')")))
SC, WK = rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
TS_, ME_, AS_ = rd('src/modules/health/health-tenant.service.ts'), rd('src/modules/me/me.service.ts'), rd('src/modules/admin/admin.service.ts')
ok('① 정기 작업 seller_license_watch(작업 이름 · 운영 실행 목록) · 신청 스위치 — 신청은 mall.tenant_apply · config saleOpen · 머리줄 · 켜기 SUPER(둘 다)',
   "case 'seller_license_watch':" in SC and "'seller_license_watch'" in SC.split('export interface JobResult')[0] and "'seller_license_watch'," in WK
   and "key = 'mall.tenant_apply'), 'off') = 'on' AS is_on" in TS_ and 'saleOpen: !!r?.sale' in TS_ and "key = 'mall.tenant_apply'), 'off') = 'on' AS tenant`" in ME_
   and "(key === 'mall.tenant' || key === 'mall.tenant_apply') && (value ?? '').trim() === 'on'" in AS_, '')
HS, TA, SA, CP = rd('web/src/app/admin/HealthSellers.tsx'), rd('web/src/app/admin/HealthTenantApply.tsx'), rd('site/src/components/health/SellerAccount.tsx'), rd('site/src/app/health/seller/center/page.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}'); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}')
ok('① 화면 — 운영 판매자 표(정지 · 다시 열기 · 이용 제한 · 폐점 · 수수료율 · 기록 · 변경 요청 승인 반려) · 판매 열기 줄 · 판매자센터 「판매자 계정」 · 사전 ko · en',
   all(f'data-seller-act="{k}"' in HS for k in ('PAUSE', 'RESUME', 'BLOCK', 'CLOSE')) and 'data-seller-rate=' in HS and 'data-seller-change=' in HS and "/admin/health/sellers/change-requests/" in HS
   and 'data-tenant-sale=' in TA and "key: 'mall.tenant_apply'" in TA and 'data-seller-account=""' in SA and 'data-seller-close-form=""' in SA and 'data-seller-change-form=""' in SA
   and '<SellerAccount info={account} />' in CP and set(ko.get('account', {})) == set(en.get('account', {})) and len(ko.get('account', {})) >= 30
   and all(ko.get('tenant', {}).get(k) and en.get('tenant', {}).get(k) for k in ('closedState', 'blockedReason', 'pausedNote')), '')
NJ = json.loads(rd('spec/notifications.json') or '{}'); ev = {e.get('code'): e for e in NJ.get('events', [])}
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sid = {s['id']: s for s in SJ.get('screens', [])}
admin_apis = set(sid.get('SB-ADM-HSL-010', {}).get('apis', [])) | set(sid.get('SB-ADM-HST-010', {}).get('apis', []))
ok('① 명세 — 알림 8종 · 판매자센터 API 4 · 운영 API 5',
   all(ev.get(c, {}).get('optout') is False for c in ('SELLER_PAUSED', 'SELLER_RESUMED', 'SELLER_BLOCKED', 'SELLER_CLOSED', 'SELLER_CHANGE_APPROVED', 'SELLER_CHANGE_REJECTED', 'SELLER_RATE_CHANGED', 'SELLER_LICENSE_EXPIRING'))
   and {'GET /me/health/seller/account', 'POST /me/health/seller/change-request', 'POST /me/health/seller/change-request/cancel', 'POST /me/health/seller/close'} <= set(sid.get('SB-HLT-SEL-020', {}).get('apis', []))
   and {'GET /admin/health/sellers/change-requests', 'POST /admin/health/sellers/change-requests/{id}/decide', 'GET /admin/health/sellers/{id}/history',
        'POST /admin/health/sellers/{id}/status', 'POST /admin/health/sellers/{id}/commission'} <= admin_apis, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('358_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 358 · 판 v10.223 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 223), f'{DOC} · {rd("VERSION").strip()}')


# ── ② API · DB ─────────────────────────────────────────────────────────
def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
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


stamp = str(int(time.time()))[-7:]
SEL = f't1223sel{stamp}@x.com'
CODE = f'TN-T{stamp}'
seen = {}
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), 'off')")
    t_sale0, t_apply0 = sv('mall.tenant'), sv('mall.tenant_apply')
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{SEL}', '시험1223', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{SEL}'")
    consent_ok.agree(SEL, PW); consent_ok.agree('admin@x.com', PW)
    login = lambda e: call('POST', '/auth/login', {'email': e, 'password': PW}).get('accessToken')
    TS, TL = login('admin@x.com'), login(SEL)
    nt = lambda code: psql(f"SELECT count(*) || '|' || coalesce(max(body), '') FROM notifications WHERE account_id = '{aid}' AND event_code = '{code}'")
    sid_ = ''
    try:
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant_apply'"); psql("UPDATE site_settings SET value = 'off' WHERE key = 'mall.tenant'")
        cf = call('GET', '/health/tenant/config')
        ok('② 스위치 둘 — 신청 받기 on · 판매 off 면 config enabled true · saleOpen false', cf.get('enabled') is True and cf.get('saleOpen') is False, str(cf))
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'mall.tenant'")
        sid_ = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, submerchant_id) "
                    f"VALUES ('{CODE}', '{aid}', 'TENANT', '시험 가게 1223', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), 'SUB-T1223') RETURNING id").splitlines()[0]
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'HLT' ORDER BY code LIMIT 1")
        for x in ('A', 'B'):
            pid = psql(f"INSERT INTO hlt_products (code, name, price, stock, status, seller_id, review_state, category_id) VALUES ('{CODE}-{x}', '시험 상품 {x}', 10000, 5, 'DRAFT', '{sid_}', 'APPROVED', '{cat}') RETURNING id").splitlines()[0]
            psql(f"INSERT INTO hlt_product_options (product_id, price, stock) VALUES ('{pid}', 10000, 5)")
        psql(f"UPDATE hlt_products SET status = 'ON_SALE' WHERE code IN ('{CODE}-A', '{CODE}-B')")
        psql(f"UPDATE hlt_products SET status = 'STOPPED' WHERE code = '{CODE}-B'")
        prod = lambda: psql(f"SELECT string_agg(right(code, 1) || ':' || status || ':' || (off_by_seller_at IS NOT NULL), ',' ORDER BY code) FROM hlt_products WHERE seller_id = '{sid_}'")
        p0 = prod()
        e0 = call('POST', f'/admin/health/sellers/{sid_}/status', {'action': 'PAUSE', 'reason': ''}, TS)
        e1 = call('POST', f'/admin/health/sellers/{sid_}/status', {'action': 'PAUSE', 'reason': '시험 정지 1223'}, TL)
        s1 = call('POST', f'/admin/health/sellers/{sid_}/status', {'action': 'PAUSE', 'reason': '시험 정지 1223'}, TS)
        p1 = prod(); n1 = nt('SELLER_PAUSED')
        acc = call('GET', '/me/health/seller/account', None, TL)
        ok('② 정지 — 사유 없음 400 · 회원 403 · PAUSED · 판매 중 A 만 내림(표시) · 멈춰 있던 B 는 그대로 · 알림(사유) · 판매자센터 정지 사유',
           p0 == 'A:ON_SALE:false,B:STOPPED:false' and e0.get('_err') == 400 and e1.get('_err') == 403 and s1.get('status') == 'PAUSED'
           and p1 == 'A:STOPPED:true,B:STOPPED:false' and n1.startswith('1|') and '시험 정지 1223' in n1 and acc.get('statusReason') == '시험 정지 1223',
           f'{p0} · {e0.get("_err")} · {e1.get("_err")} · {p1} · {n1[:30]} · {acc.get("statusReason")}')
        s2 = call('POST', f'/admin/health/sellers/{sid_}/status', {'action': 'RESUME', 'reason': '확인 끝 1223'}, TS)
        p2 = prod(); n2 = nt('SELLER_RESUMED')
        ok('② 다시 열기 — ACTIVE · 정지 때 내린 A 만 다시 판매 · B 는 그대로 · 알림', s2.get('status') == 'ACTIVE' and p2 == 'A:ON_SALE:false,B:STOPPED:false' and n2.startswith('1|'), f'{p2} · {n2[:20]}')
        db0 = psql(f"UPDATE hlt_sellers SET status = 'PAUSED', status_reason = NULL WHERE id = '{sid_}'")
        ok('② DB — 사유 없는 정지 막음(앱을 거치지 않아도)', db0.startswith('!') and '사유가 필요합니다' in db0, db0[:80])

        r1 = call('POST', f'/admin/health/sellers/{sid_}/commission', {'rate': 15, 'reason': '협의 1223'}, TS)
        r2 = call('POST', f'/admin/health/sellers/{sid_}/commission', {'rate': 15, 'reason': '협의 1223'}, TS)
        hs = call('GET', f'/admin/health/sellers/{sid_}/history', None, TS)
        n3 = nt('SELLER_RATE_CHANGED')
        ok('② 수수료율 — 기본 → 15% · 기록(사유 · 바꾼 사람) · 알림(새 주문부터) · 같은 값 409 SAME_RATE',
           r1.get('ok') is True and r1.get('to') == 15 and r1.get('from') is None and r2.get('code') == 'SAME_RATE'
           and psql(f"SELECT commission_rate FROM hlt_sellers WHERE id = '{sid_}'") == '15.00' and (hs.get('rates') or [{}])[0].get('reason') == '협의 1223'
           and n3.startswith('1|') and '들어오는 주문부터' in n3, f'{r1} · {r2.get("code")} · {n3[:60]}')

        exp = (datetime.date.today() + datetime.timedelta(days=200)).isoformat()
        c1 = call('POST', '/me/health/seller/change-request', {'csTel': '02-111-2222', 'licenses': [{'kind': 'ECOM_REG', 'licenseNo': 'L-1223-NEW', 'expiresAt': exp}], 'note': '번호 바꿈'}, TL)
        c2 = call('POST', '/me/health/seller/change-request', {'csTel': '02-333-4444'}, TL)
        c3 = call('POST', '/me/health/seller/change-request', {}, TL)
        lst = call('GET', '/admin/health/sellers/change-requests', None, TS)
        mine = next((x for x in (lst if isinstance(lst, list) else []) if x.get('sellerId') == sid_), {})
        dj = call('POST', f"/admin/health/sellers/change-requests/{mine.get('id')}/decide", {'approve': False}, TS)
        ok('② 정보 변경 요청 — 대기(판매자센터에 보임) · 두 번째 409 CHANGE_PENDING · 빈 요청 422 NO_CHANGE · 운영 목록(지금 값과 나란히) · 사유 없는 반려 422',
           (c1.get('change') or {}).get('state') == 'PENDING' and c2.get('code') == 'CHANGE_PENDING' and c3.get('code') == 'NO_CHANGE'
           and mine.get('fields', {}).get('csTel') == '02-111-2222' and mine.get('current', {}).get('csTel') == '02-000-0000' and dj.get('code') == 'REASON_REQUIRED',
           f"{(c1.get('change') or {}).get('state')} · {c2.get('code')} · {c3.get('code')} · {dj.get('code')}")
        seen['changeId'] = mine.get('id')

        # ③ 화면(운영 화면 정보 변경 카드 · 판매자센터) — 승인 전에
        try:
            from playwright.sync_api import sync_playwright
        except Exception:
            sync_playwright = None
        if sync_playwright and (ADMIN_WEB or SITE):
            errs = []
            try:
                with sync_playwright() as p:
                    b = p.chromium.launch()
                    if ADMIN_WEB:
                        pg = b.new_page(viewport={'width': 1500, 'height': 1000}); pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                        tab = '/#/hlt-sellers' if os.path.exists(os.path.join(K, 'web/src/app/admin/HealthSellerTab.tsx')) else '/#/hlt-settle'
                        pg.goto(ADMIN_WEB + tab, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                        row = pg.locator(f'[data-hlt-seller="{CODE}"]')
                        acts = [a for a in ('PAUSE', 'RESUME', 'BLOCK', 'CLOSE') if row.locator(f'[data-seller-act="{a}"]').count()]
                        card = pg.locator(f'[data-seller-change="{mine.get("id")}"]').count()
                        if row.count(): row.scroll_into_view_if_needed()
                        pg.screenshot(path=os.path.join(HERE, 'v1223_admin_sellers.png'), full_page=False)
                        seen['admin'] = (row.count(), acts, row.locator('[data-seller-rate]').count(), card, bool(re.search(r'15(\.00)?%', row.inner_text() if row.count() else '')))
                    if SITE:
                        for w in (1400, 390):
                            pg = b.new_page(viewport={'width': w, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                            pg.goto(SITE + '/login', wait_until='networkidle', timeout=120000)
                            pg.fill('input[name=email]', SEL); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
                            pg.goto(SITE + '/health/seller/center', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1000)
                            box = pg.locator('[data-seller-account]')
                            if box.count(): box.scroll_into_view_if_needed()
                            if w == 1400: pg.screenshot(path=os.path.join(HERE, 'v1223_seller_account.png'), full_page=False)
                            seen[f'site{w}'] = (box.count(), pg.locator('[data-seller-change="PENDING"]').count(), pg.locator('[data-seller-change-form]').count(),
                                                pg.locator('[data-seller-close-form]').count() + pg.locator('[data-seller-close-blocked]').count())
                            pg.close()
                    b.close()
            except Exception as ex:
                errs.append(str(ex)[:200])
            if ADMIN_WEB:
                ok('③ 운영 화면 「소개몰 판매자」 — 시험 판매자 줄 · 정지 · 이용 제한 · 폐점 단추(ACTIVE) · 수수료율 15% · 정보 변경 요청 카드',
                   seen.get('admin') == (1, ['PAUSE', 'BLOCK', 'CLOSE'], 1, 1, True), str(seen.get('admin')))
            if SITE:
                for w in (1400, 390):
                    ok(f'③ {w}px 판매자센터 「판매자 계정」 — 심사 중 요청 줄 · 대기 중이라 요청 칸 없음 · 폐점 칸', seen.get(f'site{w}') == (1, 1, 0, 1), str(seen.get(f'site{w}')))
            ok('③ 화면 오류 없음', not errs, str(errs[:3]))
        else:
            ok('③ 화면 — playwright · ADMIN_WEB · SITE 필요', False, '없음')

        da = call('POST', f"/admin/health/sellers/change-requests/{mine.get('id')}/decide", {'approve': True}, TS)
        row = psql(f"SELECT cs_tel || '|' || (SELECT string_agg(license_no || ':' || expires_at || ':' || (verified_at IS NOT NULL), ',') FROM hlt_seller_licenses WHERE seller_id = '{sid_}') FROM hlt_sellers WHERE id = '{sid_}'")
        n4 = nt('SELLER_CHANGE_APPROVED')
        ok('② 정보 변경 승인 — 전화 바뀜 · 서류 새 목록(유효기간 · 확인함) · 알림 · 다시 승인 409', da.get('state') == 'APPROVED' and row == f'02-111-2222|L-1223-NEW:{exp}:true'
           and n4.startswith('1|') and call('POST', f"/admin/health/sellers/change-requests/{mine.get('id')}/decide", {'approve': True}, TS).get('code') == 'NOT_PENDING', f'{row} · {n4[:20]}')

        soon = psql("SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date + 5)::text")   # 서울 날짜 기준(서버 UTC 15시 뒤면 하루 다름)
        psql(f"UPDATE hlt_seller_licenses SET expires_at = (now() AT TIME ZONE 'Asia/Seoul')::date + 5 WHERE seller_id = '{sid_}'")
        j1 = call('POST', '/admin/jobs', {'job': 'seller_license_watch'}, TS); w1 = nt('SELLER_LICENSE_EXPIRING')
        call('POST', '/admin/jobs', {'job': 'seller_license_watch'}, TS); w2 = nt('SELLER_LICENSE_EXPIRING')
        psql(f"UPDATE hlt_seller_licenses SET expires_at = (now() AT TIME ZONE 'Asia/Seoul')::date - 1 WHERE seller_id = '{sid_}'")
        j3 = call('POST', '/admin/jobs', {'job': 'seller_license_watch'}, TS); w3 = nt('SELLER_LICENSE_EXPIRING')
        al = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'SELLER_LICENSE_EXPIRED' AND detail::text LIKE '%{CODE}%'")
        st = psql(f"SELECT status FROM hlt_sellers WHERE id = '{sid_}'")
        ok('② 서류 만료 — 7일 안: 판매자 알림 1(통신판매업 · 날짜 · 판매자센터) · 다시 돌려도 그대로 · 만료일 지남: 알림 1 더 · 운영 알림 SELLER_LICENSE_EXPIRED · 자동 정지 없음',
           j1.get('job') == 'seller_license_watch' and w1.startswith('1|') and '통신판매업' in w1 and soon in w1 and w2.startswith('1|') and w3.startswith('2|') and al == '1' and st == 'ACTIVE',
           f'{w1[:50]} · {w2[:3]} · {w3[:3]} · {al} · {st} · {j3.get("detail")}')

        psql(f"INSERT INTO hlt_settlements (seller_id, period_from, period_to, gross_amount, net_amount) VALUES ('{sid_}', current_date - 14, current_date - 7, 12000, 12000)")
        acc2 = call('GET', '/me/health/seller/account', None, TL)
        cl0 = call('POST', '/me/health/seller/close', {'reason': '그만둠'}, TL)
        psql(f"UPDATE hlt_settlements SET status = 'CARRIED' WHERE seller_id = '{sid_}'")
        cl1 = call('POST', '/me/health/seller/close', {'reason': '그만둠'}, TL)
        p3 = prod(); n5 = nt('SELLER_CLOSED')
        ctr = call('GET', '/me/health/seller/center', None, TL); mine2 = call('GET', '/me/health/seller', None, TL)
        ok('② 폐점 — 지급 안 끝난 정산서가 있으면 판매자센터에 미리 보이고 409 SELLER_OPEN_WORK · 끝나면 CLOSED · 판매 중 상품 내림 · 알림 · 판매자센터 403 · 내 입점 CLOSED(사유)',
           any('정산서' in x for x in acc2.get('closeBlockers') or []) and cl0.get('code') == 'SELLER_OPEN_WORK' and cl1.get('status') == 'CLOSED'
           and p3.startswith('A:STOPPED:true') and n5.startswith('1|') and ctr.get('_err') == 403
           and (mine2.get('seller') or {}).get('status') == 'CLOSED' and '본인 폐점 신청' in ((mine2.get('seller') or {}).get('statusReason') or ''),
           f"{acc2.get('closeBlockers')} · {cl0.get('code')} · {cl1.get('status')} · {p3} · {ctr.get('_err')}")
    except Exception as ex:
        ok('② 진행 중 예외 없음', False, str(ex)[:200])
    finally:
        if sid_:
            psql(f"DELETE FROM hlt_settlements WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_product_options WHERE product_id IN (SELECT id FROM hlt_products WHERE seller_id = '{sid_}')")
            psql(f"DELETE FROM hlt_products WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_change_requests WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_seller_rate_changes WHERE seller_id = '{sid_}'")
            psql(f"DELETE FROM hlt_sellers WHERE id = '{sid_}'")
        psql(f"UPDATE site_settings SET value = '{t_sale0}' WHERE key = 'mall.tenant'"); psql(f"UPDATE site_settings SET value = '{t_apply0}' WHERE key = 'mall.tenant_apply'")
    ok('끝 — 되돌림(스위치 처음 값 · 시험 판매자 없음)', sv('mall.tenant') == t_sale0 and sv('mall.tenant_apply') == t_apply0
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE code = '{CODE}'") == '0', f'{t_sale0} · {t_apply0}')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
