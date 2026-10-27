"""v10.129 시험 — AI 스위치를 운영 화면에서(docs/194)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1129.py

  ① 코드 — AI 설정은 SUPER 만(AI_SETTING_SUPER) · AI 전체는 키 · 월 상한 > 0 이 먼저(SWITCH_PREREQ) · 「AI 스위치」 칸 · 외부 연동 「키 넣는 곳으로 가기」 · 마이그레이션 없음
  ② (API) 운영(ADMIN) 403 · 다른 설정은 ADMIN 그대로 · 키 · 상한 없이 켜기 422 · 상한만 있어도 422 · 키 + 상한이면 켜짐 · 끄기는 조건 없음 · 감사
  ③ (운영 화면) 최고 관리자 — 상한 저장 · 켜기 · 끄기 / 운영(ADMIN) — 칸은 보이고 단추 없음 · 외부 연동 「키 넣는 곳으로 가기」
"""
import json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
FAKE = 'sk-ant-api03-' + 'TEST1129' * 8 + '-W9xQ'   # 형식만 맞는 가짜 키(부르지 않음)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


# ── ① 코드 ─────────────────────────────────────────────────────────────
AS = rd('src/modules/admin/admin.service.ts'); AC = rd('src/modules/admin/admin.controller.ts')
ok('① 서버 — AI 설정(agent.* · AI 번역 4개)은 SUPER 만 · AI 전체 켜기는 키(운영 화면 · .env CLAUDE · MOCK) + 월 상한 > 0 · 문서에 403 · 422',
   "static isAiSetting(key: string)" in AS and "key.startsWith('agent.')" in AS
   and "'i18n.auto_translate.enabled', 'i18n.board_on_view', 'i18n.translate_model', 'i18n.auto_langs', 'i18n.engine'" in AS
   and "RequestCtx.get()?.actorRole !== 'SUPER'" in AS and "new Forbidden('AI_SETTING_SUPER'" in AS
   and "fn_integ_secret_get('AGENT', 'ANTHROPIC_API_KEY')" in AS and 'else if (cost >= cap)' in AS
   and "env.AGENT_PROVIDER === 'MOCK'" in AS and 'AI_SETTING_SUPER' in AC and 'SWITCH_PREREQ(AI 전체는' in AC, '')
SW = rd('web/src/app/admin/ailearn/AgentSwitches.tsx'); ST = rd('web/src/app/admin/ailearn/AgentStatus.tsx'); IN = rd('web/src/app/admin/Integrations.tsx')
ok('① 운영 화면 — AI 에이전트에 「AI 스위치」(상한 · 5개 · 확인 창 · SUPER 만 단추) · 처리방침 확인 문구(검수 보조 · 상담)',
   '<AgentSwitches onChanged={r.reload} />' in ST and 'data-agent-switches' in SW and 'data-agent-cap' in SW
   and all(f"key: '{k}'" in SW for k in ('agent.enabled', 'i18n.auto_translate.enabled', 'i18n.board_on_view', 'agent.review_shadow.enabled', 'agent.chat.enabled'))
   and 'window.confirm(' in SW and "tokenRoles().includes('SUPER')" in SW and 'docs/165 §2' in SW and 'docs/170 §2' in SW, '')
ok('① 외부 연동 — AI · 카카오맵 · 날씨 줄에 「키 넣는 곳으로 가기」',
   "AGENT: { label: '위험감지 › AI 운영 › AI 에이전트 › 「AI 키」(최고 관리자)', href: '#/ai-ops/agent' }" in IN and "sel: '[data-map-keys]'" in IN and "sel: '[data-weather-keys]'" in IN, '')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 판 v10.129 이상 · 마이그레이션 없음(166)', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 129) and len(mig) in (166, 167, 168), f"{rd('VERSION').strip()} · {len(mig)}")


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


