"""v10.148 시험 — 오픈 전체 리허설 · 카드 등록 창(docs/228)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1148.py

  ① 코드 — 카드 등록 창(requestBillingAuth · customerKey · 성공 · 실패 주소) · 돌아오는 화면(로그인 · 계정 대조 · 한 번만) · 실패 안내 ·
     말 ko · en · 빈 authKey 안 보냄 · 리허설 도구(점검판만 · 되돌림) · docs/228 · 판
  ② (API) 간주(결제) 끄고 결제창 키 없으면 시험 결제(stub)로 등록 · 빈 authKey 422 · 되돌림
  ③ (사용자 웹) 간주 끈 결제 수단 화면 — 단추 누르면 등록됨 · /my/payment/card 계정이 다르면 안내 · ?card=fail 안내
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); SITE = os.environ.get('SITE'); DB = os.environ.get('DB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
PM = rd('site/src/components/PayMethod.tsx')
ok('① 결제 수단 — 실연동(간주 꺼짐 + 결제창 키)이면 토스 카드 등록 창 · customerKey · 성공 /my/payment/card · 실패 ?card=fail · 빈 authKey 안 보냄',
   "requestBillingAuth('카드'" in PM and 'customerKey, successUrl: `${origin}/my/payment/card`' in PM and 'failUrl: `${origin}/my/payment?card=fail`' in PM
   and "if (!assumed && CLIENT_KEY)" in PM and "assumed ? `assumed_${Date.now()}` : ''" not in PM and "useTossClientKey()" in PM
   and 'disabled={busy || (!assumed && !keyReady)}' in PM, '')
PG = rd('site/src/app/my/payment/page.tsx')
ok('① 결제 수단 화면 — customerKey = 로그인 계정 · ?card=fail 안내', PG.count('customerKey={p.accountId}') == 2 and "card === 'fail'" in PG and 'data-card-fail' in PG, '')
CP = rd('site/src/app/my/payment/card/page.tsx'); CC = rd('site/src/components/billing/CardAuthConfirm.tsx')
ok('① 돌아오는 화면 — 로그인 필요 · customerKey 가 내 계정일 때만 · 서버 등록 한 번만',
   "redirect('/login')" in CP and 'customerKey === p.accountId' in CP and "fetch('/api/v1/me/billing-key'" in CC and 'sent.current = true' in CC, '')
msgs = {l: json.loads(rd(f'site/src/i18n/messages/{l}/deal.json') or '{}').get('payMethod', {}) for l in ('ko', 'en')}
KEYS = ('cardTitle', 'cardSub', 'cardChecking', 'cardOk', 'cardBack', 'cardBad', 'cardFail')
ok('① 말 ko · en 7개', all(all(k in msgs[l] for k in KEYS) for l in ('ko', 'en')), '')
RO = open(os.path.join(HERE, 'rehearse_open.py'), encoding='utf-8').read()
ok('① 리허설 도구 — 점검판 DB 만 · 켜기 · 문 · 되돌림 · 처음 값 저장', "'localhost:15432' not in DB" in RO and all(f"'{m}': {m}" in RO for m in ('on', 'gate', 'restore'))
   and 'rehearse_before.json' in RO, '')
D228 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('228_')), '')
ok('① docs/228 — A · B 단계 결과 · 발견 7 · 순서표 15줄 · 되돌림', '## 5. 오픈 날 켜는 순서표' in D228 and '| 15 | AI' in D228
   and 'ETAX_NOT_CONFIGURED' in D228 and 'requestBillingAuth' in D228 and '12 → 12' in D228, '')
ok('① 판 v10.148 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 148), rd('VERSION').strip())


# ── ② API ────────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


U = 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    UT = call('POST', '/auth/login', {'email': U, 'password': PW})['accessToken']
    acc = psql(f"SELECT id FROM accounts WHERE email = '{U}'")
    before = psql("SELECT value FROM site_settings WHERE key = 'assume.payment'")
    keys0 = psql(f"SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM billing_keys WHERE account_id = '{acc}' AND status = 'ACTIVE'")
    try:
        call('PATCH', '/admin/site-settings', {'key': 'assume.payment', 'value': 'off'}, T_)
        ok('② 간주(결제) 끔', psql("SELECT value FROM site_settings WHERE key = 'assume.payment'") == 'off', '')
        ok('② 빈 authKey → 422(NO_AUTH_KEY)', call('POST', '/me/billing-key', {'authKey': ''}, UT).get('code') == 'NO_AUTH_KEY', '')
        r = call('POST', '/me/billing-key', {'authKey': 'stub_v1148'}, UT)
        ok('② 결제창 키 없음(서버도 시험 결제) → 시험 키로 등록됨', r.get('stub') is True and r.get('cardLast4') == '0000', json.dumps(r)[:120])

        # ── ③ 사용자 웹 ───────────────────────────────────────────────
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                with sync_playwright() as p:
                    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1280, 'height': 900})
                    ctx.add_cookies([{'name': 'sgb_at', 'value': UT, 'url': SITE}])
                    pg = ctx.new_page()
                    pg.goto(SITE + '/my/payment', wait_until='networkidle', timeout=120000)
                    btn = pg.locator('[data-pay-register]')
                    dialogs = []
                    pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
                    ok('③ 간주 끈 결제 수단 화면 — 간주 안내 없음 · 등록 단추', btn.count() == 1 and pg.locator('text=' + '연동 전').count() == 0, '')
                    if btn.count():
                        pg.wait_for_function("() => !document.querySelector('[data-pay-register]').disabled", timeout=30000)
                        btn.click(); pg.wait_for_timeout(3000)
                    ok('③ 단추 → 확인 창 없이 시험 결제로 등록(결제창 키 없음) · 카드 보임', not dialogs and pg.locator('[data-pay-card]:not([data-pay-empty])').count() >= 1,
                       f'창 {dialogs} · {pg.locator("[data-pay-card]").first.inner_text()[:80] if pg.locator("[data-pay-card]").count() else ""}')
                    pg.goto(SITE + '/my/payment/card?authKey=abc&customerKey=00000000-0000-0000-0000-000000000000', wait_until='networkidle', timeout=120000)
                    ok('③ /my/payment/card — 다른 계정 주소면 보내지 않고 안내', pg.locator('[data-card-auth]').count() == 0 and pg.locator('a[href="/my/payment"]').count() >= 1, '')
                    pg.goto(SITE + '/my/payment?card=fail', wait_until='networkidle', timeout=120000)
                    ok('③ ?card=fail — 실패 · 취소 안내', pg.locator('[data-card-fail]').count() == 1, '')
                    pg.screenshot(path=os.path.join(HERE, 'v1148_card.png'), full_page=False)
                    b.close()
    finally:
        psql(f"UPDATE site_settings SET value = '{before}' WHERE key = 'assume.payment'")
        # 이번 시험이 단 결제 수단은 내리고(REVOKED) 처음 것을 되살림
        psql(f"UPDATE billing_keys SET status = 'REVOKED', revoked_at = now() WHERE account_id = '{acc}' AND status = 'ACTIVE'"
             + (f" AND id::text NOT IN ({','.join(repr(x) for x in keys0.split(','))})" if keys0 else ''))
    ok('② 되돌림 — 간주(결제) · 결제 수단', psql("SELECT value FROM site_settings WHERE key = 'assume.payment'") == before
       and psql(f"SELECT count(*) FROM billing_keys WHERE account_id = '{acc}' AND status = 'ACTIVE'") == ('0' if not keys0 else str(len(keys0.split(',')))), before)

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
