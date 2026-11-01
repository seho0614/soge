"""v10.173 시험 — 가입 · 매물 남용 막기 · 사이트 안내 띠 · 시험 결제 주문 정리(D162 · docs/266)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1173.py

  ① 코드 — D162(설정 5 · 공개 3 · 운영 전용 2 · SIGNUP_IP · 지우는 문장 없음 · 200) · 내부 IP · 가입 막기 · IP 상한 · 새 회원 매물 상한 · 정리 API(SUPER · 감사 · 발송 전만)
     · 안내 띠 · 가입 화면 안내 · 운영 화면 단추 · 사전 · 영어 문장 · 명세 · docs/266 · 판
  ② (API · DB) 공개 설정 · 가입 막기 422 · 같은 IP 가입 상한 429(내부 IP 는 안 셈 · IP 원문 저장 안 함) · 새 회원 매물 429 · 정리 → 주문 취소 · 알림 · 회원 403 · 다시 0건
  ③ (화면) 운영 화면 첫 화면 단추 3개 · 오류 없음
"""
import json, os, random, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'
TAG = '%06x' % random.randrange(16 ** 6)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D162_abuse_guard_notice/migration.sql')
ok('① D162 — signup.open · site.notice_bar(_en) 공개 · abuse.* 운영 전용 · SIGNUP_IP · 지우는 문장 없음 · 200 이상',
   "('signup.open', 'on', 'GLOBAL'," in M and "('site.notice_bar', '', 'GLOBAL'," in M and "('site.notice_bar_en', '', 'GLOBAL'," in M
   and "('abuse.signup_per_ip_day', '20', 'ADMIN'," in M and "('abuse.new_member_listings_day', '20', 'ADMIN'," in M and "'SIGNUP_IP'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 200 and 'D162_abuse_guard_notice' in mig, f'{len(mig)} · {mig[-1]}')
G = rd('src/modules/identity/abuse-guard.ts'); A = rd('src/modules/identity/auth.service.ts'); L = rd('src/modules/listing/listing.service.ts')
ok('① 서버 — 내부 IP 판정 · 가입 막기 422 · IP 상한 429(HMAC 키) · 새 회원 매물 상한 429(운영자 제외) · 매물 등록에서 부름',
   'export function isInternalIp(' in G and "'NEW_MEMBER_LIMIT'" in G and "x.role IN ('ADMIN', 'SUPER', 'REVIEWER', 'PAYOUT')" in G
   and "'SIGNUP_CLOSED'" in A and "'SIGNUP_IP_LIMIT'" in A and "isInternalIp(clientIpRaw()) ? null : clientIpKey()" in A and "VALUES ('SIGNUP_IP', $1, now(), 1, now())" in A
   and 'await assertNewMemberListingQuota(this.db, input.ownerAccountId);' in L, '')
C = rd('src/modules/admin/launch-watch.controller.ts'); SV = rd('src/modules/admin/launch-watch.service.ts')
ok('① 정리 API — SUPER · 감사 · 발송 전(PAID · PREPARING)만 · 결제 CANCELED(주문은 DB 가) · 알림 · orderNos',
   "@Post('stub-orders/cancel')\n  @Roles('SUPER')\n  @Audit('LAUNCH_STUB_ORDERS_CANCEL'" in C and "['PAID', 'PREPARING'].includes(r.status)" in SV
   and "SET state = 'CANCELED', pg_status = 'STUB_CLEANUP'" in SV and "'HLT_STUB_ORDER_CANCELED'" in SV and 'o.order_no = ANY($1)' in SV, '')
NB = rd('site/src/components/NoticeBar.tsx'); LY = rd('site/src/app/layout.tsx'); SG = rd('site/src/app/signup/page.tsx'); W = rd('web/src/app/admin/LaunchWatch.tsx')
EN = rd('src/common/i18n/server-text.en.ts')
sko = json.loads(rd('site/src/i18n/messages/ko.json') or '{}').get('signup', {}); sen = json.loads(rd('site/src/i18n/messages/en.json') or '{}').get('signup', {})
scr = {x['id']: x for x in json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']}
ok('① 화면 · 사전 · 영어 · 명세 · 문서 — 안내 띠(레이아웃 맨 위) · 가입 화면 막힘 안내 · 운영 화면 단추 3 · signup.closed ko · en · 영어 문장 3 · API 2',
   "settings['site.notice_bar']" in NB and "settings['site.notice_bar_en']" in NB and '<NoticeBar settings={settings} locale={locale} />' in LY
   and "settings['signup.open'] === 'off'" in SG and 'data-signup-closed' in SG and all(x in W for x in ('data-signup-toggle', 'data-notice-toggle', 'data-stub-cancel'))
   and 'closed' in sko and 'closed' in sen and all(k in EN for k in ('"지금은 새 가입을 잠시 받지 않습니다. 잠시 뒤 다시 시도해 주십시오."', '"같은 곳에서 오늘 가입이 너무 많습니다. 내일 다시 시도해 주십시오."', '"가입한 지 하루가 지나지 않은 회원은 하루 {0}개까지 매물을 등록할 수 있습니다. 내일 다시 시도해 주십시오."'))
   and 'POST /admin/launch-watch/stub-orders/cancel' in scr.get('SB-ADM-DSH-010', {}).get('apis', []) and 'GET /site-settings/public' in scr.get('SB-HOM-AUT-020', {}).get('apis', [])
   and any(f.startswith('266_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 173), rd('VERSION').strip())


# ── ② API · DB ─────────────────────────────────────────────────────────
def call(m, p, b=None, t=None, ip=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    if ip: hd['X-Forwarded-For'] = ip
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


def sv(k):
    return psql(f"SELECT coalesce((SELECT value FROM site_settings WHERE key = '{k}'), '')")


def setv(k, v):
    psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")


def signup(n, ip=None):
    return call('POST', '/auth/signup', {'email': f'abuse_{TAG}_{n}@t.local', 'password': 'Abuse-1234x!', 'name': f'남용시험{n}', 'agreedTerms': []}, ip=ip)


if API and DB:
    keep = {k: sv(k) for k in ('signup.open', 'abuse.signup_per_ip_day', 'abuse.new_member_listings_day', 'mall.order_open')}
    pub = call('GET', '/site-settings/public')
    ok('② 공개 설정 — signup.open · site.notice_bar 있음 · abuse.* 없음', 'signup.open' in pub and 'site.notice_bar' in pub and not any(k.startswith('abuse.') for k in pub), str(pub.get('signup.open')))
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    made = []; mem = None; mc0 = None
    try:
        setv('signup.open', 'off'); r0 = signup(0); setv('signup.open', 'on')
        ok('② 가입 잠시 막기 — 422 SIGNUP_CLOSED', r0.get('_err') == 422 and r0.get('code') == 'SIGNUP_CLOSED', str(r0)[:120])
        ip = f'198.51.100.{random.randrange(2, 250)}'
        setv('abuse.signup_per_ip_day', '2')
        r1, r2, r3 = signup(1, ip), signup(2, ip), signup(3, ip)
        r4 = signup(4)                       # 내부 IP(이 시험 컨테이너) — 세지 않음
        ok('② 같은 IP 하루 가입 상한 2 — 둘은 됨 · 셋째 429 SIGNUP_IP_LIMIT · 내부 IP 는 안 셈', r1.get('accessToken') and r2.get('accessToken') and r3.get('_err') == 429
           and r3.get('code') == 'SIGNUP_IP_LIMIT' and r4.get('accessToken'), f"{r3.get('code')} · {bool(r4.get('accessToken'))}")
        th = psql(f"SELECT count(*) FROM auth_throttle WHERE key_kind = 'SIGNUP_IP' AND hits = 2 AND key_hash ~ '^[0-9a-f]{{64}}$'")
        raw = psql(f"SELECT count(*) FROM auth_throttle WHERE key_hash LIKE '%{ip}%'")
        ok('② 가입 IP 횟수 — HMAC 키 한 줄(hits 2) · IP 원문 없음', th >= '1' and raw == '0', f'{th} · {raw}')
        setv('abuse.signup_per_ip_day', keep['abuse.signup_per_ip_day'] or '20')
        # 새 회원 매물 상한 — 기존 회원을 잠시 「방금 가입」으로 · 상한 = 오늘 이미 등록한 수
        mem = psql("SELECT a.id FROM accounts a WHERE a.email = 'member@t.local'") or psql(
            "SELECT a.id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM account_roles x WHERE x.account_id = a.id AND x.role <> 'MEMBER') ORDER BY a.created_at LIMIT 1")
        mc0 = psql(f"SELECT created_at::text FROM accounts WHERE id = '{mem}'")
        used = int(psql(f"SELECT count(*) FROM listings WHERE owner_account_id = '{mem}' AND created_at > now() - interval '24 hours'") or 0)
        psql(f"UPDATE accounts SET created_at = now() WHERE id = '{mem}'")
        setv('abuse.new_member_listings_day', str(max(used, 1)))
        em = psql(f"SELECT email FROM accounts WHERE id = '{mem}'")
        tm = call('POST', '/auth/login', {'email': em, 'password': 'sgb-test-1234' if em.endswith('@t.local') else PW}).get('accessToken')
        cat = psql("SELECT id FROM categories WHERE gwan_code = 'MNY' AND status = 'APPROVED' AND restricted_code IS NULL ORDER BY name LIMIT 1")
        if used == 0:   # 오늘 등록이 없으면 하나 만들고(내부 IP — 안 셈) 그다음을 막는지 봄
            call('POST', '/listings', {'gwanCode': 'MNY', 'categoryId': cat, 'title': f'V1173 매물 {TAG} 0', 'body': '새 회원 매물 상한 시험 본문입니다.', 'desiredFee': 100000}, tm)
        rl = call('POST', '/listings', {'gwanCode': 'MNY', 'categoryId': cat, 'title': f'V1173 매물 {TAG}', 'body': '새 회원 매물 상한 시험 본문입니다.', 'desiredFee': 100000}, tm, ip=f'203.0.113.{random.randrange(2, 250)}')
        ok('② 새 회원(가입 24시간 안) 매물 상한 — 429 NEW_MEMBER_LIMIT', rl.get('_err') == 429 and rl.get('code') == 'NEW_MEMBER_LIMIT', f"{em} · 오늘 {used} · {str(rl)[:100]}")
        # 시험 결제 주문 정리 — 주문 하나 만들고 시험 결제(stub) PAID → 정리
        BUY = 'buyer@x.com'; bid = psql(f"SELECT id FROM accounts WHERE email = '{BUY}'")
        biv0 = psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE id = '{bid}'")
        TB = call('POST', '/auth/login', {'email': BUY, 'password': PW}).get('accessToken')
        try:
            psql(f"UPDATE accounts SET identity_verified_at = now() WHERE id = '{bid}'"); setv('mall.order_open', 'on')
            dp = psql("SELECT p.code FROM hlt_products p JOIN hlt_sellers s ON s.id = p.seller_id WHERE s.type = 'DIRECT' AND p.status = 'ON_SALE' "
                      "AND (SELECT count(*) FROM hlt_product_options o WHERE o.product_id = p.id AND o.is_active AND o.stock > 5) = 1 ORDER BY p.code LIMIT 1")
            addr = call('GET', '/me/health/addresses', t=TB)
            aid = (addr[0] if isinstance(addr, list) and addr else {}).get('id') or call('POST', '/me/health/addresses', {'receiver': '구매자', 'phone': '010-1234-5678', 'zipcode': '06236', 'addr1': '서울 강남구 테헤란로 1'}, TB).get('id')
            a1 = call('POST', '/health/orders', {'addressId': aid, 'items': [{'productCode': dp, 'qty': 1}]}, TB); no = a1.get('orderNo'); made.append(no)
            oid = psql(f"SELECT id || '|' || total FROM hlt_orders WHERE order_no = '{no}'"); o_id, tot = (oid.split('|') + ['0'])[:2]
            psql(f"INSERT INTO hlt_payments (order_id, method, amount, state, approved_at, stub, payment_key) VALUES ('{o_id}', 'CARD', {tot}, 'PAID', now(), true, 'STUB-T1173-' || md5(random()::text))")
            st0 = psql(f"SELECT status FROM hlt_orders WHERE order_no = '{no}'")
            cm = call('POST', '/admin/launch-watch/stub-orders/cancel', {'orderNos': [no]}, TB)
            c1 = call('POST', '/admin/launch-watch/stub-orders/cancel', {'orderNos': [no]}, T_)
            st1 = psql(f"SELECT o.status || ' ' || p.state FROM hlt_orders o JOIN hlt_payments p ON p.order_id = o.id WHERE o.order_no = '{no}' AND p.stub")
            nt = psql(f"SELECT count(*) FROM notifications WHERE account_id = '{bid}' AND event_code = 'HLT_STUB_ORDER_CANCELED' AND body LIKE '%{no}%'")
            c2 = call('POST', '/admin/launch-watch/stub-orders/cancel', {'orderNos': [no]}, T_)
            ok('② 시험 결제 주문 정리 — 회원 403 · 결제 완료 주문 → 취소(결제 CANCELED) · 주문한 분께 알림 · 다시 부르면 0건',
               bool(no) and st0 == 'PAID' and cm.get('_err') == 403 and c1.get('canceled') == [no] and st1 == 'CANCELED CANCELED' and nt == '1' and c2.get('canceled') == [],
               f"{st0} → {st1} · 알림 {nt} · {c1.get('note')} · {cm.get('_err')} · {c2.get('note')}")
        finally:
            for n_ in [x for x in made if x]:
                psql(f"DELETE FROM notifications WHERE event_code = 'HLT_STUB_ORDER_CANCELED' AND body LIKE '%{n_}%'")
                psql(f"DELETE FROM hlt_payments WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}')")
                psql(f"DELETE FROM hlt_order_items WHERE order_id IN (SELECT id FROM hlt_orders WHERE order_no = '{n_}')")
                psql(f"DELETE FROM hlt_orders WHERE order_no = '{n_}'")
            psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not biv0 else repr(biv0) + '::timestamptz')} WHERE id = '{bid}'")
        if ADMIN_WEB:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b_ = p.chromium.launch(); pg = b_.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                    pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                    pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                    pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(2500)
                    su = pg.locator('[data-signup-toggle]').count(); nb = pg.locator('[data-notice-toggle]').count(); dg = pg.locator('[data-digest-show]').count()
                    pg.screenshot(path=os.path.join(HERE, 'v1173_admin_watch.png'), full_page=False)
                    b_.close()
                ok('③ 운영 화면 첫 화면 — 가입 잠시 막기 · 안내 띠 · 어제 요약 단추 · 오류 없음', su == 1 and nb == 1 and dg == 1 and not errs, f'{su} · {nb} · {dg} · {errs[:2]}')
    finally:
        for k, v in keep.items():
            if v: setv(k, v)
        if mem and mc0:
            psql(f"UPDATE accounts SET created_at = '{mc0}'::timestamptz WHERE id = '{mem}'")
    ok('끝 — 되돌림(설정 처음 값)', all(sv(k) == v for k, v in keep.items() if v), str({k: sv(k) for k in keep}))
else:
    print('  (API · DB 없음 — ② · ③ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
