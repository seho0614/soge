"""v10.141 시험 — 본인인증 NICE 표준창 틀(D137 · docs/214 · 설계 docs/213)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1141.py

  ① 코드 — D137(칸 · 키 이름 3개 · 설정 3개 · 지우는 문장 없음) · 암호(열쇠 만들기 · AES · HMAC · 무결성 먼저) · 원문 CI · 이름 · 생년월일 저장 안 함 ·
     실패는 트랜잭션 밖에서 먼저 기록 · STUB 은 늘 stub-ci(키를 넣어도 빈 CI 아님) · 방식 바꾸기 SUPER · MOCK 은 운영 서버에서 못 고름 · NICE 는 키 3개 ·
     API 5개 · 화면 목록 · 사용자 화면 3곳 · 운영 화면 「본인인증」 · 영어 문장 · 판
  ② (API) STUB 지금 그대로 · MOCK 전체 흐름(시작 → 가짜 창 → 완료 → identity_verified_at · ci_hash 해시 · 원문 없음) · 다시 보냄 409 ·
     무결성 바꿈 422 · 10분 지남 422 · 취소 422 · 만 14세 미만 422 · 남의 요청 404 · 같은 사람 다른 계정 warn 통과 · block 409 ·
     옛 단추 409 · NICE 키 없으면 422 · ADMIN 은 403 · 운영 상태 — 끝나면 되돌림(실제 NICE 에는 붙지 않음)
  ③ (사용자 웹 · 운영 화면) MOCK 에서 /verify 「휴대폰 본인확인」 → 가짜 창 → 결과 · 운영 화면 「본인인증」
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB'); SITE = os.environ.get('SITE')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
D = rd('prisma/migrations/D137_identity_nice/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D137 — 칸 6개 · 요청 번호 유일 · 키 이름 NICE 3개 · 설정(STUB · warn · 14) · 지우는 문장 없음 · 175 이상',
   all(f'ADD COLUMN IF NOT EXISTS {c}' in D for c in ('req_no', 'req_expires_at', 'adapter', 'name_match', 'fail_code', 'session_enc'))
   and 'uq_idv_req_no' in D and "('PASS','NICE_CLIENT_ID')" in D and "('PASS','NICE_PRODUCT_ID')" in D
   and "('identity.provider', 'STUB'" in D and "('identity.ci_duplicate', 'warn'" in D and "('identity.min_age', '14'" in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', D) and len(mig) >= 175 and 'D137_identity_nice' in mig, f'{len(mig)} · {mig[-1]}')
NA = rd('src/modules/identity/nice-identity.adapter.ts'); IV = rd('src/modules/identity/identity-verify.service.ts')
ok('① 암호 — 열쇠(sha256 → 앞 16 · 뒤 16 · 앞 32) · AES-128-CBC · HMAC-SHA256 · 무결성은 상수 시간 비교 뒤 복호화 · 공개 자료 기준 표시',
   "r.slice(0, 16), iv: r.slice(-16), hmacKey: r.slice(0, 32)" in NA and "'aes-128-cbc'" in NA and "createHmac('sha256'" in NA
   and 'timingSafeEqual' in NA and NA.index('timingSafeEqual(want, got)') < NA.index('createDecipheriv(') and '공개 자료' in NA, '')
ok('① 저장 — CI 는 서버 열쇠 HMAC 해시만 · 이름 · 생년월일 · DI 를 저장하는 SQL 없음 · 세션 열쇠는 암호화 · 끝나면 비움',
   "encode(hmac($1, fn_enc_key(), 'sha256'), 'hex')" in IV and 'pgp_sym_encrypt($5, fn_enc_key())' in IV and 'session_enc = NULL' in IV
   and not re.search(r"INSERT INTO identity_verifications[^;]*\b(birthdate|name|di)\b", IV), '')
ok('① 오류 처리 — 실패 기록은 트랜잭션 밖(fail()) · 세션 비움 · 까닭 9가지 · 운영 서버 MOCK → STUB',
   'private async fail(' in IV and all(f"'{c}'" in IV for c in ('EXPIRED', 'INTEGRITY', 'REQ_MISMATCH', 'NO_CI', 'UNDER_AGE', 'CI_DUPLICATE', 'UNAVAILABLE'))
   and '`NICE_${code}`' in IV and "if (v === 'MOCK') return isProd() ? 'STUB' : 'MOCK';" in IV, '')
ok('① STUB 은 늘 stub-ci(전: 키를 넣으면 빈 CI → 소개코드 무료분 0) · MOCK · NICE 면 옛 단추 409',
   "'SUCCESS', 'stub-ci', now()" in IV and "'USE_STANDARD_WINDOW'" in IV and 'verifyIdentity' not in rd('src/modules/public/public.service.ts'), '')
AD = rd('src/modules/admin/admin.service.ts')
ok('① 방식 바꾸기 — identity.* 는 SUPER(INTEG_SETTING_SUPER) · MOCK 은 운영 서버 422 · NICE 는 키 3개 422',
   "key.startsWith('identity.')" in AD and "'INTEG_SETTING_SUPER'" in AD and "'MOCK_NOT_ALLOWED'" in AD and "'IDENTITY_KEYS_MISSING'" in AD, '')
IC = rd('src/modules/identity/identity-verify.controller.ts')
routes = re.findall(r"@(Get|Post)\('([^']+)'\)\n  @Roles\(([^)]*)\)", IC)
ok('① API 5개 — 회원 4 · 운영 상태 ADMIN · SUPER · 완료는 감사 IDENTITY_VERIFY',
   sorted(routes) == sorted([('Get', 'verifications/identity/mode', "'MEMBER'"), ('Post', 'verifications/identity/start', "'MEMBER'"),
                             ('Post', 'verifications/identity/complete', "'MEMBER'"), ('Post', 'verifications/identity/mock-sign', "'MEMBER'"),
                             ('Get', 'admin/identity/status', "'ADMIN', 'SUPER'")]) and "@Audit('IDENTITY_VERIFY', 'ACCOUNT')" in IC, str(routes))
SC = json.loads(rd('spec/screens.json') or '{"screens":[]}')
aut = next((s for s in SC['screens'] if s['id'] == 'SB-HOM-AUT-030'), {}); sit = next((s for s in SC['screens'] if s['id'] == 'SB-ADM-SIT-080'), {})
ok('① 화면 목록 — 본인인증 화면에 4개 · 외부 연동에 상태 1개',
   all(a in aut.get('apis', []) for a in ['GET /verifications/identity/mode', 'POST /verifications/identity/start', 'POST /verifications/identity/complete', 'POST /verifications/identity/mock-sign'])
   and 'GET /admin/identity/status' in sit.get('apis', []), '')
VP = rd('site/src/components/VerifyPanel.tsx'); VR = rd('site/src/components/VerifyReturn.tsx'); VM = rd('site/src/components/VerifyMockNice.tsx')
ok('① 사용자 화면 — 방식에 따라 단추 · 표준창으로 POST 폼 · 돌아오는 곳(한 번만 보냄) · 가짜 창 · 한국어 · 영어',
   "'/api/v1/verifications/identity/mode'" in VP and "f.method = 'POST'" in VP and 'data-verify-start' in VP and 'sent.current' in VR
   and "'/api/v1/verifications/identity/complete'" in VR and "'/api/v1/verifications/identity/mock-sign'" in VM
   and os.path.exists(os.path.join(K, 'site/src/app/verify/return/page.tsx')) and os.path.exists(os.path.join(K, 'site/src/app/verify/mock-nice/page.tsx'))
   and all('"verifyReturn"' in rd(f'site/src/i18n/messages/{l}/join.json') and '"verifyMock"' in rd(f'site/src/i18n/messages/{l}/join.json') for l in ('ko', 'en')), '')
IP = rd('web/src/app/admin/IdentityPanel.tsx')
ok('① 운영 화면 — 외부 연동 「본인인증」(방식 · 키 3개 · 최근 30일 · SUPER 만 단추)', '<IdentityPanel />' in rd('web/src/app/admin/Integrations.tsx')
   and 'data-identity-panel' in IP and 'data-identity-set' in IP and "tokenRoles().includes('SUPER')" in IP and "'/admin/identity/status'" in IP, '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 문장 — 새 오류 문장 사전에', all(m in EN for m in ('"본인인증 요청이 없습니다."', '"만 {0}세 이상만 본인인증을 할 수 있습니다."', '"가짜 표준창은 점검판(MOCK)에서만 씁니다."')), '')
ok('① 판 v10.141 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 141), rd('VERSION').strip())


def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, headers=hd, method=m)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode('utf-8', 'replace'))
        except Exception: body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    if r.returncode: print('  psql:', r.stderr.strip()[:200])
    return r.stdout.strip()


SETS = ['identity.provider', 'identity.ci_duplicate', 'identity.min_age']
BUYER, SELLER = 'buyer@x.com', 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    BT = call('POST', '/auth/login', {'email': BUYER, 'password': 'sgb-dev-1234'})['accessToken']
    ST = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    before = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in SETS}
    ivat = {e: psql(f"SELECT coalesce(identity_verified_at::text, '') FROM accounts WHERE email = '{e}'") for e in (BUYER, SELLER)}
    mark = psql("SELECT now()::text")
    had_role = psql(f"SELECT count(*) FROM account_roles r JOIN accounts a ON a.id = r.account_id WHERE a.email = '{SELLER}' AND r.role = 'ADMIN'") != '0'
    bname = psql(f"SELECT name FROM accounts WHERE email = '{BUYER}'")
    setv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    try:
        setv('identity.provider', 'STUB')
        s0 = call('POST', '/verifications/identity/start', {}, BT)
        old = call('POST', '/verifications/identity', {'provider': 'PASS'}, BT)
        ok('② STUB — 시작은 409 USE_STUB · 옛 단추는 그대로 통과(stub true · stub-ci)', s0.get('_err') == 409 and s0.get('code') == 'USE_STUB' and old.get('stub') is True
           and psql(f"SELECT ci_hash FROM identity_verifications WHERE account_id = (SELECT id FROM accounts WHERE email = '{BUYER}') ORDER BY requested_at DESC LIMIT 1") == 'stub-ci', f"{s0.get('code')} · {old}")
        nk = setv('identity.provider', 'NICE')
        ok('② NICE 키 없이 바꾸기 422 IDENTITY_KEYS_MISSING', nk.get('_err') == 422 and nk.get('code') == 'IDENTITY_KEYS_MISSING', str(nk)[:120])
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        AT = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
        na = setv('identity.provider', 'MOCK', AT)
        ok('② 운영(ADMIN)은 방식을 못 바꿈 403 INTEG_SETTING_SUPER · 상태는 봄', na.get('_err') == 403 and na.get('code') == 'INTEG_SETTING_SUPER'
           and 'provider' in call('GET', '/admin/identity/status', t=AT) and call('GET', '/admin/identity/status', t=BT).get('_err') == 403, str(na)[:80])
        if not had_role:
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

        mk = setv('identity.provider', 'MOCK')
        setv('identity.ci_duplicate', 'warn'); setv('identity.min_age', '14')
        md = call('GET', '/verifications/identity/mode', t=BT)
        old2 = call('POST', '/verifications/identity', {'provider': 'PASS'}, BT)
        ok('② MOCK 으로 바꿈(점검판) · 방식 MOCK · 옛 단추 409 USE_STANDARD_WINDOW', mk.get('_err') is None and md.get('mode') == 'MOCK'
           and old2.get('_err') == 409 and old2.get('code') == 'USE_STANDARD_WINDOW', f"{mk.get('_err')} · {md} · {old2.get('code')}")

        def begin(t=BT):
            s = call('POST', '/verifications/identity/start', {'next': '/my'}, t)
            return s, (s.get('window') or {}).get('fields') or {}

        def sign(f, name, birth, t=BT, cancel=False):
            return call('POST', '/verifications/identity/mock-sign', {'token_version_id': f.get('token_version_id'), 'enc_data': f.get('enc_data'),
                                                                     'integrity_value': f.get('integrity_value'), 'name': name, 'birthdate': birth, 'cancel': cancel}, t)

        def done(r, t=BT):
            fl = r.get('fields') or {}
            return call('POST', '/verifications/identity/complete', {k: fl.get(k) for k in ('token_version_id', 'enc_data', 'integrity_value')}, t)

        s1, f1 = begin()
        ok('② 시작 — 가짜 창 주소 · 넘길 값 4개 · 10분 · 요청 번호 1회용 저장(세션 암호화)', s1.get('mode') == 'MOCK' and s1['window']['url'] == '/verify/mock-nice'
           and set(f1) == {'m', 'token_version_id', 'enc_data', 'integrity_value'} and s1.get('expiresInMinutes') == 10
           and psql(f"SELECT (session_enc IS NOT NULL)::text || '|' || result FROM identity_verifications WHERE raw->>'tv' = '{f1.get('token_version_id')}'") == 'true|PENDING', str(s1)[:120])
        g1 = sign(f1, bname, '19900101')
        ok('② 가짜 창 — 돌아오는 주소 /verify/return · 같은 암호로 결과', g1.get('returnUrl') == '/verify/return' and (g1.get('fields') or {}).get('enc_data'), str(g1)[:100])
        bad = dict(g1); bad['fields'] = dict(g1.get('fields') or {}); bad['fields']['integrity_value'] = 'A' + (bad['fields'].get('integrity_value') or '')[1:]
        x1 = done(bad)
        ok('② 무결성 값을 바꾸면 422 IDENTITY_INTEGRITY · 실패 기록(INTEGRITY) · 세션 비움', x1.get('_err') == 422 and x1.get('code') == 'IDENTITY_INTEGRITY'
           and psql(f"SELECT result || '|' || fail_code || '|' || (session_enc IS NULL)::text FROM identity_verifications WHERE raw->>'tv' = '{f1.get('token_version_id')}'") == 'FAIL|INTEGRITY|true', str(x1)[:100])
        ok('② 실패한 요청을 다시 보내면 409 IDENTITY_USED', done(g1).get('code') == 'IDENTITY_USED', '')

        s2, f2 = begin(); g2 = sign(f2, bname, '19900101')
        other = done(g2, ST)
        ok('② 남의 요청으로 완료 404', other.get('_err') == 404, str(other)[:80])
        c2 = done(g2)
        row = psql(f"SELECT result || '|' || length(ci_hash) || '|' || coalesce(name_match::text, '') || '|' || (session_enc IS NULL)::text || '|' || adapter FROM identity_verifications WHERE raw->>'tv' = '{f2.get('token_version_id')}'")
        ok('② 완료 — 본인인증 끝(stub false · MOCK) · ci_hash 64자 해시 · 이름 일치 · 세션 비움 · identity_verified_at · next',
           c2.get('success') is True and c2.get('stub') is False and c2.get('mode') == 'MOCK' and c2.get('nameMatch') is True and c2.get('next') == '/my'
           and row == 'SUCCESS|64|true|true|MOCK' and psql(f"SELECT identity_verified_at > '{mark}' FROM accounts WHERE email = '{BUYER}'") == 't', f'{str(c2)[:120]} · {row}')
        raw = psql(f"SELECT raw::text FROM identity_verifications WHERE raw->>'tv' = '{f2.get('token_version_id')}'")
        ok('② 기록에 이름 · 생년월일 · 원문 CI 없음', bname not in raw and '19900101' not in raw and 'mock-ci' not in raw, raw[:120])
        ok('② 같은 값 다시 보내면 409 IDENTITY_USED', done(g2).get('code') == 'IDENTITY_USED', '')

        s3, f3 = begin(); g3 = sign(f3, bname, '19900101')
        psql(f"UPDATE identity_verifications SET req_expires_at = now() - interval '1 minute' WHERE raw->>'tv' = '{f3.get('token_version_id')}'")
        x3 = done(g3)
        ok('② 10분 지나면 422 IDENTITY_EXPIRED · 기록 EXPIRED', x3.get('code') == 'IDENTITY_EXPIRED'
           and psql(f"SELECT fail_code FROM identity_verifications WHERE raw->>'tv' = '{f3.get('token_version_id')}'") == 'EXPIRED', str(x3)[:80])
        s4, f4 = begin(); x4 = done(sign(f4, '', '', cancel=True))
        ok('② 표준창에서 취소 — 422 IDENTITY_FAILED · 기록 NICE_0001', x4.get('code') == 'IDENTITY_FAILED'
           and psql(f"SELECT fail_code FROM identity_verifications WHERE raw->>'tv' = '{f4.get('token_version_id')}'") == 'NICE_0001', str(x4)[:80])
        s5, f5 = begin(); x5 = done(sign(f5, bname, '20200101'))
        ok('② 만 14세 미만 — 422 UNDER_AGE', x5.get('code') == 'UNDER_AGE', str(x5)[:80])

        s6, f6 = begin(ST); c6 = done(sign(f6, bname, '19900101', ST), ST)
        ok('② 같은 사람(이름 · 생년월일 같음 → 같은 CI) 다른 계정 — warn 이면 통과 · duplicate true · 이름 다름(nameMatch false)', c6.get('success') is True and c6.get('duplicate') is True and c6.get('nameMatch') is False, str(c6)[:120])
        setv('identity.ci_duplicate', 'block')
        s7, f7 = begin(ST); x7 = done(sign(f7, bname, '19900101', ST), ST)
        ok('② block 이면 409 CI_DUPLICATE · 기록 CI_DUPLICATE', x7.get('_err') == 409 and x7.get('code') == 'CI_DUPLICATE'
           and psql(f"SELECT fail_code FROM identity_verifications WHERE raw->>'tv' = '{f7.get('token_version_id')}'") == 'CI_DUPLICATE', str(x7)[:80])
        stt = call('GET', '/admin/identity/status', t=T_)
        l30 = stt.get('last30') or {}
        ok('② 운영 상태 — MOCK · 키 3개 없음 · 성공 2 이상 · 실패 까닭(INTEGRITY · EXPIRED · UNDER_AGE · CI_DUPLICATE) · 다른 계정 1 이상 · 값 없음',
           stt.get('provider') == 'MOCK' and len(stt.get('keys') or []) == 3 and stt.get('keysMissing') == ['NICE_CLIENT_ID', 'NICE_CLIENT_SECRET', 'NICE_PRODUCT_ID']
           and l30.get('success', 0) >= 2 and {'INTEGRITY', 'EXPIRED', 'UNDER_AGE', 'CI_DUPLICATE'} <= {r['reason'] for r in l30.get('reasons', [])} and l30.get('duplicate', 0) >= 1, str(stt)[:200])

        # ── ③ 사용자 웹(가짜 창 전체 흐름) ──────────────────────────────
        if SITE:
            try:
                from playwright.sync_api import sync_playwright
            except Exception:
                sync_playwright = None
            if sync_playwright:
                setv('identity.ci_duplicate', 'warn')
                psql(f"UPDATE accounts SET identity_verified_at = NULL WHERE email = '{BUYER}'")
                with sync_playwright() as p:
                    b = p.chromium.launch(); cx = b.new_context(viewport={'width': 1280, 'height': 900})
                    host = re.sub(r'^https?://', '', SITE).split(':')[0]
                    cx.add_cookies([{'name': 'sgb_at', 'value': BT, 'domain': host, 'path': '/'}])
                    pg = cx.new_page()
                    pg.goto(SITE + '/verify?next=/my', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                    btn = pg.locator('[data-verify-start="window"]')
                    ok('③ /verify — MOCK 이면 「휴대폰 본인확인」 단추 · 시험 안내', btn.count() == 1 and pg.locator('[data-verify-mock]').count() == 1, pg.locator('.verify').first.inner_text()[:80] if pg.locator('.verify').count() else '없음')
                    if btn.count():
                        btn.click(); pg.wait_for_url('**/verify/mock-nice**', timeout=60000); pg.wait_for_timeout(1000)
                        pg.fill('[data-mock-name]', bname); pg.fill('[data-mock-birth]', '19900101')
                        pg.screenshot(path=os.path.join(HERE, 'v1141_mock_window.png'))
                        pg.click('[data-mock-ok]'); pg.wait_for_url('**/verify/return**', timeout=60000)
                        pg.wait_for_selector('[data-verify-return="ok"], [data-verify-return="fail"]', timeout=60000)
                        okv = pg.locator('[data-verify-return="ok"]').count() == 1
                        ok('③ 가짜 창 → /verify/return 「본인인증이 끝났습니다」 · 이어서 하기 → /my', okv and pg.locator('[data-verify-continue]').get_attribute('href') == '/my',
                           pg.locator('[data-verify-return]').inner_text()[:80])
                        pg.screenshot(path=os.path.join(HERE, 'v1141_return.png'))
                    b.close()
    finally:
        for k, v in before.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        if not had_role:
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        psql(f"DELETE FROM identity_verifications WHERE requested_at >= '{mark}' AND account_id IN (SELECT id FROM accounts WHERE email IN ('{BUYER}', '{SELLER}'));")
        for e, v in ivat.items():
            psql(f"UPDATE accounts SET identity_verified_at = {('NULL' if not v else repr(v))} WHERE email = '{e}';")
    ok('② 되돌림 — 설정 · 인증 기록 · 인증 시각', all(psql(f"SELECT value FROM site_settings WHERE key = '{k}'") == v for k, v in before.items())
       and psql(f"SELECT count(*) FROM identity_verifications WHERE requested_at >= '{mark}' AND account_id IN (SELECT id FROM accounts WHERE email IN ('{BUYER}', '{SELLER}'))") == '0', '')

# ── ③ 운영 화면 ───────────────────────────────────────────────────────
if ADMIN_WEB:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        with sync_playwright() as p:
            b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000})
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            box = pg.locator('[data-identity-panel]')
            ok('③ 외부 연동 › 「본인인증」 — 키 3줄 · 방식 단추(SUPER · 점검판이라 MOCK 포함 3개) · 최근 30일', box.count() == 1 and box.locator('[data-identity-key]').count() == 3
               and box.locator('[data-identity-set]').count() == 3 and box.locator('[data-identity-stats]').count() == 1, box.inner_text()[:120] if box.count() else '없음')
            if box.count(): box.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1141_identity_panel.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
