"""v10.111 시험 — AI 키를 운영 화면에서(D122 · docs/173) · apply.sh 질문 전 입력 비우기

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1111.py

  ① 마이그레이션 D122 — 외부 연동 AGENT 줄 · 받는 키 ANTHROPIC_API_KEY · sk-ant-api 형식 · 160 · 마지막 D122 · 지우는 문장 없음
  ② 코드 — 엔진은 AgentService 한 곳(MOCK > 운영 화면 키 > .env · 1분) · 네 통로가 거기서 받음 · 키 API 4개 SUPER · 감사 · 화면 · apply.sh
  ③ (API · DB) 권한 · 형식 · 저장(끝 4자리 · 암호문) · 엔진 · 통로 반영 · 키 확인(비용 없는 모델 목록) · 지우기 · 기록에 키 없음
  ④ (운영 화면 · 브라우저) 최고 관리자에게만 「AI 키」 · 저장 → 끝 4자리 · 지우기 / 운영(ADMIN)에게는 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
FAKE = 'sk-ant-api03-' + 'TEST1111' * 8 + '-Q7zZ'   # 형식만 맞는 가짜 키(Anthropic 이 거절함)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 마이그레이션 ─────────────────────────────────────────────────────
M = rd('prisma/migrations/D122_agent_key_admin/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 160 · 마지막 D122(v10.115 부터 D123 · 161 — test_v1115)', (len(mig), mig[-1] if mig else '') in ((160, 'D122_agent_key_admin'), (161, 'D123_profile_consent_single'), (162, 'D124_i18n_profile'), (163, 'D125_i18n_more_targets')), f'{len(mig)} · {mig[-1] if mig else ""}')
ok('① 외부 연동 AGENT 줄(오픈을 막지 않음 · 발신 IP 불필요) · 받는 키에 AGENT/ANTHROPIC_API_KEY 하나만 더함 · 결제 · 계좌 · 세금계산서 키 없음',
   "VALUES ('AGENT', 'AI(Anthropic Claude)'" in M and "'ANTHROPIC_API_KEY', NULL, false," in M
   and "('MAP','KAKAO_REST_KEY'), ('MAP','KAKAO_JS_KEY'), ('WEATHER','KMA_SERVICE_KEY'), ('AGENT','ANTHROPIC_API_KEY'))" in M
   and not re.search(r"'(TOSS|PAY|BANK|ETAX|NTS)[A-Z_]*'\s*\)", M), '')
ok('① 형식 — sk-ant-api 로 시작(관리 키 · 사용자 키 거절) · 넣으면 secret_registered · 지우는 문장 없음',
   "v !~ '^sk-ant-api[A-Za-z0-9_-]{20,250}$'" in M and "IN ('KAKAO_REST_KEY', 'KMA_SERVICE_KEY', 'ANTHROPIC_API_KEY')" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', M), '')

# ── ② 코드 ─────────────────────────────────────────────────────────────
S = rd('src/modules/agent/agent.service.ts'); P = rd('src/modules/agent/agent.provider.ts'); C = rd('src/modules/agent/agent.controller.ts')
ok('② 엔진 한 곳 — MOCK(.env) 먼저 · 운영 화면 키 · 없으면 .env(v10.104 그대로) · 1분 기억 · 같은 키면 클라이언트 다시 안 만듦',
   "env.AGENT_PROVIDER === 'MOCK'" in S and "fn_integ_secret_get('AGENT', 'ANTHROPIC_API_KEY')" in S and 'resolveAgentProvider(env)' in S
   and 'ENGINE_TTL_MS = 60_000' in S and 'prev?.key === key && prev.prov' in S and "failed && prev?.source === 'ADMIN'" in S
   and "env.AGENT_PROVIDER === 'CLAUDE' && (env.ANTHROPIC_API_KEY ?? '').length > 20" in P, '')
SV = {f: rd(f) for f in ('src/modules/i18n/translate.service.ts', 'src/modules/i18n/board-translate.service.ts',
                          'src/modules/agent/review-shadow.service.ts', 'src/modules/agent/agent-chat.service.ts')}
ok('② 네 통로(등록 글 번역 · 게시판 번역 · 검수 보조 · AI 상담)가 기동 때가 아니라 부를 때 AgentService 에서 엔진을 받음',
   all('resolveAgentProvider' not in s and 'this.provider' not in s and 'await this.agent.provider()' in s for s in SV.values()),
   str([f.split('/')[-1] for f, s in SV.items() if 'await this.agent.provider()' not in s]))
ok('② 키 확인은 모델 목록(토큰 안 씀 · 비용 없음 · 다시 시도 없음 · 10초) · 키 값은 응답 · 로그에 없음(종류만)',
   '.models.list({ limit: 100 })' in S and 'maxRetries: 0, timeout: 10_000' in S and 'messages.create' not in S.split('async testKey')[1].split('async status')[0]
   and "this.log.warn(`AI 키 확인 실패 — ${kind}" in S, '')
ok('② 키 API 4개 — 모두 SUPER · 넣기 · 지우기는 감사 기록(응답에는 끝 4자리만)',
   all(x in C for x in ("@Get('admin/agent/key')", "@Put('admin/agent/key')", "@Delete('admin/agent/key')", "@Post('admin/agent/key/test')"))
   and C.split("@Get('admin/agent/key')")[1].count("@Roles('SUPER')") == 4
   and "@Audit('AGENT_KEY_SET', 'INTEGRATION')" in C and "@Audit('AGENT_KEY_CLEAR', 'INTEGRATION')" in C, '')
scr = json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']
t = [x for x in scr if x['id'] == 'SB-ADM-AGT-010']
REG = rd('src/common/integration/registry.ts'); ENVX = rd('deploy/aws/env.production.example'); INV = rd('scripts/verify-invariants.sh')
ok('② 점검 — 외부 연동 목록표 AGENT · .env 예시 ANTHROPIC_API_KEY · 불변식 12종 · AIK-1 ~ 5',
   "code: 'AGENT', name: 'AI(Anthropic Claude)', dbRow: true, secretEnv: 'ANTHROPIC_API_KEY'" in REG and re.search(r'\bANTHROPIC_API_KEY=', ENVX)
   and 'if [ "$n" = "12" ]' in INV and all(f'AIK-{i}' in INV for i in range(1, 6)), '')
ok('② 화면 목록 SB-ADM-AGT-010 에 키 API 4개', t and {'GET /admin/agent/key', 'PUT /admin/agent/key', 'DELETE /admin/agent/key', 'POST /admin/agent/key/test'} <= set(t[0]['apis']), str(t and t[0]['apis']))
W = rd('web/src/app/admin/ailearn/AgentStatus.tsx'); WK = rd('web/src/app/admin/ailearn/AgentKey.tsx')
ok('② 운영 화면 — 「AI 키」는 최고 관리자에게만 · 엔진 표시 · 비밀번호 칸(다시 안 보임) · 키 확인 · 지우기 확인 창',
   "tokenRoles().includes('SUPER') && <AgentKey" in W and 'data-agent-engine' in W
   and 'type="password"' in WK and "'/admin/agent/key/test'" in WK and 'window.confirm(' in WK and 'data-agent-key' in WK, '')
AP = rd('deploy/aws/apply.sh')
ok('② apply.sh — 화면에서 칠 때만 질문 전 남은 입력 버림 · 빈 대답은 세 번까지 · 넘긴 대답(printf | )은 그대로',
   'if [ -t 0 ]; then' in AP and 'while read -r -t 0.2 -n 10000 _junk; do :; done' in AP and 'for _try in 1 2 3; do' in AP
   and '[ "$yn" = "yes" ] || stop' in AP, '')


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


SELLER = 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    # 운영(ADMIN)만 가진 사람 — 시험 동안만 seller 에게 ADMIN 을 붙였다가 뗌
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    mark = psql("SELECT coalesce(max(occurred_at), '-infinity')::text FROM audit.audit_logs")
    try:
        psql("DELETE FROM integration_secrets WHERE integration_code = 'AGENT';")
        ok('③ 외부 연동 표에 AGENT 줄(오픈을 막지 않음 · 키 이름)', psql("SELECT blocks_open::text || ' ' || secret_key_name FROM integrations WHERE code = 'AGENT'") == 'false ANTHROPIC_API_KEY',
           psql("SELECT code, blocks_open, secret_key_name FROM integrations WHERE code = 'AGENT'"))
        r = [call(m, p, b, TA) for m, p, b in (('GET', '/admin/agent/key', None), ('PUT', '/admin/agent/key', {'value': FAKE}), ('DELETE', '/admin/agent/key', None), ('POST', '/admin/agent/key/test', None))]
        st = call('GET', '/admin/agent/status', t=TA)
        ok('③ 운영(ADMIN)은 키 API 4개 모두 403 · 상태 화면은 열림(엔진 · 키 출처만 · 값 없음)', all(x.get('_err') == 403 for x in r) and 'keySource' in st and 'masked' not in json.dumps(st),
           f"{[x.get('_err') for x in r]} · {st.get('engine')} {st.get('keySource')}")
        v0 = call('GET', '/admin/agent/key', t=T_)
        mock = v0.get('source') == 'MOCK'
        ok('③ 처음 — 운영 화면 키 없음(.env 도 없으면 엔진 없음 · 점검판이 MOCK 이면 MOCK)', v0.get('saved') is False and v0.get('masked') is None
           and ((v0.get('source'), v0.get('engine')) in (('NONE', None), ('MOCK', 'MOCK'))), str(v0))
        bad = [call('PUT', '/admin/agent/key', {'value': x}, T_) for x in ('sk-ant-usr-' + 'a' * 40, 'sk-ant-admin01-' + 'b' * 40, '한글키' * 12, 'sk-ant-api03-' + 'c' * 30 + ' 띄어쓰기')]
        ok('③ 형식이 아닌 값 — 사용자 키 · 관리 키 · 한글 · 띄어쓰기 모두 422 INTEG_SECRET_FORMAT(값을 되돌려 말하지 않음)',
           all(x.get('_err') == 422 and x.get('code') == 'INTEG_SECRET_FORMAT' and 'sk-ant-usr' not in (x.get('message') or '') for x in bad), str([(x.get('_err'), x.get('code')) for x in bad]))
        ok('③ 너무 짧은 값은 입력 검사에서 400', call('PUT', '/admin/agent/key', {'value': 'sk-ant-api'}, T_).get('_err') == 400, '')
        v1 = call('PUT', '/admin/agent/key', {'value': '  ' + FAKE + '  '}, T_)
        ok('③ 저장 — 끝 4자리만 · 운영 화면 키 · 엔진 CLAUDE(점검판이 MOCK 이면 MOCK 이 먼저)',
           v1.get('saved') is True and v1.get('unreadable') is False and v1.get('masked') == '••••••Q7zZ' and FAKE not in json.dumps(v1)
           and ((v1.get('source'), v1.get('engine')) == (('MOCK', 'MOCK') if mock else ('ADMIN', 'CLAUDE'))), str(v1))
        enc = psql("SELECT position(convert_to('TEST1111', 'UTF8') in value_enc)::text || ' ' || last4 || ' ' || (SELECT secret_registered::text FROM integrations WHERE code = 'AGENT') FROM integration_secrets WHERE integration_code = 'AGENT'")
        ok('③ DB 에는 암호문만(평문 조각 없음) · 끝 4자리 · 외부 연동 「키 등록됨」', enc == '0 Q7zZ true', enc)
        nokey = subprocess.run(['psql', DB, '-X', '-At', '-c', "SELECT fn_integ_secret_get('AGENT', 'ANTHROPIC_API_KEY')"], capture_output=True, text=True)
        ok('③ 앞뒤 빈칸이 붙은 값도 저장(빈칸은 지움 — 끝 4자리가 빈칸이 아님) · 암호 열쇠 없는 DB 접속으로는 풀리지 않음',
           v1.get('masked') == '••••••Q7zZ' and nokey.returncode != 0 and 'ENC_KEY' in nokey.stderr and 'TEST1111' not in nokey.stdout, nokey.stderr.strip()[:80])
        st = call('GET', '/admin/agent/status', t=T_); jobs = call('GET', '/admin/i18n/jobs?size=1', t=T_)
        ok('③ 저장 즉시 상태 화면 · 번역 통로가 같은 엔진(재시작 없음)',
           (st.get('engine'), st.get('keySource'), jobs.get('provider')) == (('MOCK', 'MOCK', 'MOCK') if mock else ('CLAUDE', 'ADMIN', 'CLAUDE')),
           f"{st.get('engine')} {st.get('keySource')} · jobs {jobs.get('provider')}")
        cs = call('GET', '/agent/chat/status')
        ok('③ 키가 있어도 AI 는 켜지지 않음 — 스위치 · 월 상한 그대로(손님 단추 없음)', cs.get('enabled') is False
           and psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'") == 'off', str(cs))
        used0 = psql("SELECT coalesce(sum(requests), 0)::text FROM agent_usage_daily")
        tr = call('POST', '/admin/agent/key/test', t=T_)
        used1 = psql("SELECT coalesce(sum(requests), 0)::text FROM agent_usage_daily")
        if mock:
            ok('③ 키 확인 — 시험 엔진이면 밖으로 나가지 않음', tr.get('ok') is True and 'MOCK' in (tr.get('message') or ''), str(tr))
        else:
            ok('③ 키 확인 — 가짜 키라 Anthropic 이 거절(AUTH) · 연결이 막힌 곳이면 NETWORK · 응답에 키 없음 · 사용량 안 쌓임',
               tr.get('ok') is False and tr.get('kind') in ('AUTH', 'NETWORK', 'TIMEOUT', 'PERMISSION') and FAKE not in json.dumps(tr)
               and used0 == used1, f"{tr.get('kind')} · {tr.get('message')} · 사용량 {used0}→{used1}")
        v2 = call('DELETE', '/admin/agent/key', t=T_)
        ok('③ 지우기 — 저장 없음 · 엔진 없음(점검판 MOCK 이면 MOCK) · 「키 등록됨」 해제',
           v2.get('saved') is False and v2.get('masked') is None and ((v2.get('source'), v2.get('engine')) == (('MOCK', 'MOCK') if mock else ('NONE', None)))
           and psql("SELECT secret_registered::text FROM integrations WHERE code = 'AGENT'") == 'false', str(v2))
        jobs = call('GET', '/admin/i18n/jobs?size=1', t=T_)
        ok('③ 지운 즉시 번역 통로도 엔진 없음', jobs.get('provider') == ('MOCK' if mock else None), str(jobs.get('provider')))
        aud = psql(f"SELECT count(*) FILTER (WHERE action IN ('AGENT_KEY_SET','AGENT_KEY_CLEAR'))::text || ' ' || count(*) FILTER (WHERE after_data::text LIKE '%TEST1111%')::text FROM audit.audit_logs WHERE occurred_at > '{mark}'")
        ok('③ 감사 기록 — 넣기 · 지우기 남음 · 키 값은 어디에도 없음', aud.split()[0] != '0' and aud.split()[1] == '0', aud)
    finally:
        psql("DELETE FROM integration_secrets WHERE integration_code = 'AGENT'; UPDATE integrations SET secret_registered = false WHERE code = 'AGENT';")
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
        def login(pg, email):
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]')
            pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        try:
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('dialog', lambda d: d.accept())
                login(pg, 'admin@x.com')
                box = pg.locator('[data-agent-key]')
                ok('④ 최고 관리자 — 「AI 키」 칸 · 엔진 표시', box.count() == 1 and pg.locator('[data-agent-engine]').count() == 1, pg.locator('[data-agent-engine]').inner_text() if pg.locator('[data-agent-engine]').count() else '')
                box.locator('input[aria-label="AI 키 넣기"]').fill(FAKE); box.locator('button', has_text='저장').click(); pg.wait_for_timeout(2000)
                txt = box.inner_text()
                ok('④ 저장 → 끝 4자리만 · 「이 화면에서 넣음」(MOCK 점검판이면 시험 엔진) · 칸은 비워짐 · 키 글자 없음',
                   '••••••Q7zZ' in txt and ('이 화면에서 넣음' in txt or '시험 엔진' in txt) and box.locator('input[aria-label="AI 키 넣기"]').input_value() == ''
                   and 'TEST1111' not in pg.content(), txt[:160].replace('\n', ' '))
                pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/v1111_agent_key.png', full_page=False)
                box.locator('button', has_text='지우기').click(); pg.wait_for_timeout(2000)
                left = box.locator('[data-agent-key-source]').get_attribute('data-agent-key-source')
                ok('④ 지우기(확인 창) → 끝 4자리 사라짐 · 「없음」(MOCK 점검판이면 시험 엔진)', '••••••Q7zZ' not in box.inner_text() and left in ('NONE', 'MOCK')
                   and box.locator('button', has_text='지우기').count() == 0, str(left))
                pg2 = b.new_page(viewport={'width': 1400, 'height': 1000})
                login(pg2, SELLER)
                ok('④ 운영(ADMIN) — 「AI 키」 칸 없음 · 엔진 표시는 보임', pg2.locator('[data-agent-key]').count() == 0 and pg2.locator('[data-agent-engine]').count() == 1, '')
                b.close()
        finally:
            psql("DELETE FROM integration_secrets WHERE integration_code = 'AGENT'; UPDATE integrations SET secret_registered = false WHERE code = 'AGENT';")
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
