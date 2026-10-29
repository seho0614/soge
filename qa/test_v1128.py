"""v10.128 시험 — 외부 연동 키를 운영 화면에서(D128 · docs/192)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1128.py

  ① 마이그레이션 D128 — MAIL 줄 · 받는 키 15 · 키마다 형식 · 공개 키 · 166 · 마지막 D128 · 지우는 문장 없음
  ② 코드 — IntegrationSecretService(process.env 에 얹음 · 1분 · 지우면 .env 로) · 키 API 3개 SUPER · 감사 · 공개 결제 키 · 사이트 5곳 · 운영 화면 · 점검표
  ③ (API · DB) 권한 · 형식 · 저장(끝 4자리 · 암호문 · 키 등록) · 바로 반영(결제 스텁 → 실제 · 공개 결제 키) · 지우기 · 기록에 키 없음
  ④ (운영 화면 · 브라우저) 최고 관리자 「연동 키」 · 저장 → 끝 4자리 · 지우기
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
FAKE_SK = 'test_sk_' + 'TEST1128' * 3 + 'Zq9X'       # 형식만 맞는 가짜 키(결제사가 거절함)
FAKE_CK = 'test_ck_' + 'TEST1128' * 3 + 'Ck7Y'
FAKE_BANK = 'bankkey-' + 'TEST1128' * 2 + '-B4nk'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 마이그레이션 ─────────────────────────────────────────────────────
M = rd('prisma/migrations/D128_integ_keys_admin/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 166 · 마지막 D128', (len(mig), mig[-1] if mig else '') in ((166, 'D128_integ_keys_admin'), (167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'),), f'{len(mig)} · {mig[-1] if mig else ""}')
PAIRS = re.findall(r"\('([A-Z]+)','([A-Z_]+)'\)", M.split('ADD CONSTRAINT ck_integ_secret_name')[1].split(';')[0]) if 'ADD CONSTRAINT ck_integ_secret_name' in M else []
ok('① 받는 키 15(전부터 4 + 새 11) · MAIL 줄(오픈을 막지 않음 · 발신 IP 불필요) · ON CONFLICT DO NOTHING',
   len(PAIRS) == 15 and ('PG', 'TOSS_SECRET_KEY') in PAIRS and ('MAIL', 'SMTP_PASS') in PAIRS and ('AGENT', 'ANTHROPIC_API_KEY') in PAIRS
   and "VALUES ('MAIL', '메일(Amazon SES SMTP)'" in M and "'Amazon SES', 'NOT_STARTED', false, 'SMTP_PASS', NULL, false," in M and 'ON CONFLICT (code) DO NOTHING' in M, str(len(PAIRS)))
ok('① 형식 — 토스 시크릿(sk) · 클라이언트(ck) · SES 비밀번호 · 나머지 8 ~ 512 · 공개 키는 결제창 · 카카오 JS 만 · 지우는 문장 없음',
   "^(test|live)_g?sk_" in M and "^(test|live)_g?ck_" in M and "^[A-Za-z0-9+/=]{20,128}$" in M and "length(v) NOT BETWEEN 8 AND 512 OR v !~ '^[!-~]+$'" in M
   and "p_name IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY')" in M and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), '')

# ── ② 코드 ─────────────────────────────────────────────────────────────
S = rd('src/common/integration/secret.service.ts'); C = rd('src/modules/site/integration-keys.controller.ts'); AM = rd('src/app.module.ts')
svc_pairs = set(re.findall(r"\{ code: '([A-Z]+)', name: '([A-Z_]+)'", S))
EXTRA = {('MAIL', 'SMTP_USER')} if os.path.isdir(os.path.join(K, 'prisma/migrations/D136_mail_admin')) else set()   # v10.140 SMTP 사용자 이름(test_v1140)
EXTRA |= {('PASS', 'NICE_CLIENT_ID'), ('PASS', 'NICE_CLIENT_SECRET'), ('PASS', 'NICE_PRODUCT_ID')} if os.path.isdir(os.path.join(K, 'prisma/migrations/D137_identity_nice')) else set()   # v10.141 NICE 키 3개(test_v1141)
EXTRA |= {('ALIMTALK', 'ALIMTALK_SENDER_KEY')} if os.path.isdir(os.path.join(K, 'prisma/migrations/D138_alimtalk')) else set()   # v10.142 발신 프로필 키(test_v1142)
EXTRA |= {('ESIGN', 'ESIGN_WEBHOOK_SECRET')} if os.path.isdir(os.path.join(K, 'prisma/migrations/D139_esign')) else set()   # v10.143 전자계약 웹훅 비밀값(test_v1143)
EXTRA |= {('SAFENUM', 'SAFENUM_WEBHOOK_SECRET')} if os.path.isdir(os.path.join(K, 'prisma/migrations/D141_safenum')) else set()   # v10.145 안심번호 웹훅 비밀값(test_v1145)
ok('② 서비스 키 목록 = DB 받는 키 15(v10.140 16 · v10.142 20 · v10.143 21 · v10.145 22)', svc_pairs == set(PAIRS) | EXTRA, str(sorted((set(PAIRS) | EXTRA) ^ svc_pairs)))
ok('② process.env 에 얹음 — 띄울 때(못 읽으면 다시) · 1분 · 저장 · 지운 직후 · 한 줄로(겹침 없음) · 지우면 띄울 때 .env 값으로 · 실패하면 이전 값 · 키 값은 로그에 없음',
   'EVERY_MS = 60_000' in S and 'process.env[env] = r.v' in S and 'this.envAtBoot.get(env)' in S and 'delete process.env[env]' in S
   and S.count('this.refresh()') >= 4 and 'this.chain = run.then(() => undefined);' in S and "e?.code ?? e?.name ?? 'error'" in S and 'r.v}' not in S, '')
ok('② 결제창 클라이언트 키는 NEXT_PUBLIC_TOSS_CLIENT_KEY 로 · 카카오 · 날씨 · AI 는 얹지 않음(그 서비스가 DB 먼저)',
   "name: 'TOSS_CLIENT_KEY', label: '결제창 클라이언트 키(공개)', env: 'NEXT_PUBLIC_TOSS_CLIENT_KEY'" in S
   and all(f"name: '{n}'" in S and re.search(rf"name: '{n}',[^}}]*env: null", S) for n in ('KAKAO_REST_KEY', 'KAKAO_JS_KEY', 'KMA_SERVICE_KEY', 'ANTHROPIC_API_KEY')), '')
ok('② 키 API 3개 SUPER(클래스) · 넣기 · 지우기 감사 · 공개 결제 키는 /site-settings/payment · 모듈 등록',
   "@Controller('api/v1/admin')\n@Roles('SUPER')\nexport class IntegrationKeysController" in C and "@Get('integration-keys')" in C
   and "@Put('integration-keys/:code/:name')" in C and "@Delete('integration-keys/:code/:name')" in C
   and "@Audit('INTEGRATION_KEY_SET', 'INTEGRATION')" in C and "@Audit('INTEGRATION_KEY_CLEAR', 'INTEGRATION')" in C
   and "@Get('site-settings/payment')" in C and 'IntegrationSecretService,' in AM and 'IntegrationKeysController,' in AM and 'PaymentClientKeyController,' in AM, '')
SITE = {f: rd('site/src/components/' + f) for f in ('health/PayForm.tsx', 'health/ExchangeFeePay.tsx', 'partner/CashPanel.tsx', 'refcode/RefShareButton.tsx', 'billing/PlanPicker.tsx')}
H = rd('site/src/lib/useTossClientKey.ts')
ok('② 사용자 웹 5곳 — 빌드 때 키 대신 useTossClientKey(받기 전 · 못 받으면 결제 단추 막음 · 1분 기억)',
   all('process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY' not in s and 'const { key: CLIENT_KEY, ready: keyReady } = useTossClientKey();' in s and 'disabled={!keyReady || ' in s for s in SITE.values())
   and "fetch('/api/v1/site-settings/payment'" in H and 'BUILD_KEY' not in H and 'KEEP_MS = 60_000' in H, str([f for f, s in SITE.items() if 'useTossClientKey' not in s]))
W = rd('web/src/app/admin/Integrations.tsx'); WK = rd('web/src/app/admin/IntegrationKeys.tsx')
ok('② 운영 화면 — 외부 연동 안 「연동 키」 · 비밀번호 칸 · 지우기 확인 창 · 카카오 · 날씨 · AI 는 각 구역 · 옛 「키는 다루지 않음」 글 없음',
   '<IntegrationKeys />' in W and 'Secrets Manager' not in W and 'type="password"' in WK and 'window.confirm(' in WK
   and "OWN_PANEL = ['MAP', 'WEATHER', 'AGENT']" in WK and 'data-integration-keys' in WK, '')
scr = json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']
t = {x['id']: x for x in scr}
REG = rd('src/common/integration/registry.ts'); INV = rd('scripts/verify-invariants.sh'); ENVX = rd('deploy/aws/env.production.example')
ok('② 점검표 — 목록표 MAIL dbRow · 불변식 13종 · KEY-1 · 2 · MAP-4 짝 · .env 예시 안내 · 화면 목록 API',
   "code: 'MAIL', name: '메일(Amazon SES SMTP)', dbRow: true" in REG and 'if [ "$n" = "13" ]' in INV and 'KEY-1' in INV and 'KEY-2' in INV
   and "('PG','KAKAO_REST_KEY','\\\\x00','0000')" in INV and '「연동 키」(SUPER)에서 넣는 것이 먼저' in ENVX
   and {'GET /admin/integration-keys', 'PUT /admin/integration-keys/{code}/{name}', 'DELETE /admin/integration-keys/{code}/{name}'} <= set(t.get('SB-ADM-SIT-080', {}).get('apis', []))
   and all('GET /site-settings/payment' in t.get(i, {}).get('apis', []) for i in ('SB-HLT-ORD-020', 'SB-PTC-CTR-400', 'SB-MYP-SUB-020', 'SB-MAL-DTL-010')), '')


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


def row(rows, code, name):
    return next((x for x in rows if isinstance(x, dict) and x.get('code') == code and x.get('name') == name), {}) if isinstance(rows, list) else {}


CLEAN = ("DELETE FROM integration_secrets WHERE integration_code IN ('PG','BANK','MAIL'); "
         "UPDATE integrations SET secret_registered = false WHERE code IN ('PG','BANK','MAIL');")
SELLER = 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    mark = psql("SELECT coalesce(max(occurred_at), '-infinity')::text FROM audit.audit_logs")
    try:
        psql(CLEAN)
        ok('③ 외부 연동 표 13종 · MAIL 줄(오픈을 막지 않음 · 키 이름 SMTP_PASS)',
           psql("SELECT count(*)::text FROM integrations") == '13' and psql("SELECT blocks_open::text || ' ' || secret_key_name FROM integrations WHERE code = 'MAIL'") == 'false SMTP_PASS',
           psql("SELECT count(*) FROM integrations"))
        r = [call(m, p, b, TA) for m, p, b in (('GET', '/admin/integration-keys', None), ('PUT', '/admin/integration-keys/PG/TOSS_SECRET_KEY', {'value': FAKE_SK}),
                                               ('DELETE', '/admin/integration-keys/PG/TOSS_SECRET_KEY', None))]
        ok('③ 운영(ADMIN)은 키 API 3개 모두 403', all(x.get('_err') == 403 for x in r), str([x.get('_err') for x in r]))
        ok('③ 로그인 안 한 사람도 403/401', call('GET', '/admin/integration-keys').get('_err') in (401, 403), '')
        v0 = call('GET', '/admin/integration-keys', t=T_)
        pg0 = row(v0, 'PG', 'TOSS_SECRET_KEY')
        ok('③ 목록 15줄(v10.140 16 · v10.142 20) · 값 없음 · 처음 결제 시크릿 키는 운영 화면에 없음(점검판 .env 에도 없으면 NONE)',
           isinstance(v0, list) and len(v0) == 15 + len(EXTRA) and pg0.get('source') in ('NONE', 'ENV') and all('value' not in x for x in v0)
           and row(v0, 'MAIL', 'SMTP_PASS').get('integration') == '메일(Amazon SES SMTP)', str(pg0))
        pay0 = call('GET', '/site-settings/payment')
        ok('③ 공개 결제 키 — 로그인 없이 · 처음 null(시험 결제)', 'clientKey' in pay0 and pay0.get('clientKey') in (None, ''), str(pay0))
        bad = [call('PUT', '/admin/integration-keys/PG/TOSS_SECRET_KEY', {'value': FAKE_CK}, T_),
               call('PUT', '/admin/integration-keys/PG/TOSS_CLIENT_KEY', {'value': FAKE_SK}, T_),
               call('PUT', '/admin/integration-keys/MAIL/SMTP_PASS', {'value': 'AKIA 띄어쓰기 들어간 값'}, T_),
               call('PUT', '/admin/integration-keys/BANK/BANK_VERIFY_KEY', {'value': '한글이들어간키값입니다'}, T_)]
        ok('③ 형식이 아닌 값 — 시크릿 자리에 ck · 클라이언트 자리에 sk · 빈칸 · 한글 모두 422 INTEG_SECRET_FORMAT(값을 되돌려 말하지 않음)',
           all(x.get('_err') == 422 and x.get('code') == 'INTEG_SECRET_FORMAT' and 'TEST1128' not in (x.get('message') or '') for x in bad), str([(x.get('_err'), x.get('code')) for x in bad]))
        nf = [call('PUT', '/admin/integration-keys/PG/NOPE_KEY', {'value': FAKE_SK}, T_), call('PUT', '/admin/integration-keys/MAP/TOSS_SECRET_KEY', {'value': FAKE_SK}, T_)]
        ok('③ 없는 키 · 짝이 안 맞는 키는 404', all(x.get('_err') == 404 for x in nf), str([x.get('_err') for x in nf]))
        ok('③ 너무 짧은 값은 입력 검사에서 400', call('PUT', '/admin/integration-keys/BANK/BANK_VERIFY_KEY', {'value': 'short'}, T_).get('_err') == 400, '')
        v1 = call('PUT', '/admin/integration-keys/PG/TOSS_SECRET_KEY', {'value': '  ' + FAKE_SK + '  '}, T_)
        pg1 = row(v1, 'PG', 'TOSS_SECRET_KEY')
        ok('③ 저장 — 끝 4자리만 · 운영 화면 키(ADMIN) · 응답에 키 없음', pg1.get('source') == 'ADMIN' and pg1.get('masked') == '••••••Zq9X' and 'TEST1128' not in json.dumps(v1), str(pg1))
        enc = psql("SELECT position(convert_to('TEST1128', 'UTF8') in value_enc)::text || ' ' || last4 || ' ' || is_public::text || ' ' || (SELECT secret_registered::text FROM integrations WHERE code = 'PG') FROM integration_secrets WHERE integration_code = 'PG' AND name = 'TOSS_SECRET_KEY'")
        ok('③ DB 에는 암호문만 · 끝 4자리 · 비공개 · 외부 연동 「키 등록됨」', enc == '0 Zq9X false true', enc)
        q = call('GET', '/me/referral-codes/quota', t=TA)
        stub = q.get('paymentStub') if isinstance(q, dict) else None
        ok('③ 바로 반영 — 소개코드 추가 결제가 시험(스텁)에서 실제 결제사 쪽으로(재시작 없음)', stub is False, f"paymentStub={stub} {q.get('_err', '')}")
        v2 = call('PUT', '/admin/integration-keys/PG/TOSS_CLIENT_KEY', {'value': FAKE_CK}, T_)
        pay1 = call('GET', '/site-settings/payment')
        ok('③ 결제창 클라이언트 키 — 공개 키로 저장 · 공개 API 가 바로 줌(빌드 없음)',
           row(v2, 'PG', 'TOSS_CLIENT_KEY').get('isPublic') is True and pay1.get('clientKey') == FAKE_CK
           and psql("SELECT is_public::text FROM integration_secrets WHERE integration_code = 'PG' AND name = 'TOSS_CLIENT_KEY'") == 'true', str(pay1)[:60])
        v3 = call('PUT', '/admin/integration-keys/BANK/BANK_VERIFY_KEY', {'value': FAKE_BANK}, T_)
        ok('③ 구현 전(STUB) 연동도 칸에 넣음 — 끝 4자리 · 어댑터 표시', row(v3, 'BANK', 'BANK_VERIFY_KEY').get('masked') == '••••••B4nk' and row(v3, 'BANK', 'BANK_VERIFY_KEY').get('adapter') in ('REAL', 'STUB', 'NONE'), str(row(v3, 'BANK', 'BANK_VERIFY_KEY')))
        d1 = call('DELETE', '/admin/integration-keys/PG/TOSS_SECRET_KEY', t=T_)
        call('DELETE', '/admin/integration-keys/PG/TOSS_CLIENT_KEY', t=T_); call('DELETE', '/admin/integration-keys/BANK/BANK_VERIFY_KEY', t=T_)
        q2 = call('GET', '/me/referral-codes/quota', t=TA); pay2 = call('GET', '/site-settings/payment')
        ok('③ 지우기 — 운영 화면 키 없음 · 결제는 다시 시험(.env 에 없으면) · 공개 결제 키 null · 「키 등록」 해제',
           row(d1, 'PG', 'TOSS_SECRET_KEY').get('source') in ('NONE', 'ENV') and pay2.get('clientKey') in (None, '')
           and q2.get('paymentStub') is True and psql("SELECT secret_registered::text FROM integrations WHERE code = 'PG'") == 'false',
           f"{row(d1, 'PG', 'TOSS_SECRET_KEY').get('source')} · stub={q2.get('paymentStub')} · {pay2}")
        aud = psql(f"SELECT count(*) FILTER (WHERE action IN ('INTEGRATION_KEY_SET','INTEGRATION_KEY_CLEAR'))::text || ' ' || count(*) FILTER (WHERE coalesce(after_data::text, '') || coalesce(before_data::text, '') LIKE '%TEST1128%')::text FROM audit.audit_logs WHERE occurred_at > '{mark}'")
        ok('③ 감사 기록 — 넣기 · 지우기 남음 · 키 값은 어디에도 없음', aud.split()[0] not in ('', '0') and aud.split()[1] == '0', aud)
    finally:
        psql(CLEAN)
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

# ── ④ 운영 화면(브라우저) ──────────────────────────────────────────────
if ADMIN_WEB and DB and API:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if not sync_playwright:
        ok('④ 화면 시험은 시험 이미지(sgb-qa:v1 · playwright)에서', False, 'playwright 없음')
    else:
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]')
                pg.wait_for_timeout(1500)
                pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-integration-keys]')
                items = box.locator('[data-integ-key]')
                ok('④ 최고 관리자 — 외부 연동 안 「연동 키」 11줄(v10.140 12 · v10.142 16 · 카카오 · 날씨 · AI 는 각 구역)', box.count() == 1 and items.count() == 11 + len(EXTRA), str(items.count()))
                it = box.locator('[data-integ-key="BANK/BANK_VERIFY_KEY"]')
                it.locator('input[type=password]').fill(FAKE_BANK); it.locator('button', has_text='저장').click(); pg.wait_for_timeout(2000)
                txt = it.inner_text()
                ok('④ 저장 → 끝 4자리만 · 「이 화면에서 넣음」 · 칸은 비워짐 · 키 글자 없음',
                   '••••••B4nk' in txt and '이 화면에서 넣음' in txt and it.locator('input[type=password]').input_value() == '' and 'TEST1128' not in pg.content(), txt[:160].replace('\n', ' '))
                pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/v1128_integration_keys.png', full_page=False)
                it.locator('button', has_text='지우기').click(); pg.wait_for_timeout(2000)
                ok('④ 지우기(확인 창) → 끝 4자리 사라짐 · 지우기 단추 없음', '••••••B4nk' not in it.inner_text() and it.locator('button', has_text='지우기').count() == 0, '')
                b.close()
        finally:
            psql(CLEAN)

# ── ⑤ 다국어 전체 켜기(운영 화면 › 번역 › 언어 · v10.128) → 사용자 화면 머리에 언어 단추 ──────────────
TR = rd('web/src/app/admin/Translations.tsx')
ok('⑤ 코드 — 언어 칸에 「다국어 켜기 · 끄기」(i18n.enabled · 확인 창) · 옛 「정책에서 켬」 안내 없음',
   'data-i18n-all' in TR and "key: 'i18n.enabled', value: on ? 'on' : 'off'" in TR and '정책(site_settings)의 i18n.enabled 입니다' not in TR, '')
SITE_URL = os.environ.get('SITE')
if ADMIN_WEB and DB and API and SITE_URL:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        was = (psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'"), psql("SELECT is_active::text FROM i18n_langs WHERE code = 'en'"))
        try:
            psql("UPDATE site_settings SET value = 'off' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = false WHERE code = 'en';")
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]')
                pg.wait_for_timeout(1500)
                pg.goto(ADMIN_WEB + '/#/i18n', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(1500)
                pg.get_by_role('tab', name='언어', exact=True).click(); pg.wait_for_timeout(1500)
                pg.locator('[data-i18n-langs] tr', has_text='en').locator('button', has_text='켜기').click(); pg.wait_for_timeout(1500)
                pg.locator('[data-i18n-all] button', has_text='다국어 켜기').click(); pg.wait_for_timeout(2000)
                st = (psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'"), psql("SELECT is_active::text FROM i18n_langs WHERE code = 'en'"))
                ok('⑤ 운영 화면 — 영어 켜기 · 다국어 켜기 단추로 저장됨', st == ('on', 'true') and pg.locator('[data-i18n-all] button', has_text='다국어 끄기').count() == 1, str(st))
                pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/v1128_i18n_all.png', full_page=False)
                sp = b.new_page(viewport={'width': 1400, 'height': 900}); seen = False
                for _ in range(9):   # 사용자 웹은 언어 목록을 1분 기억
                    sp.goto(SITE_URL + '/', wait_until='domcontentloaded', timeout=120000); sp.wait_for_timeout(1500)
                    if sp.locator('[data-lang-pick]').count(): seen = True; break
                    sp.wait_for_timeout(10000)
                ok('⑤ 사용자 화면 머리에 언어 단추(1분 안)', seen, '')
                pg.locator('[data-i18n-all] button', has_text='다국어 끄기').click(); pg.wait_for_timeout(2000)
                ok('⑤ 다국어 끄기 단추로 다시 꺼짐', psql("SELECT value FROM site_settings WHERE key = 'i18n.enabled'") == 'off', '')
                b.close()
        finally:
            psql(f"UPDATE site_settings SET value = '{was[0]}' WHERE key = 'i18n.enabled'; UPDATE i18n_langs SET is_active = {was[1] or 'false'} WHERE code = 'en';")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
