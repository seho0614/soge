"""v10.165 시험 — 소개몰 입점 1단계: 입점 신청 · 서류 · 운영 심사 · 입점 약관 초안(꺼진 채로 · D155 · docs/256)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1165.py

  ① 코드 — D155(칸 · REJECTED 사유 · 회원당 하나 · 서류 종류 · 번호표 · 설정 off · HLT_SELLER 1.0 초안 〔…〕 · 판매대금 직접 귀속 · 지우는 문장 없음 · 193) ·
     서버(꺼짐 · 본인확인 · 동의 · 개인 · 사업자 · 브랜드 증빙 · 승인 · 반려 · 감사) · 운영 화면 · 사용자 웹 · 사전 ko · en · 명세 · 영어 · docs/256 · 판
  ② (API · DB) 꺼짐 422 TENANT_OFF · 켬 + 약관 미게시 422 TENANT_CONSENT_REQUIRED · 형식 400 · 신청 줄 → /me/health/seller · 운영 목록 ·
     반려(사유 없음 400 · 회원 403) → 사유 보임 · 반려 뒤 승인 409 · 승인(수수료율 · 서류 확인) · REJECTED 사유 없음 · 회원당 둘 DB 가 막음 · 되돌림
  ③ (화면) 사용자 웹 /health/seller 꺼짐 안내 · 운영 화면 #/hlt-settle 「입점 신청」 부품 · 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

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
M = rd('prisma/migrations/D155_mall_tenant_apply/migration.sql')
ok('① D155 — 칸 5개 · 상태 REJECTED · 반려 사유 · 회원당 입점 하나 · 서류 COSMETIC · BRAND_RIGHT · 번호표 · 설정 off · HLT_SELLER 1.0 초안(〔…〕 · 직접 귀속 · 반품 상한) · 지우는 문장 없음',
   all(f'ADD COLUMN IF NOT EXISTS {c}' in M for c in ('personal', 'applied_at', 'reviewed_by', 'reviewed_at', 'reject_reason'))
   and "'REJECTED'::text]" in M and 'ck_hlt_sellers_reject_reason' in M and 'CREATE UNIQUE INDEX IF NOT EXISTS idx_hlt_seller_account' in M
   and "'COSMETIC'::text, 'BRAND_RIGHT'::text" in M and 'CREATE SEQUENCE IF NOT EXISTS public.hlt_seller_code_seq' in M
   and "('mall.tenant', 'off'," in M and "'HLT_SELLER', '1.0'" in M and "'DRAFT'" in M and '〔시행일〕' in M
   and '판매자의 하위가맹점 계정으로 귀속' in M and '6,000원을 넘을 수 없음' in M and '회사 수취 후 정산' not in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M), '')
ok('① 마이그레이션 수 193 이상 · D155 가 있음', len(mig) >= 193 and 'D155_mall_tenant_apply' in mig, f'{len(mig)} · {mig[-1]}')
TS = rd('src/modules/health/health-tenant.service.ts'); TC = rd('src/modules/health/health-tenant.controller.ts'); AM = rd('src/app.module.ts')
ok('① 서버 — 꺼짐 · 본인확인 · 동의(HLT_SELLER) · 개인 · 사업자번호 · 브랜드 증빙 · 다시 신청 · 승인(서류 확인) · 반려 사유 · 감사 3 · 모듈',
   all(f"'{c}'" in TS for c in ('TENANT_OFF', 'IDENTITY_REQUIRED', 'TENANT_CONSENT_REQUIRED', 'SELLER_EXISTS', 'SELLER_BLOCKED', 'BIZ_REG_REQUIRED', 'BRAND_PROOF_REQUIRED', 'NOT_PENDING', 'REASON_REQUIRED'))
   and "WHERE t.code = 'HLT_SELLER'" in TS and "key = 'mall.tenant'" in TS and 'UPDATE hlt_seller_licenses SET verified_by' in TS
   and TC.count('@Audit(') >= 3 and "@Post('me/health/seller')" in TC and "@Get('admin/health/sellers/applications')" in TC
   and "@Post('admin/health/sellers/:id/approve')" in TC and "@Post('admin/health/sellers/:id/reject')" in TC and '@StrictBoolean() personal' in TC
   and 'HealthTenantController' in AM and 'HealthTenantService' in AM, '')
WA = rd('web/src/app/admin/HealthTenantApply.tsx'); WS = rd('web/src/app/admin/HealthSettle.tsx') + rd('web/src/app/admin/HealthSellerTab.tsx')   # v10.224 — 입점 심사는 「소개몰 판매자」 탭
SA = rd('site/src/components/health/SellerApply.tsx'); SP = rd('site/src/app/health/seller/page.tsx')
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}').get('tenant', {}); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}').get('tenant', {})
SPEC = json.load(open(os.path.join(K, 'spec/screens.json'), encoding='utf-8')).get('screens') or []
scr = {x.get('id'): x for x in SPEC}
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 화면 · 명세 · 영어 — 운영 「입점 신청」(승인 · 반려) · 사용자 웹 신청(개인 · 서류 · 약관 · 본인확인) · 꺼짐 안내 · 사전 ko · en 같은 칸 · 명세 · 영어 9 · docs/256 · 판',
   "'/admin/health/sellers/applications'" in WA and '/approve' in WA and '/reject' in WA and '<HealthTenantApply />' in WS
   and "fetch('/api/v1/me/health/seller'" in SA and 'data-tenant-personal' in SA and '/terms/HLT_SELLER' in SA and 'data-tenant-off' in SP
   and ko and set(ko) == set(en) and set(ko.get('kind', {})) == set(en.get('kind', {}))
   and all(a in (scr.get('SB-HLT-SEL-010') or {}).get('apis', []) for a in ('GET /health/tenant/config', 'GET /me/health/seller', 'POST /me/health/seller'))
   and all(a in (scr.get('SB-ADM-HST-010') or {}).get('apis', []) for a in ('GET /admin/health/sellers/applications', 'POST /admin/health/sellers/{id}/approve', 'POST /admin/health/sellers/{id}/reject'))
   and '"소개몰 입점 신청이 아직 열리지 않았습니다.":' in EN and '"반려 사유를 적어 주십시오 — 신청자에게 그대로 보입니다.":' in EN
   and any(f.startswith('256_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 165), rd('VERSION').strip())


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


MEM = 'seller@x.com'; CODE = 'TN-T1165'
APPLY = {'type': 'TENANT', 'name': '시험 입점 가게', 'personal': True, 'ceoName': '홍길동', 'csTel': '02-000-0000', 'returnAddr': '서울 강남구 테헤란로 1',
         'licenses': [{'kind': 'ECOM_REG', 'licenseNo': '2026-서울강남-0001'}]}
setting = lambda: psql("SELECT value FROM site_settings WHERE key = 'mall.tenant'")
if API and DB:
    s0 = setting(); mid = psql(f"SELECT id FROM accounts WHERE email = '{MEM}'")
    iv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{mid}'")
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TM = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
    try:
        psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND'))")
        psql(f"DELETE FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql("UPDATE site_settings SET value = 'off' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        c0 = call('GET', '/health/tenant/config'); r0 = call('POST', '/me/health/seller', APPLY, TM)
        ok('② 처음 꺼짐 — config enabled=false · 신청 422 TENANT_OFF', c0.get('enabled') is False and r0.get('code') == 'TENANT_OFF', f"{c0} · {r0.get('code')}")
        psql("UPDATE site_settings SET value = 'on' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{mid}'")
        r1 = call('POST', '/me/health/seller', APPLY, TM)
        r2 = call('POST', '/me/health/seller', {**APPLY, 'personal': False, 'bizRegNo': '1234567890'}, TM)
        r3 = call('POST', '/me/health/seller', {**APPLY, 'personal': 'true'}, TM)
        cur = psql("SELECT count(*) FROM v_terms_current WHERE code = 'HLT_SELLER'")
        ok('② 켬 + 입점 약관 미게시 → 422 TENANT_CONSENT_REQUIRED · 사업자번호 형식 400 · personal 글자 400 · 신청 줄 없음',
           cur == '0' and r1.get('code') == 'TENANT_CONSENT_REQUIRED' and r2.get('_err') == 400 and r3.get('_err') == 400
           and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{mid}' AND type = 'TENANT'") == '0', f"{r1.get('code')} · {r2.get('_err')} · {r3.get('_err')} · 지금 판 {cur}")
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at) "
                   f"VALUES ('{CODE}', '{mid}', 'TENANT', '시험 입점 가게', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'PENDING', now()) RETURNING id").splitlines()[0]
        psql(f"INSERT INTO hlt_seller_licenses (seller_id, kind, license_no) VALUES ('{sid}', 'ECOM_REG', '2026-서울강남-0001')")
        m1 = call('GET', '/me/health/seller', t=TM); s1 = m1.get('seller') or {}
        lst = call('GET', '/admin/health/sellers/applications', t=T_); row = next((x for x in (lst if isinstance(lst, list) else []) if x.get('id') == sid), {})
        ok('② 신청 줄 → /me/health/seller(PENDING · 개인 · 서류 1 · 본인확인 · 동의 false) · 운영 목록(신청 회원 · 서류)',
           s1.get('status') == 'PENDING' and s1.get('personal') is True and len(s1.get('licenses') or []) == 1 and m1.get('identityVerified') is True and m1.get('consent') is False
           and row.get('accountEmail') == MEM and len(row.get('licenses') or []) == 1, f"{s1.get('status')} · {row.get('accountEmail')}")
        rm = call('POST', f'/admin/health/sellers/{sid}/reject', {'reason': '서류가 흐립니다'}, TM)
        re0 = call('POST', f'/admin/health/sellers/{sid}/reject', {'reason': ''}, T_)
        re1 = call('POST', f'/admin/health/sellers/{sid}/reject', {'reason': '통신판매업 신고증 번호를 다시 확인해 주십시오.'}, T_)
        m2 = call('GET', '/me/health/seller', t=TM)
        ap0 = call('POST', f'/admin/health/sellers/{sid}/approve', {}, T_)
        ok('② 반려 — 회원 403 · 사유 없음 400 · 사유 → REJECTED · 신청자에게 사유 보임 · 반려 뒤 승인 409 NOT_PENDING',
           rm.get('_err') == 403 and re0.get('_err') == 400 and re1.get('status') == 'REJECTED'
           and (m2.get('seller') or {}).get('rejectReason', '').startswith('통신판매업') and ap0.get('code') == 'NOT_PENDING', f"{rm.get('_err')} · {re0.get('_err')} · {re1} · {ap0.get('code')}")
        psql(f"UPDATE hlt_sellers SET status = 'PENDING', reject_reason = NULL, reviewed_at = NULL, reviewed_by = NULL WHERE id = '{sid}'")
        ap1 = call('POST', f'/admin/health/sellers/{sid}/approve', {'commissionRate': 12}, T_)
        st = psql(f"SELECT status || '|' || commission_rate || '|' || (reviewed_by IS NOT NULL) || '|' || (SELECT count(*) FROM hlt_seller_licenses WHERE seller_id = '{sid}' AND verified_at IS NOT NULL) FROM hlt_sellers WHERE id = '{sid}'")
        rx = call('POST', '/me/health/seller', APPLY, TM)
        ok('② 승인 — ACTIVE · 수수료율 12 · 처리자 · 서류 확인 1 · 승인된 회원이 다시 신청하면 409 SELLER_EXISTS(약관 동의 검사보다 먼저)',
           ap1.get('status') == 'ACTIVE' and st == 'ACTIVE|12.00|true|1' and rx.get('code') == 'SELLER_EXISTS', f"{st} · {rx.get('code')}")
        e1, m_1 = psql_err(f"UPDATE hlt_sellers SET status = 'REJECTED', reject_reason = NULL WHERE id = '{sid}'")
        e2, m_2 = psql_err(f"INSERT INTO hlt_sellers (code, account_id, type, name, status) VALUES ('TN-T1165B', '{mid}', 'BRAND', 'x', 'PENDING')")
        ok('② DB — 사유 없는 반려 막음 · 한 회원 입점 판매자 둘 막음', e1 != 0 and 'ck_hlt_sellers_reject_reason' in m_1 and e2 != 0 and 'idx_hlt_seller_account' in m_2, f'{m_1[:60]} · {m_2[:60]}')
        if SITE or ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch()
                    if ADMIN_WEB:
                        psql(f"UPDATE hlt_sellers SET status = 'PENDING', reviewed_at = NULL, reviewed_by = NULL WHERE id = '{sid}'")
                        pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                        pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                        pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                        pg.goto(ADMIN_WEB + ('/#/hlt-sellers' if os.path.exists(os.path.join(K, 'web/src/app/admin/HealthSellerTab.tsx')) else '/#/hlt-settle'), wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)   # v10.224 탭 옮김
                        box = pg.locator('[data-tenant-apply]').count(); card = pg.locator(f'[data-tenant="{sid}"]').count()
                        if card: pg.locator(f'[data-tenant="{sid}"]').scroll_into_view_if_needed()
                        pg.screenshot(path=os.path.join(HERE, 'v1165_admin_tenant.png'), full_page=False)
                        ok('③ 운영 화면 #/hlt-settle — 「입점 신청」 부품 · 시험 신청 카드(승인 · 반려) · 오류 없음', box == 1 and card == 1 and not errs, f'{box} · {card} · {errs[:2]}')
                    if SITE:
                        psql("UPDATE site_settings SET value = 'off' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
                        pg = b_.new_page(viewport={'width': 1300, 'height': 900})
                        pg.goto(SITE + '/health/seller', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1200)
                        off = pg.locator('[data-tenant-off]').count()
                        pg.screenshot(path=os.path.join(HERE, 'v1165_site_seller_off.png'), full_page=False)
                        ok('③ 사용자 웹 /health/seller — 꺼짐이면 「아직 열리지 않음」 안내', off == 1, str(off))
                    b_.close()
    finally:
        psql(f"DELETE FROM hlt_seller_licenses WHERE seller_id IN (SELECT id FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND'))")
        psql(f"DELETE FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')")
        psql(f"UPDATE site_settings SET value = '{s0 or 'off'}' WHERE key = ANY(ARRAY['mall.tenant', 'mall.tenant_apply'])")
        psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not iv0 else repr(iv0) + '::timestamptz')} WHERE id = '{mid}'")
    ok('끝 — 되돌림(설정 처음 값 · 시험 판매자 없음 · 본인확인 처음 값)', setting() == (s0 or 'off')
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{mid}' AND type IN ('TENANT','BRAND')") == '0'
       and psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{mid}'") == iv0, setting())
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
