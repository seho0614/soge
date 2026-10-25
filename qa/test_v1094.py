"""v10.94 시험 — AI 에이전트 0단계 틀(D116 · docs/149 · docs/151)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1094.py

  ① 마이그레이션 — 표 5개 · 요금표 3모델 · 스위치 전부 off · 상한 0 · 허용 함수 · 사용량 함수(상한 → 끄기 · 경보) · 일치율 뷰 · 154 · D116
  ② 서버 · 화면 — 상태 API 1개(운영) · 어댑터는 MOCK 만(밖으로 안 나감) · 승인 · 반려 기능 없음 · 화면 SB-ADM-AGT-010 · AI 운영 하위 탭
  ③ (DB) 거래 안에서 — 꺼짐 → 상한 0 → 허용 → 비용 쌓임 → 상한 닿음 → 저절로 꺼짐 · 경보 · 없는 모델 거부 · AI 의견은 검수 상태를 바꾸지 않음
  ④ (API) 상태 200 · 꺼짐 · 상한 0 · 통로 모두 막힘 · 요금표 3 · 회원 403
"""
import glob, json, os, re, subprocess, urllib.error, urllib.request

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB'); API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


M = rd('prisma/migrations/D116_agent_base/migration.sql')
ok('① 표 5개', all(f'CREATE TABLE IF NOT EXISTS public.{t}' in M for t in ('agent_conversations', 'agent_messages', 'ai_review_opinions', 'agent_model_prices', 'agent_usage_daily')), '')
ok('① 요금표 3모델 · 기준일 2026-10-06', all(f"('{m}'," in M for m in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5')) and M.count("'2026-10-06'") == 3, '')
sw = re.findall(r"\('(agent\.[a-z_.]+)', '([^']*)'", M)
d = dict(sw)
ok('① 스위치 4개 off · 상한 0 · 하루 한도 · 모델', all(d.get(k) == 'off' for k in ('agent.enabled', 'agent.review_shadow.enabled', 'agent.chat.enabled', 'agent.chat.member_lookup.enabled'))
   and d.get('agent.monthly_cap_usd') == '0' and d.get('agent.review_model') == 'claude-sonnet-5-5' and d.get('agent.chat_model') == 'claude-haiku-5-5', str(len(d)))
ok('① 허용 함수 — 꺼짐 · 통로 · 상한 0 · 상한 닿음', all(x in M for x in ("'AGENT_OFF'", "'CHANNEL_NOT_READY'", "'CHANNEL_OFF'", "'CAP_ZERO'", "'CAP_REACHED'")), '')
ok('① 사용량 함수 — 상한에 닿으면 agent.enabled off · 경보 AGENT_CAP_REACHED', "SET value = 'off'" in M and "'AGENT_CAP_REACHED', 'CRITICAL'" in M, '')
ok('① 지우는 문장 없음 · 재실행 안전', not re.search(r'(?<!ON )\b(DELETE|TRUNCATE|DROP TABLE)\b', M) and M.count('ON CONFLICT (') >= 3, '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 154 · 마지막 D116(v10.103 부터 D117 · 155 — test_v1103)', (len(mig), mig[-1] if mig else '') in ((154, 'D116_agent_base'), (155, 'D117_i18n_content_overlay'), (156, 'D118_i18n_auto_translate')), f'{len(mig)} · {mig[-1] if mig else ""}')

C = rd('src/modules/agent/agent.controller.ts'); S = rd('src/modules/agent/agent.service.ts'); P = rd('src/modules/agent/agent.provider.ts')
ok('② API 1개 — GET admin/agent/status · 운영', re.findall(r"@(Get|Post|Put|Patch|Delete)\('([^']+)'\)", C) == [('Get', 'admin/agent/status')] and "@Roles('ADMIN', 'SUPER')" in C, '')
ok('② 어댑터 — MOCK · 환경 값 없으면 null(v10.104 부터 CLAUDE 는 키가 있을 때만 — test_v1104)', "env.AGENT_PROVIDER === 'MOCK'" in P and 'return null;' in P
   and ('import Anthropic' not in P or "env.AGENT_PROVIDER === 'CLAUDE' && (env.ANTHROPIC_API_KEY ?? '').length > 20" in P), '')
ok('② 판단은 DB 함수(fn_agent_allowed · fn_agent_record_usage)', 'fn_agent_allowed($1)' in S and 'fn_agent_record_usage($1, $2, $3, $4, $5)' in S, '')
ok('② 승인 · 반려 · 상태 바꾸기 없음(ai-agent #7)', not re.search(r"UPDATE\s+(review_items|listings|requests|deals|settlements)", S + C), '')
app = rd('src/app.module.ts')
ok('② app.module 등록', re.search(r'\bAgentController,', app) and re.search(r'\bAgentService,', app), '')
scr = json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']
t = [x for x in scr if x['id'] == 'SB-ADM-AGT-010']
ok('② 화면 SB-ADM-AGT-010 — #/ai-ops/agent · API 1', t and t[0].get('bo') == '#/ai-ops/agent' and t[0]['apis'] == ['GET /admin/agent/status'], '')
ops = rd('web/src/app/admin/AiOps.tsx'); AL = rd('web/src/app/admin/AiLearn.tsx'); W = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('② AI 운영 하위 탭 「AI 에이전트」 · 다시 내보내기', "{ key: 'agent', label: 'AI 에이전트', screen: 'SB-ADM-AGT-010' }" in ops and "{view === 'agent' && <AgentStatus />}" in ops
   and "export { AgentStatus } from './ailearn/AgentStatus';" in AL, '')
ok('② 화면 — 통로 · 사용량 · 일치율 · 요금표 · 요금 확인 안내', all(x in W for x in ('data-agent-channels', 'data-agent-usage', 'data-agent-agreement', 'data-agent-prices', '계약 전 Anthropic 요금표')), '')


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


if DB:
    rc, out, err = psql("""
BEGIN;
SELECT 'A:' || ok || ':' || coalesce(reason,'') FROM fn_agent_allowed('REVIEW_SHADOW');
UPDATE site_settings SET value = 'on' WHERE key IN ('agent.enabled', 'agent.review_shadow.enabled');
SELECT 'B:' || ok || ':' || coalesce(reason,'') FROM fn_agent_allowed('REVIEW_SHADOW');
UPDATE site_settings SET value = '0.01' WHERE key = 'agent.monthly_cap_usd';
SELECT 'C:' || ok || ':' || coalesce(reason,'') FROM fn_agent_allowed('REVIEW_SHADOW');
SELECT 'D:' || round(fn_agent_record_usage('REVIEW_SHADOW', 'claude-sonnet-5-5', 3000, 500, 0), 4);
SELECT 'E:' || value FROM site_settings WHERE key = 'agent.enabled';
SELECT 'F:' || count(*) FROM ops_alerts WHERE alert_code = 'AGENT_CAP_REACHED' AND raised_at >= now() - interval '1 minute';
SELECT 'G:' || ok || ':' || coalesce(reason,'') FROM fn_agent_allowed('AUDIT');
ROLLBACK;
""")
    L = out.split('\n')
    ok('③ 꺼짐 → 상한 0 → 허용', 'A:false:AGENT_OFF' in L and 'B:false:CAP_ZERO' in L and 'C:true:' in L, out[:200] or err[:200])
    ok('③ 비용 0.011 쌓임 → 상한 닿음 → 저절로 꺼짐 · 경보 1', 'D:0.0110' in L and 'E:off' in L and 'F:1' in L, out[:300])
    ok('③ 없는 통로(AUDIT)는 늘 막힘', any(x.startswith('G:false:') for x in L), '')
    rc, out, err = psql("BEGIN; SELECT fn_agent_record_usage('SITE_CHAT', 'claude-x', 1, 1, 0); ROLLBACK;")
    ok('③ 요금표에 없는 모델 거부', rc != 0 and '요금표에 없는 모델' in err, err[:120])
    rc, out, err = psql("""
BEGIN;
CREATE TEMP TABLE _r AS SELECT id, status FROM review_items ORDER BY submitted_at DESC LIMIT 1;
INSERT INTO ai_review_opinions (review_item_id, suggestion, reason_codes, model) SELECT id, 'REJECT', ARRAY['T'], 'claude-sonnet-5-5' FROM _r;
SELECT 'S:' || (SELECT r.status = _r.status FROM review_items r JOIN _r USING (id));
ROLLBACK;
""")
    ok('③ AI 의견을 넣어도 검수 상태 그대로', 'S:true' in out or out == '', out or err[:120])
    rc, out, err = psql("SELECT string_agg(key || '=' || value, ' ' ORDER BY key) FROM site_settings WHERE key IN ('agent.enabled','agent.monthly_cap_usd')")
    ok('③ 지금 DB — 꺼짐 · 상한 0', out == 'agent.enabled=off agent.monthly_cap_usd=0', out)

if API:
    def call(method, path, tok=None, body=None):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', **({'Authorization': f'Bearer {tok}'} if tok else {})})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    login = lambda e: call('POST', '/auth/login', body={'email': e, 'password': 'sgb-dev-1234'})[1]['accessToken']
    ADM, MEM = login('admin@x.com'), login(os.environ.get('MEMBER', 'person@x.com'))
    s1, j = call('GET', '/admin/agent/status', ADM)
    ok('④ 상태 200 · 꺼짐 · 상한 0 · 통로 2개(v10.104 부터 번역 더해 3개) 모두 막힘 · 요금표 3', s1 == 200 and j['enabled'] is False and j['capUsd'] == '0'
       and len(j['channels']) in (2, 3) and all(not c['ok'] for c in j['channels']) and len(j['prices']) == 3, f'{s1}')
    s2, _ = call('GET', '/admin/agent/status', MEM)
    ok('④ 회원 403', s2 == 403, f'{s2}')

_v = tuple(int(x) for x in re.findall(r'\d+', rd('VERSION')))
ok('VERSION v10.94 이상', _v >= (10, 94), '.'.join(map(str, _v)))
bad = [x for x in RES if not x[0]]
print(f'\n결과 — 통과 {len(RES) - len(bad)} · 실패 {len(bad)}')
raise SystemExit(1 if bad else 0)
