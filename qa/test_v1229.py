"""v10.229 (docs/367) — 소개몰 입점 열기 준비 점검(운영 「소개몰 판매자」 탭 맨 위 · 읽기만)

  ① (코드) 서비스 readiness(입점 약관 지금 판 · 초안 빈칸 · 결제 실연동 · 하위가맹점 · 지급대행 · 주문 받기 · 승인 판매자 · 시험 번호 뺌 · 업종 정정신고 확인 줄) ·
     API GET /admin/health/tenant/readiness(ADMIN · SUPER · 응답 스키마) · 화면 HealthTenantReady(탭 맨 위) · 명세 · 문서 367 · 판
  ② (API) 운영자만(회원 403) · 줄 8개 · 묶음 apply 2 · sale 6 · 값이 DB 설정 · 약관 · 판매자 수와 같음 · 준비됨 판단(업종 정정신고 줄 빼고) · 읽기만(설정 그대로)
  ③ (화면) 「소개몰 판매자」 탭 맨 위 「입점 열기 준비」 두 묶음 · 줄 8개 · 화면 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
KEYS = ['terms', 'apply-switch', 'payment', 'submerchant', 'order', 'sellers', 'biz-report', 'sale-switch']


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ──────────────────────────────────────────────────────────────
SV, CT = rd('src/modules/health/health-tenant.service.ts'), rd('src/modules/health/health-tenant.controller.ts')
ok('① 서비스 — 약관 지금 판(v_terms_current) · 초안 빈칸(〔시행일〕 뺌) · 결제 키 + 간주 모드 · 하위가맹점 공급자(시험 공급자는 준비 아님) · 주문 받기 · 승인 판매자 · 시험 번호 뺌 · 업종 정정신고는 준비 판단에서 뺌',
   'async readiness()' in SV and "FROM v_terms_current WHERE code = 'HLT_SELLER'" in SV and "filter((h) => h !== '〔시행일〕')" in SV
   and 'process.env.TOSS_SECRET_KEY' in SV and "key = 'assume.payment'" in SV and 'resolveSubmerchantProvider(!!r?.assume)' in SV and '!!sub && !sub.stub' in SV
   and '${ORDER_OPEN_SQL}' in SV and "NOT LIKE 'STUB-%'" in SV and ("x.key !== 'biz-report'" in SV or "const bizOk = !!r?.bizNo && !!r?.bizAt" in SV)
   and all(f"key: '{k}'" in SV for k in KEYS), '')
ok('① API — GET admin/health/tenant/readiness · ADMIN · SUPER · 응답 스키마 TenantReadinessDto',
   "@Get('admin/health/tenant/readiness')\n  @Roles('ADMIN', 'SUPER')" in CT and '@ApiOkResponse({ type: TenantReadinessDto })' in CT and 'export class TenantReadyRowDto' in CT, '')
RW, HT = rd('web/src/app/admin/HealthTenantReady.tsx'), rd('web/src/app/admin/HealthSellerTab.tsx')
ok('① 화면 — 「소개몰 판매자」 탭 맨 위(신청 심사 위) · 두 묶음 · 준비됨 / 막힘 · 읽기만(단추 없음)',
   "useApi<Ready>('/admin/health/tenant/readiness')" in RW and 'data-tenant-ready=""' in RW and 'data-tenant-ready-group={g}' in RW and 'data-tenant-ready-row={r.key}' in RW
   and ('<button' not in RW or "r.key === 'biz-report' && isSuper" in RW) and HT.index('<HealthTenantReady />') < HT.index('<HealthTenantApply />'), '')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}'); sc = {s['id']: s for s in SJ.get('screens', [])}
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('367_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 명세 SB-ADM-HSL-010 · 문서 367 · 판 v10.229 이상',
   'GET /admin/health/tenant/readiness' in sc.get('SB-ADM-HSL-010', {}).get('apis', []) and bool(DOC)
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 229), f'{DOC} · {rd("VERSION").strip()}')


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


# ── ② API ──────────────────────────────────────────────────────────────
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    for e in ('admin@x.com', 'buyer@x.com'): consent_ok.agree(e, PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    snap = lambda: psql("SELECT string_agg(key || '=' || coalesce(value, 'NULL'), ',' ORDER BY key) FROM site_settings WHERE key IN ('mall.tenant', 'mall.tenant_apply', 'mall.order_open', 'assume.payment')")
    s0 = snap()
    rb = call('GET', '/admin/health/tenant/readiness', None, TB)
    d = call('GET', '/admin/health/tenant/readiness', None, TS)
    rows = {x.get('key'): x for x in (d.get('rows') or [])}
    ok('② 운영자만 — 회원 403 · 운영자 줄 8개(apply 2 · sale 6) · 상태 ok · todo · info 만',
       rb.get('_err') == 403 and d.get('_err') is None and list(rows) == KEYS
       and [x['group'] for x in d['rows']] == ['apply', 'apply'] + ['sale'] * 6 and all(x.get('state') in ('ok', 'todo', 'info') for x in d['rows']),
       f"{rb.get('_err')} · {list(rows)} · {d.get('_err')} {d.get('code')}")
    db = dict(x.split('=', 1) for x in (s0 or '').split(',') if '=' in x)
    cur = psql("SELECT version FROM v_terms_current WHERE code = 'HLT_SELLER' LIMIT 1")
    act = psql("SELECT count(*) FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'ACTIVE'")
    pend = psql("SELECT count(*) FROM hlt_sellers WHERE type IN ('TENANT', 'BRAND') AND status = 'PENDING'")
    assume = db.get('assume.payment', 'off') == 'on'
    order_on = db.get('mall.order_open', 'on') == 'on'
    st = lambda k: rows.get(k, {}).get('state')
    nw = lambda k: rows.get(k, {}).get('now', '')
    ok('② 값이 DB 와 같음 — 약관 지금 판 · 스위치 · 심사 대기 수 · 간주 모드 · 주문 받기 · 승인 판매자 수 · 업종 정정신고는 늘 확인 줄',
       st('terms') == ('ok' if cur else 'todo') and (not cur or cur in nw('terms'))
       and nw('apply-switch').startswith('켜짐' if db.get('mall.tenant_apply') == 'on' else '꺼짐') and f'심사 기다림 {pend}건' in nw('apply-switch')
       and (('간주 모드 켜짐' in nw('payment')) if assume else True) and (st('payment') == 'todo' if assume else True)
       and st('submerchant') == 'todo' and (('시험 공급자' in nw('submerchant')) if assume else ('연동 전' in nw('submerchant')))
       and st('order') == ('ok' if order_on else 'todo') and nw('sellers').startswith(f'{act}명') and st('sellers') == ('ok' if act != '0' else 'todo')
       and st('biz-report') == 'todo' and nw('sale-switch') == ('켜짐' if db.get('mall.tenant') == 'on' else '꺼짐'),
       f"{cur or '약관 없음'} · {db} · {act}/{pend} · " + ' | '.join(f"{k}:{st(k)}:{nw(k)[:30]}" for k in KEYS))
    ok('② 준비됨 판단 — 신청 받기 = 약관 지금 판 · 판매 열기 = 막힘 없음(업종 정정신고 줄 빼고 · 지금은 하위가맹점 연동 전이라 늘 아직) · 스위치 표시 · 읽기만(설정 그대로)',
       d.get('applyReady') == bool(cur) and d.get('saleReady') is False
       and d.get('applyOn') == (db.get('mall.tenant_apply') == 'on') and d.get('saleOn') == (db.get('mall.tenant') == 'on') and snap() == s0,
       f"{d.get('applyReady')} {d.get('saleReady')} {d.get('applyOn')} {d.get('saleOn')}")

    # ── ③ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
            pg.goto(ADMIN_WEB + '/#/hlt-sellers', wait_until='networkidle', timeout=120000)
            pg.reload(wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-hlt-seller-tab] [data-tenant-ready]')
            seen = (box.count(), pg.locator('[data-tenant-ready-group]').count(), pg.locator('[data-tenant-ready-row]').count(),
                    pg.locator('[data-tenant-ready-group="sale"]').get_attribute('data-ready') if pg.locator('[data-tenant-ready-group="sale"]').count() else None,
                    '입점 열기 준비' in (box.inner_text() if box.count() else ''))
            pg.screenshot(path=os.path.join(HERE, 'v1229_tenant_ready.png'), full_page=False)
            b.close()
        ok('③ 「소개몰 판매자」 탭 맨 위 「입점 열기 준비」 — 두 묶음 · 줄 8개 · 판매 열기 아직 · 화면 오류 없음', seen == (1, 2, 8, '0', True) and not errs, f'{seen} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ③ 건너뜀)')
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