KEYS = ('agent.enabled', 'agent.monthly_cap_usd', 'agent.chat.enabled', 'agent.review_shadow.enabled', 'i18n.auto_translate.enabled', 'i18n.board_on_view')
SELLER = 'seller@x.com'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    had_key = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'AGENT'") != '0'
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    mark = psql("SELECT coalesce(max(occurred_at), '-infinity')::text FROM audit.audit_logs")
    set_ = lambda k, v, t: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    try:
        if not had_key:
            psql("UPDATE site_settings SET value = '0' WHERE key = 'agent.monthly_cap_usd'; UPDATE site_settings SET value = 'off' WHERE key = 'agent.enabled';")
        r = [set_(k, 'on' if k != 'agent.monthly_cap_usd' else '5', TA) for k in KEYS] + [set_('i18n.translate_model', 'claude-haiku-5-5', TA)]
        ok('② 운영(ADMIN)은 AI 설정 7개 모두 403 AI_SETTING_SUPER', all(x.get('_err') == 403 and x.get('code') == 'AI_SETTING_SUPER' for x in r), str([(x.get('_err'), x.get('code')) for x in r][:3]))
        lim = psql("SELECT value FROM site_settings WHERE key = 'request.view.limit'")
        r2 = set_('request.view.limit', lim or '3', TA) if lim else {'key': 'skip'}
        ok('② AI 가 아닌 설정은 운영(ADMIN)도 그대로 바꿈', r2.get('_err') is None, str(r2)[:80])
        mock = call('GET', '/admin/agent/status', t=T_).get('keySource') == 'MOCK'   # 점검판이 시험 엔진이면 「키 없음」이 생기지 않음
        if not had_key and not mock:
            e1 = set_('agent.enabled', 'on', T_)
            ok('② 키 · 상한 없이 AI 전체 켜기 → 422 SWITCH_PREREQ(키 · 상한 둘 다 안내)', e1.get('_err') == 422 and e1.get('code') == 'SWITCH_PREREQ'
               and 'AI 키' in (e1.get('message') or '') and '월 상한' in (e1.get('message') or ''), str(e1.get('message'))[:120])
            set_('agent.monthly_cap_usd', '5', T_)
            e2 = set_('agent.enabled', 'on', T_)
            ok('② 상한만 있어도 → 422(키만 안내)', e2.get('_err') == 422 and 'AI 키' in (e2.get('message') or '') and '월 상한' not in (e2.get('message') or ''), str(e2.get('message'))[:120])
            call('PUT', '/admin/agent/key', {'value': FAKE}, T_)
            set_('agent.monthly_cap_usd', '0', T_)
            e3 = set_('agent.enabled', 'on', T_)
            ok('② 키만 있어도 → 422(상한만 안내)', e3.get('_err') == 422 and '월 상한' in (e3.get('message') or '') and 'AI 키' not in (e3.get('message') or ''), str(e3.get('message'))[:120])
            set_('agent.monthly_cap_usd', '5', T_)
        if mock:
            set_('agent.monthly_cap_usd', '0', T_)
            e0 = set_('agent.enabled', 'on', T_)
            ok('② (시험 엔진) 상한 0 이면 → 422(상한만 안내)', e0.get('_err') == 422 and '월 상한' in (e0.get('message') or ''), str(e0.get('message'))[:120])
            set_('agent.monthly_cap_usd', '5', T_)
        e4 = set_('agent.enabled', 'on', T_)
        st = call('GET', '/admin/agent/status', t=T_)
        ok('② 키 + 상한이면 켜짐 · 상태 화면 「켜짐 · $5」', e4.get('value') == 'on' and st.get('enabled') is True, f"{e4} · cap {st.get('capUsd')}")
        e5 = [set_(k, 'on', T_) for k in ('agent.chat.enabled', 'agent.review_shadow.enabled', 'i18n.auto_translate.enabled', 'i18n.board_on_view')]
        ok('② 통로 스위치 4개 켜기(SUPER)', all(x.get('value') == 'on' for x in e5), str([x.get('value') for x in e5]))
        e6 = [set_(k, 'off', T_) for k in ('agent.chat.enabled', 'agent.review_shadow.enabled', 'i18n.auto_translate.enabled', 'i18n.board_on_view', 'agent.enabled')]
        ok('② 끄기는 조건 없이', all(x.get('value') == 'off' for x in e6), '')
        bad = set_('agent.monthly_cap_usd', 'abc', T_)
        ok('② 상한 형식이 아니면 422 SETTING_FORMAT', bad.get('_err') == 422 and bad.get('code') == 'SETTING_FORMAT', str(bad)[:80])
        aud = psql(f"SELECT count(*) FROM audit.audit_logs WHERE occurred_at > '{mark}' AND action = 'SITE_SETTING_UPDATE'")
        ok('② 감사 기록 SITE_SETTING_UPDATE 남음(거절된 것 빼고)', aud not in ('', '0'), aud)
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        if not had_key:
            psql("DELETE FROM integration_secrets WHERE integration_code = 'AGENT'; UPDATE integrations SET secret_registered = false WHERE code = 'AGENT';")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

