"""v10.151 시험 — AI 켜기 전 처리방침 확인(D145 · docs/231)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1151.py
  (점검판 API 는 AGENT_PROVIDER=MOCK 로 — 키 확인을 넘겨야 처리방침 확인까지 감)

  ① 코드 — D145(설정 on · 형식 · 지우는 문장 없음 · 183) · 서버 확인 · 운영 화면 줄 · 확인 창 · docs/231 · 판
  ② (API) 처리방침 1.1 없음 + 확인 on → AI 전체 422 PRIVACY_FIRST · ADMIN 은 확인 스위치 403 · SUPER 가 끄면 켜짐 ·
     확인 다시 켜도 켜진 AI 그대로 · AI 끄기는 언제나 · 1.1 게시 흉내(판 번호) → 확인 on 이어도 켜짐 · 되돌림
  ③ (운영 화면) AI 스위치 「AI 켜기 전 처리방침 확인」 줄
"""
import json, os, re, subprocess, urllib.error, urllib.request
os.environ['PGOPTIONS'] = (os.environ.get('PGOPTIONS', '') + ' -c sgb.terms_fix=on').strip()   # v10.157 D150 — 이 시험은 점검판의 게시된 처리방침을 잠시 고쳤다 되돌림

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
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
D = rd('prisma/migrations/D145_agent_privacy_gate/migration.sql')
mig = sorted(x for x in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', x)))
ok('① D145 — 설정 agent.require_privacy 처음 on · on/off 형식 · 지우는 문장 없음 · 183 이상',
   "('agent.require_privacy', 'on'" in D and "'^(on|off)$'" in D and 'ON CONFLICT (key) DO NOTHING' in D
   and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|UPDATE )\b', D) and len(mig) >= 183 and 'D145_agent_privacy_gate' in mig, f'{len(mig)} · {mig[-1]}')
AS = rd('src/modules/admin/admin.service.ts')
ok('① 서버 — AI 전체 켤 때 처리방침 1.1 확인 · 값 없으면 on · PRIVACY_FIRST', "new PolicyViolation('PRIVACY_FIRST'" in AS
   and any(x in AS.split('private async checkAiSwitch')[1] for x in ("string_to_array(version, '.')::int[] >= ARRAY[1,1]", 'public.fn_privacy_ai_ready() AS ok')) and "(g?.req ?? 'on').trim() !== 'off'" in AS, '')
SW = rd('web/src/app/admin/ailearn/AgentSwitches.tsx')
ok('① 운영 화면 — 「AI 켜기 전 처리방침 확인」 줄 · 확인 창 · SUPER 만 단추 · 처음 켜짐', 'data-agent-privacy-gate' in SW and 'AI 켜기 전 처리방침 확인' in SW
   and "val('agent.require_privacy') !== 'off'" in SW and 'flipGate' in SW and 'window.confirm(gate' in SW, '')
D231 = next((rd('docs/' + f) for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('231_')), '')
ok('① docs/231 — 대표 결정 · 처음 on · SUPER · 이미 켜진 AI 그대로', '서버에서 결정 관리자결정' in D231 and 'PRIVACY_FIRST' in D231 and '이미 켜진 AI 는 끄지 않습니다' in D231, '')
ok('① 판 v10.151 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 151), rd('VERSION').strip())


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


KEYS = ('agent.enabled', 'agent.monthly_cap_usd', 'agent.require_privacy')
SELLER = 'seller@x.com'
if API and DB:
    was = {k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'") for k in KEYS}
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': PW})['accessToken']
    sv = lambda k, v, t=T_: call('PATCH', '/admin/site-settings', {'key': k, 'value': v}, t)
    get = lambda k: psql(f"SELECT value FROM site_settings WHERE key = '{k}'")
    pv = psql("SELECT coalesce(max(version), '') FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED'")
    # v10.156 (D149) — 조건이 「국외 이전 조항이 든 처리방침 게시」로 바뀜 → 점검판에 게시된 처리방침의 그 제목을 잠시 가림(끝에 그대로 되돌림)
    TOK = '국외_T1151_'
    psql(f"UPDATE terms SET body = replace(body, '국외 이전', '{TOK}') WHERE code = 'PRIVACY' AND status = 'PUBLISHED'")
    has11 = (psql("SELECT public.fn_privacy_ai_ready()") == 't') if psql("SELECT to_regproc('public.fn_privacy_ai_ready') IS NOT NULL") == 't' \
        else psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' AND string_to_array(version, '.')::int[] >= ARRAY[1,1]") != '0'   # v10.156 (D149)
    mock = call('GET', '/admin/agent/status', t=T_).get('keySource') == 'MOCK'
    try:
        ok('② 점검판 — AI 엔진 MOCK · 처리방침 1.1 게시 없음(이 시험의 전제)', mock and not has11, f'게시 판 {pv or "없음"}')
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'agent.enabled'; UPDATE site_settings SET value = 'on' WHERE key = 'agent.require_privacy';")
        sv('agent.monthly_cap_usd', '5')
        r = sv('agent.enabled', 'on')
        ok('② 확인 on + 1.1 없음 → AI 전체 422 PRIVACY_FIRST · 그대로 꺼짐', r.get('_err') == 422 and r.get('code') == 'PRIVACY_FIRST' and get('agent.enabled') == 'off', str(r))
        ok('② 운영(ADMIN)은 확인 스위치를 못 바꿈(403 AI_SETTING_SUPER)', sv('agent.require_privacy', 'off', TA).get('code') == 'AI_SETTING_SUPER' and get('agent.require_privacy') == 'on', '')
        ok('② SUPER 가 확인 끔 → AI 전체 켜짐', sv('agent.require_privacy', 'off').get('_err') is None and sv('agent.enabled', 'on').get('_err') is None and get('agent.enabled') == 'on', '')
        ok('② 확인 다시 켜도 이미 켜진 AI 는 그대로', sv('agent.require_privacy', 'on').get('_err') is None and get('agent.enabled') == 'on', '')
        ok('② AI 끄기는 언제나 됨', sv('agent.enabled', 'off').get('_err') is None and get('agent.enabled') == 'off', '')
        ok('② 형식 오류(ON) 거절', sv('agent.require_privacy', 'ON').get('_err') in (400, 422) and get('agent.require_privacy') == 'on', '')
        aud = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'SITE_SETTING_UPDATE' AND after_data::text LIKE '%agent.require_privacy%' AND occurred_at > now() - interval '5 minutes'")
        ok('② 감사 기록 — 확인 스위치 바꿈', aud not in ('', '0'), aud)
        # 1.1 게시 흉내 — 게시된 처리방침이 있으면 그 판 번호만 잠시 1.1 로(없으면 건너뜀) · v10.156 부터는 가린 국외 이전 조항을 되살려 흉내
        pid = psql("SELECT id FROM terms WHERE code = 'PRIVACY' AND status = 'PUBLISHED' ORDER BY effective_from DESC LIMIT 1")
        psql(f"UPDATE terms SET body = replace(body, '{TOK}', '국외 이전') WHERE code = 'PRIVACY'")
        if pid:
            ver0 = psql(f"SELECT version FROM terms WHERE id = '{pid}'")
            moved = psql(f"UPDATE terms SET version = '1.1' WHERE id = '{pid}' RETURNING 1")
            if moved == '1':
                try:
                    r = sv('agent.enabled', 'on')
                    ok('② 처리방침 1.1 게시 뒤 → 확인 on 이어도 켜짐', r.get('_err') is None and get('agent.enabled') == 'on', str(r)[:80])
                finally:
                    psql(f"UPDATE terms SET version = '{ver0}' WHERE id = '{pid}'")
            else:
                print('  (게시된 처리방침 판 번호를 바꿀 수 없음 — 1.1 확인 건너뜀)')
    finally:
        for k, v in was.items():
            psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}';")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")
        psql(f"UPDATE terms SET body = replace(body, '{TOK}', '국외 이전') WHERE code = 'PRIVACY'")
    ok('② 되돌림', all(get(k) == v for k, v in was.items()) and psql(f"SELECT count(*) FROM terms WHERE body LIKE '%{TOK}%'") == '0', str(was))

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
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
            pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            row = pg.locator('[data-agent-privacy-gate]')
            ok('③ AI 스위치 맨 위 「AI 켜기 전 처리방침 확인」 · 켜짐(막음) · 단추', row.count() == 1 and row.get_attribute('data-agent-privacy-gate') == 'on'
               and '켜짐(막음)' in row.inner_text() and row.locator('button').count() == 1, row.inner_text()[:80] if row.count() else '없음')
            if row.count(): row.scroll_into_view_if_needed()
            pg.screenshot(path=os.path.join(HERE, 'v1151_privacy_gate.png'), full_page=False)
            b.close()

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
