"""v10.135 시험 — AI 한도 · 모델을 운영 화면에서 · 처리방침 빈칸 채움(docs/202)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1135.py

  ① 코드 — 「AI 한도 · 모델」 구역(하루 횟수 7 · 모델 3 · 요금표) · 모델은 요금표에 있는 것만(MODEL_UNPRICED) · 볼 때 번역 횟수도 SUPER 만
     · 요금표 넣기 · 고치기 API(SUPER · 감사) · 화면 목록 · D132(처리방침 빈칸 2곳 · 게시 안 함 · 지우는 문장 없음) · 170
  ② (API) 하루 횟수 저장 · 형식 아니면 422 · 운영(ADMIN) 403 · 요금표에 없는 모델 422 · 요금표에 넣으면 고를 수 있음 · 감사 — 끝나면 되돌림
  ③ (DB) 처리방침 초안(또는 게시된 판)에 빈칸이 없음 · 채운 글
  ④ (운영 화면) 최고 관리자 — 표 3개 · 횟수 저장 · 모델 고르기 / 운영(ADMIN) — 표는 보이고 입력 칸 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ─────────────────────────────────────────────────────────────
L = rd('web/src/app/admin/ailearn/AgentLimits.tsx'); ST = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
LIM = ['agent.member_daily_limit', 'agent.guest_daily_limit', 'agent.guest_daily_per_ip', 'agent.guest_daily_total',
       'i18n.board_daily_member', 'i18n.board_daily_guest', 'i18n.board_daily_guest_total']
MOD = ['agent.chat_model', 'agent.review_model', 'i18n.translate_model']
ok('① 「AI 한도 · 모델」 구역 — 하루 횟수 7 · 모델 3 · 요금표 넣기 · SUPER 만 입력 · AI 스위치 아래',
   all(f"'{k}'" in L for k in LIM + MOD) and "'/admin/agent/model-prices'" in L and "tokenRoles().includes('SUPER')" in L
   and '<AgentSwitches onChanged={r.reload} />\n      <AgentLimits onChanged={r.reload} />' in ST, '')
A = rd('src/modules/admin/admin.service.ts')
ok('① 서버 — 모델은 요금표에 있는 것만(MODEL_UNPRICED) · 볼 때 번역 횟수도 AI 설정(SUPER)',
   "PolicyViolation('MODEL_UNPRICED'" in A and 'await this.checkAiModel(key, value);' in A
   and all(f"'{k}'" in A for k in ('i18n.board_daily_member', 'i18n.board_daily_guest', 'i18n.board_daily_guest_total')), '')
C = rd('src/modules/agent/agent.controller.ts'); S = rd('src/modules/agent/agent.service.ts')
ok('① 요금표 API — PUT admin/agent/model-prices · SUPER · 감사 AGENT_MODEL_PRICE_SET · 지우기 없음',
   "@Put('admin/agent/model-prices')\n  @Roles('SUPER')" in C and "@Audit('AGENT_MODEL_PRICE_SET'" in C and 'async setModelPrice(' in S
   and 'DELETE FROM agent_model_prices' not in S + C, '')
scr = [x for x in json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens'] if x['id'] == 'SB-ADM-AGT-010']
ok('① 화면 목록 SB-ADM-AGT-010 에 요금표 API', scr and 'PUT /admin/agent/model-prices' in scr[0]['apis'], '')
T = rd('scripts/terms-text.js'); D = rd('prisma/migrations/D132_terms_privacy_fill/migration.sql')
m = re.search(r"\n  PRIVACY: `((?:\\.|[^`\\])*)`", T, re.S); P = m.group(1).replace('\\`', '`').replace('\\\\', '\\') if m else ''
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① 처리방침 빈칸 2곳 채움 — 받는 곳 연락처 · 보관 기간(대표 「그대로」) · 미확정 표시 없음',
   '548 Market Street, PMB 90375, San Francisco, CA 94104, USA · legal@anthropic.com' in P and '받은 날부터 30일 안에 자동 삭제' in P
   and not re.search(r'〔(?!시행일〕)[^〕]*〕', P), '')
ok('① D132 = terms-text.js 처리방침 · 게시 안 함 · 지우는 문장 없음 · docs/terms 같음 · 170',
   f'$TERM${P}$TERM$' in D and "SET status = 'PUBLISHED'" not in D and "'LEGAL_REVIEW'" in D and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE)\b', D)
   and P.strip() in rd('docs/terms/PRIVACY.md') and (len(mig), mig[-1]) == (170, 'D132_terms_privacy_fill'), f'{len(mig)} · {mig[-1]}')
ok('① 판 v10.135 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 135), rd('VERSION').strip())


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


SELLER = 'seller@x.com'; TEST_MODEL = 'claude-test-9-9'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in LIM + MOD}
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    mark = psql("SELECT coalesce(max(occurred_at), '-infinity')::text FROM audit.audit_logs")
    set_ = lambda k, v, t: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    try:
        r = [set_(k, '7', T_) for k in LIM]
        ok('② 하루 횟수 7개 저장(SUPER)', all(x.get('value') == '7' for x in r), str([x.get('value') or x.get('code') for x in r]))
        bad = set_('agent.member_daily_limit', 'abc', T_)
        ok('② 횟수가 숫자가 아니면 422 SETTING_FORMAT', bad.get('_err') == 422 and bad.get('code') == 'SETTING_FORMAT', str(bad)[:80])
        ra = [set_(k, '9', TA) for k in ('agent.member_daily_limit', 'i18n.board_daily_member', 'agent.chat_model')]
        ok('② 운영(ADMIN)은 횟수 · 모델 403 AI_SETTING_SUPER(볼 때 번역 횟수 포함)', all(x.get('_err') == 403 and x.get('code') == 'AI_SETTING_SUPER' for x in ra), str([(x.get('_err'), x.get('code')) for x in ra]))
        un = set_('agent.chat_model', TEST_MODEL, T_)
        ok('② 요금표에 없는 모델 → 422 MODEL_UNPRICED', un.get('_err') == 422 and un.get('code') == 'MODEL_UNPRICED', str(un)[:100])
        pa = call('PUT', '/admin/agent/model-prices', {'model': TEST_MODEL, 'inputPerM': 1, 'outputPerM': 5, 'cacheReadPerM': 0.1, 'note': '시험'}, TA)
        ok('② 요금표 넣기 — 운영(ADMIN)은 403', pa.get('_err') == 403, str(pa)[:80])
        pb = call('PUT', '/admin/agent/model-prices', {'model': 'Claude Bad', 'inputPerM': 1, 'outputPerM': 5, 'cacheReadPerM': 0.1}, T_)
        ok('② 요금표 넣기 — 모델 이름 형식이 아니면 400', pb.get('_err') == 400, str(pb)[:80])
        ps = call('PUT', '/admin/agent/model-prices', {'model': TEST_MODEL, 'inputPerM': 1, 'outputPerM': 5, 'cacheReadPerM': 0.1, 'note': '시험'}, T_)
        row = [x for x in ps if x.get('model') == TEST_MODEL] if isinstance(ps, list) else []
        ok('② 요금표 넣기(SUPER) — 기준일 오늘 · 목록에 나옴', row and row[0]['inputPerM'].startswith('1') and row[0]['asOf'] == psql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text"), str(row)[:120])
        pu = call('PUT', '/admin/agent/model-prices', {'model': TEST_MODEL, 'inputPerM': 2, 'outputPerM': 6, 'cacheReadPerM': 0.2}, T_)
        ok('② 요금표 고치기 — 같은 모델이면 요금만 바뀜(줄이 늘지 않음)', isinstance(pu, list) and [x['outputPerM'] for x in pu if x['model'] == TEST_MODEL] == ['6.0000']
           and psql(f"SELECT count(*) FROM agent_model_prices WHERE model = '{TEST_MODEL}'") == '1', '')
        mo = [set_(k, TEST_MODEL, T_) for k in MOD]
        st = call('GET', '/admin/agent/status', t=T_)
        ok('② 요금표에 넣은 모델은 3기능 모두 고를 수 있음 · 상태 화면에 반영', all(x.get('value') == TEST_MODEL for x in mo)
           and st.get('chatModel') == TEST_MODEL and st.get('reviewModel') == TEST_MODEL and st.get('translateModel') == TEST_MODEL, str([x.get('code') for x in mo]))
        aud = psql(f"SELECT string_agg(DISTINCT action, ',') FROM audit.audit_logs WHERE occurred_at > '{mark}' AND action IN ('SITE_SETTING_UPDATE', 'AGENT_MODEL_PRICE_SET')")
        ok('② 감사 기록 — SITE_SETTING_UPDATE · AGENT_MODEL_PRICE_SET', 'SITE_SETTING_UPDATE' in aud and 'AGENT_MODEL_PRICE_SET' in aud, aud)
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        psql(f"DELETE FROM agent_model_prices WHERE model = '{TEST_MODEL}';")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

    # ── ③ 처리방침 ─────────────────────────────────────────────────────
    rows = psql("SELECT version || ':' || status || ':' || (body ~ '〔(?!시행일〕)[^〕]*〕')::text || ':' || (position('548 Market Street' in body) > 0)::text "
                "FROM terms WHERE code = 'PRIVACY' AND status IN ('DRAFT', 'LEGAL_REVIEW', 'PUBLISHED') ORDER BY version")
    newest = rows.splitlines()[-1] if rows else ''
    ok('③ 처리방침 — 가장 새 판(초안 또는 게시)에 빈칸 없음 · 채운 연락처', newest.endswith(':false:true'), rows.replace('\n', ' / '))

# ── ④ 운영 화면(브라우저) ──────────────────────────────────────────────
if ADMIN_WEB and DB and API:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in LIM + MOD}
        psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
        try:
            def login(b, email):
                pg = b.new_page(viewport={'width': 1400, 'height': 1000}); pg.on('dialog', lambda d: d.accept())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]')
                pg.wait_for_timeout(1500)
                return pg

            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = login(b, 'admin@x.com')
                pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                n_lim = pg.locator('[data-agent-limit]').count(); n_mod = pg.locator('[data-agent-model]').count(); n_pr = pg.locator('[data-agent-price]').count()
                ok('④ 최고 관리자 — 하루 횟수 7줄 · 모델 3줄 · 요금표(3줄 이상) · 새 요금 입력 줄', n_lim == 7 and n_mod == 3 and n_pr >= 3 and pg.locator('[data-agent-price-new]').count() == 1, f'{n_lim} · {n_mod} · {n_pr}')
                row = pg.locator('[data-agent-limit="agent.member_daily_limit"]')
                row.locator('input').fill('12'); row.locator('button').click(); pg.wait_for_timeout(1500)
                ok('④ 횟수 저장 — 화면 · DB 12', '12회' in row.inner_text() and psql("SELECT value FROM site_settings WHERE key = 'agent.member_daily_limit'") == '12', row.inner_text()[:60])
                sel = pg.locator('[data-agent-model="agent.chat_model"] select')
                opts = sel.locator('option').all_inner_texts()
                sel.select_option('claude-sonnet-5-5'); pg.wait_for_timeout(1500)
                ok('④ 모델 고르기 — 요금표의 모델이 보기 · 고르면 DB 에 저장', len(opts) >= 3 and psql("SELECT value FROM site_settings WHERE key = 'agent.chat_model'") == 'claude-sonnet-5-5', str(opts)[:120])
                pg.locator('[data-agent-limits]').screenshot(path='v1135_agent_limits.png')
                pa = login(b, SELLER)
                pa.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pa.wait_for_timeout(2500)
                ok('④ 운영(ADMIN) — 표는 보이고 입력 칸 · 고르기 · 새 요금 줄 없음', pa.locator('[data-agent-limit]').count() == 7
                   and pa.locator('[data-agent-limits] input, [data-agent-limits] select').count() == 0 and pa.locator('[data-agent-price-new]').count() == 0, '')
                b.close()
        finally:
            for k, v in was.items():
                psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