# ── ③ 운영 화면(브라우저) ──────────────────────────────────────────────
if ADMIN_WEB and DB and API:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if sync_playwright:
        was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
        had_key = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'AGENT'") != '0'
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
                if not had_key:
                    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
                    call('PUT', '/admin/agent/key', {'value': FAKE}, T_)
                pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-agent-switches]')
                ok('③ 최고 관리자 — 「AI 스위치」 칸 · 상한 줄 · 5개 줄 · 단추', box.count() == 1 and box.locator('[data-agent-switch]').count() == 5
                   and box.locator('button', has_text='켜기').count() >= 1, str(box.locator('[data-agent-switch]').count()))
                cap = box.locator('[data-agent-cap]')
                cap.locator('input').fill('7'); cap.locator('button', has_text='저장').click(); pg.wait_for_timeout(2000)
                ok('③ 월 상한 저장 → $7', psql("SELECT value FROM site_settings WHERE key = 'agent.monthly_cap_usd'") == '7' and '$7' in cap.inner_text(), cap.inner_text()[:60])
                row = box.locator('[data-agent-switch="agent.enabled"]')
                row.locator('button', has_text='켜기').click(); pg.wait_for_timeout(2000)
                ok('③ AI 전체 켜기(확인 창) → 켜짐 · 위 숫자판도 켜짐', psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'") == 'on' and '켜짐' in row.inner_text()
                   and '켜짐' in pg.locator('[data-agent-kpi]').inner_text(), row.inner_text()[:60])
                pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/v1129_agent_switches.png', full_page=False)
                row.locator('button', has_text='끄기').click(); pg.wait_for_timeout(2000)
                ok('③ 끄기 → 꺼짐', psql("SELECT value FROM site_settings WHERE key = 'agent.enabled'") == 'off', '')
                pg.goto(ADMIN_WEB + '/#/integrations', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2000)
                go = pg.locator('[data-key-goto="AGENT"] a')
                ok('③ 외부 연동 — AI · 카카오맵 · 날씨 줄에 「키 넣는 곳으로 가기」', go.count() == 1 and pg.locator('[data-key-goto="MAP"]').count() == 1 and pg.locator('[data-key-goto="WEATHER"]').count() == 1, '')
                go.click(); pg.wait_for_timeout(2500)
                ok('③ AI 줄의 길 → AI 에이전트 화면 「AI 키」', pg.locator('[data-agent-key]').count() == 1, pg.url[-30:])
                pa = login(b, SELLER)
                pa.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pa.wait_for_timeout(2500)
                bx = pa.locator('[data-agent-switches]')
                ok('③ 운영(ADMIN) — 칸은 보이고 바꾸는 단추 · 상한 칸 없음', bx.count() == 1 and bx.locator('button').count() == 0 and bx.locator('input').count() == 0, '')
                b.close()
        finally:
            for k, v in was.items():
                psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
            if not had_key:
                psql("DELETE FROM integration_secrets WHERE integration_code = 'AGENT'; UPDATE integrations SET secret_registered = false WHERE code = 'AGENT';")
            psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
