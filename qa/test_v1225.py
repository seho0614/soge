"""v10.225 (docs/361) — 소개몰 안내 띠(판매 중지 · 입점 판매 · 입점 신청)

  ① (코드) HltNoticeBand(띠 종류 · /cart-count 로 로그인 확인 · 장바구니 · 주문 · 입점 화면 빼기 · 닫기) · HltNav · 소개몰 첫 화면 · 사전 ko · en · 문서 361
  ② (API) 주문 받기 · 입점 스위치가 공개 설정 API 에 그대로 나옴
  ③ (화면) 손님: 주문 꺼짐 띠(첫 화면 · 직판관) · 켜면 띠 없음 / 장바구니(회원)는 화면 안내만 /
     회원: 입점 신청 아직 안 열림(닫기 → 다시 열어도 닫힘) · 열리면 「입점 신청」 링크 /
     판매자: 입점 판매 꺼짐 · 정지(사유) · 입점 화면에서는 판매자 띠 없음 / 1400 · 390 · 가로 넘침 없음 · 화면 오류 없음
  자료: 시험 회원은 매번 새 이메일 · 설정은 처음 값으로(두 번 돌려도 같음)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

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


# ── ① 코드 ──────────────────────────────────────────────────────────────
NB, HP, GW = rd('site/src/components/health/HltNoticeBand.tsx'), rd('site/src/components/health/HltParts.tsx'), rd('site/src/app/[gwan]/page.tsx')
ok('① 띠 부품 — 주문 꺼짐 · 판매자(정지 · 제한 · 폐점 · 심사 · 판매 꺼짐) · 입점 신청(받음 · 안 열림) · /cart-count 로 로그인 확인 · 장바구니 · 주문 · 입점 화면 빼기 · 닫기(sessionStorage)',
   all(f"kind: '{k}'" in NB for k in ('order-off', 'seller-paused', 'seller-blocked', 'seller-closed', 'seller-pending', 'sale-off', 'apply-on', 'apply-off'))
   and "getJson('/cart-count')" in NB and "'/api/v1/health/order-config'" in NB and "'/api/v1/health/tenant/config'" in NB and "'/api/v1/me/health/seller'" in NB
   and "under(p, '/health/cart')" in NB and "under(p, '/health/order')" in NB and "under(p, '/health/seller')" in NB and 'sessionStorage' in NB and 'data-hlt-band={b.kind}' in NB, '')
ok('① 붙는 곳 — HltNav(소개몰 하위 화면) · 소개몰 첫 화면(ShopMain 위)',
   '<HltBand />' in HP and 'export function HltBand()' in HP and "useTranslations('hlt.band')" in HP and '<HltBand />\n        <ShopMain />' in GW, '')
ko = json.loads(rd('site/src/i18n/messages/ko/hlt.json') or '{}').get('band', {}); en = json.loads(rd('site/src/i18n/messages/en/hlt.json') or '{}').get('band', {})
KEYS = ('orderOff', 'saleOff', 'paused', 'blocked', 'closed', 'pending', 'applyOn', 'applyOff', 'center', 'apply', 'view', 'dismiss', 'aria')
ok('① 사전 ko · en — 띠 13줄 · 사유 자리 {reason} · 영어에 operator 없음',
   all(ko.get(k) and en.get(k) for k in KEYS) and all('{reason}' in ko[k] and '{reason}' in en[k] for k in ('paused', 'blocked', 'closed'))
   and 'operator' not in json.dumps(en).lower(), f'{len(ko)} · {len(en)}')
CSS = rd('site/src/styles/health.css')
ok('① 띠 모양 — .hlt-band warn · info · muted · 누름 44px', '.hlt-band.warn' in CSS and '.hlt-band.info' in CSS and '.hlt-band.muted' in CSS and 'min-height: 44px' in CSS, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('361_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 361 · 판 v10.225 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 225), f'{DOC} · {rd("VERSION").strip()}')


# ── ② API ──────────────────────────────────────────────────────────────
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
MEM, SEL = f't1225mem{stamp}@x.com', f't1225sel{stamp}@x.com'
CODE = f'TN-T1225-{stamp}'
seen = {}
if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    sv = lambda k: psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")
    setv = lambda k, v: psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
    o0, ta0, ts0 = sv('mall.order_open'), sv('mall.tenant_apply'), sv('mall.tenant')
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    for e in (MEM, SEL):
        psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{e}', '시험1225', '{pw}', now()) ON CONFLICT DO NOTHING")
        consent_ok.agree(e, PW)
    ids = {e: psql(f"SELECT id FROM accounts WHERE email = '{e}'") for e in (MEM, SEL)}
    sid = ''
    try:
        setv('mall.order_open', 'off'); setv('mall.tenant_apply', 'off'); setv('mall.tenant', 'off')
        c1, t1 = call('GET', '/health/order-config'), call('GET', '/health/tenant/config')
        setv('mall.tenant_apply', 'on')
        t2 = call('GET', '/health/tenant/config')
        setv('mall.tenant_apply', 'off')
        ok('② 공개 설정 — 주문 꺼짐 open false · 입점 신청 · 판매 꺼짐 enabled · saleOpen false · 신청 켜면 enabled true',
           c1.get('open') is False and t1.get('enabled') is False and t1.get('saleOpen') is False and t2.get('enabled') is True, f'{c1} · {t1} · {t2}')
        dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                  "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 ORDER BY p.code LIMIT 1")
        tm = call('POST', '/auth/login', {'email': MEM, 'password': PW}).get('accessToken')
        if dp and not dp.startswith('!'): call('POST', '/me/health/cart', {'productCode': dp, 'qty': 1}, tm)
        sid = psql(f"INSERT INTO hlt_sellers (code, account_id, type, name, personal, ceo_name, cs_tel, return_addr, status, applied_at, reviewed_at) "
                   f"VALUES ('{CODE}', '{ids[SEL]}', 'TENANT', '시험 가게 1225', true, '홍길동', '02-000-0000', '서울 강남구 테헤란로 1', 'ACTIVE', now(), now()) RETURNING id").splitlines()[0]
    except Exception as ex:
        ok('② 진행 중 예외 없음', False, str(ex)[:200])

    # ── ③ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if SITE and sync_playwright and sid and not sid.startswith('!'):
        errs = []
        bands = lambda pg: pg.eval_on_selector_all('[data-hlt-band]', 'els => els.map(e => e.getAttribute("data-hlt-band"))')
        over = lambda pg: pg.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')

        def go(pg, path, wait=2500):
            pg.goto(SITE + path, wait_until='networkidle', timeout=120000); pg.wait_for_timeout(wait)

        def login(ctx, email):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            go(pg, '/login', 500)
            pg.fill('input[name=email]', email); pg.fill('input[name=password]', PW); pg.click('form.auth button'); pg.wait_for_timeout(2500)
            return pg
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                # 손님 — 주문 꺼짐
                for w in (1400, 390):
                    ctx = b.new_context(viewport={'width': w, 'height': 900}); pg = ctx.new_page()
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    go(pg, '/health'); main_ = bands(pg)
                    if w == 390: pg.screenshot(path=os.path.join(HERE, 'v1225_band_order_off_390.png'), full_page=False)
                    go(pg, '/health/direct'); direct = bands(pg); ov = over(pg)
                    seen[f'guest{w}'] = (main_, direct, ov)
                    ctx.close()
                ctx = b.new_context(viewport={'width': 1400, 'height': 900}); pg = login(ctx, MEM)
                go(pg, '/health/cart'); seen['cart'] = (bands(pg), pg.locator('[data-orders-closed]').count())
                ctx.close()
                setv('mall.order_open', 'on')
                ctx = b.new_context(viewport={'width': 1400, 'height': 900}); pg = ctx.new_page()
                go(pg, '/health'); seen['guestOn'] = bands(pg); ctx.close()
                # 회원 — 입점 신청 안 열림 → 닫기 → 열림
                for w in (1400, 390):
                    ctx = b.new_context(viewport={'width': w, 'height': 900}); pg = login(ctx, MEM)
                    go(pg, '/health/direct'); b0 = bands(pg); ov = over(pg)
                    if w == 1400: pg.screenshot(path=os.path.join(HERE, 'v1225_band_apply_off.png'), full_page=False)
                    x = pg.locator('[data-hlt-band-x]')
                    if x.count(): x.first.click(); pg.wait_for_timeout(300)
                    b1 = bands(pg)
                    go(pg, '/health/guide'); b2 = bands(pg)
                    seen[f'mem{w}'] = (b0, b1, b2, ov)
                    ctx.close()
                setv('mall.tenant_apply', 'on')
                ctx = b.new_context(viewport={'width': 1400, 'height': 900}); pg = login(ctx, MEM)
                go(pg, '/health/direct'); lk = pg.locator('[data-hlt-band="apply-on"] a')
                seen['memOn'] = (bands(pg), lk.get_attribute('href') if lk.count() else None)
                ctx.close()
                setv('mall.tenant_apply', 'off')
                # 판매자 — 입점 판매 꺼짐 · 정지(사유) · 입점 화면은 판매자 띠 없음
                ctx = b.new_context(viewport={'width': 390, 'height': 900}); pg = login(ctx, SEL)
                go(pg, '/health/direct'); s0 = bands(pg); ov = over(pg)
                go(pg, '/health/seller'); s1 = bands(pg)
                psql(f"UPDATE hlt_sellers SET status = 'PAUSED', status_reason = '서류 확인 1225' WHERE id = '{sid}'")
                go(pg, '/health/direct'); s2 = bands(pg)
                txt = pg.locator('[data-hlt-band="seller-paused"]')
                pg.screenshot(path=os.path.join(HERE, 'v1225_band_seller_paused_390.png'), full_page=False)
                seen['sel'] = (s0, s1, s2, '서류 확인 1225' in (txt.inner_text() if txt.count() else ''), ov)
                ctx.close()
                b.close()
        except Exception as ex:
            errs.append(str(ex)[:200])
        for w in (1400, 390):
            g = seen.get(f'guest{w}')
            ok(f'③ {w}px 손님 · 주문 꺼짐 — 첫 화면 · 직판관에 주문 꺼짐 띠만 · 가로 넘침 없음', g == (['order-off'], ['order-off'], False), str(g))
        ok('③ 장바구니(회원 · 직판 상품 1 · 주문 꺼짐) — 주문 꺼짐 띠 없이 화면 안내(data-orders-closed) · 입점 신청 띠만', seen.get('cart') == (['apply-off'], 1), str(seen.get('cart')))
        ok('③ 주문 켜면 띠 없음(손님)', seen.get('guestOn') == [], str(seen.get('guestOn')))
        for w in (1400, 390):
            m = seen.get(f'mem{w}')
            ok(f'③ {w}px 회원 · 입점 신청 안 열림 띠 → 닫기 → 다른 화면에서도 닫힘 · 가로 넘침 없음', m == (['apply-off'], [], [], False), str(m))
        ok('③ 입점 신청 열리면 「입점 신청」 띠 · 링크 /health/seller', seen.get('memOn') == (['apply-on'], '/health/seller'), str(seen.get('memOn')))
        ok('③ 390px 판매자 — 입점 판매 꺼짐 띠 · 입점 화면에서는 판매자 띠 없음 · 정지면 정지 띠(사유) · 가로 넘침 없음',
           seen.get('sel') == (['sale-off'], [], ['seller-paused'], True, False), str(seen.get('sel')))
        ok('③ 화면 오류 없음', not errs, str(errs[:3]))
    else:
        ok('③ 화면 — playwright · SITE · 시험 판매자 필요', False, f'{bool(sync_playwright)} · {sid[:40]}')
    setv('mall.order_open', o0 or 'on'); setv('mall.tenant_apply', ta0 or 'off'); setv('mall.tenant', ts0 or 'off')
    psql(f"DELETE FROM hlt_cart_items WHERE account_id = '{ids[MEM]}'")
    if sid and not sid.startswith('!'):
        psql(f"UPDATE hlt_sellers SET status = 'CLOSED', status_reason = '시험 정리', account_id = NULL WHERE id = '{sid}'")
    ok('끝 — 되돌림(주문 받기 · 입점 신청 · 판매 처음 값 · 시험 판매자 폐점 · 회원 연결 끊음)',
       (sv('mall.order_open'), sv('mall.tenant_apply'), sv('mall.tenant')) == (o0 or 'on', ta0 or 'off', ts0 or 'off')
       and psql(f"SELECT count(*) FROM hlt_sellers WHERE account_id = '{ids[SEL]}'") == '0', f"{sv('mall.order_open')} · {sv('mall.tenant_apply')} · {sv('mall.tenant')}")
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
