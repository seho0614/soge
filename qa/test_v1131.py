"""v10.131 시험 — AI 상담 「답 · 넘김 비율」(D129 · docs/197)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1131.py

  ① 마이그레이션 D129 — agent_messages.handoff 칸 하나 · 167 · 지우는 문장 없음 / 코드 — 답 저장에 handoff · 통계 API · 화면 · 화면 목록
  ② (API · DB) 만든 대화로 셈이 맞는지(답 · AI 판단 넘김 · 거절 · 금칙어 · 기록 전 · 실제 넘김) · 7 · 14 · 30일 · 운영(ADMIN) 볼 수 있음 · 글은 응답에 없음
  ③ (운영 화면) AI 에이전트 › AI 상담 위 숫자판
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


M = rd('prisma/migrations/D129_agent_chat_handoff/migration.sql')
mig = sorted(d for d in os.listdir(os.path.join(K, 'prisma/migrations')) if os.path.isdir(os.path.join(K, 'prisma/migrations', d)))
ok('① 마이그레이션 167 · 마지막 D129 · 칸 하나 · 지우는 문장 없음', (len(mig), mig[-1]) in ((167, 'D129_agent_chat_handoff'), (168, 'D130_i18n_company_name'), (169, 'D131_terms_ai_adpersonal_drafts'), (170, 'D132_terms_privacy_fill'), (171, 'D133_agent_member_lookup'), (172, 'D134_review_ai_assist'), (173, 'D135_agent_chat_drafts'), (174, 'D136_mail_admin'), (175, 'D137_identity_nice'), (176, 'D138_alimtalk'), (177, 'D139_esign'), (178, 'D140_integ_tests'), (179, 'D141_safenum'), (180, 'D142_open_ready'), (181, 'D143_files_move'), (182, 'D144_open_date'), (183, 'D145_agent_privacy_gate'), (184, 'D146_switch_locks'), (185, 'D147_mail_lock'), (186, 'D148_alimtalk_etax_lock'))
   and 'ALTER TABLE public.agent_messages ADD COLUMN IF NOT EXISTS handoff boolean;' in M and not re.search(r'\b(DELETE FROM|DROP TABLE|TRUNCATE|DROP COLUMN)\b', M), f'{len(mig)} · {mig[-1]}')
S = rd('src/modules/agent/agent-chat.service.ts'); C = rd('src/modules/agent/agent.controller.ts'); W = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('① 코드 — 답 저장에 handoff · 통계(7 · 14 · 30일 · 숫자만) · 주소가 :id 보다 먼저 · ADMIN · SUPER',
   "stop_reason, handoff)" in S and 'out.handoff]);' in S and 'async adminStats(days = 7)' in S and '[7, 14, 30].includes(days)' in S
   and C.index("@Get('admin/agent/chats/stats')") < C.index("@Get('admin/agent/chats/:id')") and 'AgentChatStatsDto' in C, '')
ok('① 운영 화면 — AI 상담 위 숫자판(답 · 넘김 권함 · 실제 넘김 · 7 · 14 · 30일)', '<AgentChatStats />' in W and 'data-agent-chat-stats' in W and "`/admin/agent/chats/stats?days=${days}`" in W, '')
scr = {x['id']: x for x in json.loads(rd('spec/screens.json') or '{"screens":[]}')['screens']}
ok('① 화면 목록 SB-ADM-AGT-010 에 통계 API', 'GET /admin/agent/chats/stats' in scr.get('SB-ADM-AGT-010', {}).get('apis', []), '')
ok('① 판 v10.131 이상', tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 131), rd('VERSION').strip())


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


TAG = 'T1131 시험 상담'
SELLER = 'seller@x.com'
if API and DB:
    T_ = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': 'sgb-dev-1234'})['accessToken']
    psql(f"INSERT INTO account_roles(account_id, role) SELECT id, 'ADMIN' FROM accounts WHERE email = '{SELLER}' ON CONFLICT DO NOTHING;")
    TA = call('POST', '/auth/login', {'email': SELLER, 'password': 'sgb-dev-1234'})['accessToken']
    try:
        base = call('GET', '/admin/agent/chats/stats?days=7', t=T_)
        # 상담 2개 — ① 답 · AI 판단 넘김 · 거절(handoff true) ② 금칙어(handoff true) · 기록 전 답(handoff NULL · end_turn) · 기록 전 거절(NULL · refusal) · 실제 넘김
        psql(f"""WITH a AS (INSERT INTO agent_conversations (channel, guest_key) VALUES ('SITE_CHAT', '{TAG} 1') RETURNING id),
                      b AS (INSERT INTO agent_conversations (channel, guest_key, status) VALUES ('SITE_CHAT', '{TAG} 2', 'HANDED_OFF') RETURNING id)
                 INSERT INTO agent_messages (conversation_id, role, body, stop_reason, handoff)
                 SELECT a.id, x.role, x.body, x.sr, x.h FROM a, (VALUES ('user','q1',NULL,NULL::boolean), ('assistant','a1','end_turn',false),
                        ('user','q2',NULL,NULL), ('assistant','a2','end_turn',true), ('user','q3',NULL,NULL), ('assistant','a3','refusal',true)) x(role, body, sr, h)
                 UNION ALL
                 SELECT b.id, x.role, x.body, x.sr, x.h FROM b, (VALUES ('user','q4',NULL,NULL::boolean), ('assistant','a4','banned',true),
                        ('user','q5',NULL,NULL), ('assistant','a5','end_turn',NULL), ('user','q6',NULL,NULL), ('assistant','a6','refusal',NULL)) x(role, body, sr, h);""")
        s = call('GET', '/admin/agent/chats/stats?days=7', t=T_)
        dlt = {k: s.get(k, 0) - base.get(k, 0) for k in ('questions', 'answers', 'answered', 'handoffSuggested', 'byAi', 'refusal', 'banned', 'unknown', 'conversations', 'handedOff')}
        ok('② 셈 — 질문 6 · 답 6 · 답함 1 · 넘김 권함 4(AI 판단 1 · 거절 2 · 금칙어 1) · 기록 전 1 · 상담 2 · 실제 넘김 1',
           dlt == {'questions': 6, 'answers': 6, 'answered': 1, 'handoffSuggested': 4, 'byAi': 1, 'refusal': 2, 'banned': 1, 'unknown': 1, 'conversations': 2, 'handedOff': 1}, str(dlt))
        if base.get('answers', 0) == 0:
            ok('② 비율 — 답 20%(1/5 · 기록 전 뺌) · 넘김 권함 80% · 실제 넘김 50%', (s.get('answeredPct'), s.get('handoffPct'), s.get('handedOffPct')) == (20, 80, 50),
               f"{s.get('answeredPct')} · {s.get('handoffPct')} · {s.get('handedOffPct')}")
        ok('② 응답에 글(질문 · 답) 없음 — 숫자만', not any(x in json.dumps(s, ensure_ascii=False) for x in ('q1', 'a1', TAG)), '')
        ok('② 기간 — 14 · 30 일도 · 이상한 값은 7일로', call('GET', '/admin/agent/chats/stats?days=14', t=T_).get('days') == 14
           and call('GET', '/admin/agent/chats/stats?days=30', t=T_).get('days') == 30 and call('GET', '/admin/agent/chats/stats?days=999', t=T_).get('days') == 7, '')
        ok('② 운영(ADMIN)도 봄 · 로그인 안 하면 401/403', call('GET', '/admin/agent/chats/stats', t=TA).get('days') == 7 and call('GET', '/admin/agent/chats/stats').get('_err') in (401, 403), '')
        ok('② 「:id」 주소와 겹치지 않음(상담 대화 보기는 그대로)', call('GET', '/admin/agent/chats/not-a-uuid', t=T_).get('_err') == 404, '')

        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1100})
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', 'sgb-dev-1234'); pg.click('button[type=submit]'); pg.wait_for_timeout(1500)
                pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                box = pg.locator('[data-agent-chat-stats]')
                txt = box.inner_text() if box.count() else ''
                ok('③ 운영 화면 — 숫자판(답함 · 넘기기 권함 · 실제로 넘김 · 넘김 내용)', box.count() == 1 and 'AI 가 답함' in txt and '넘기기 권함' in txt and '실제로 넘김' in txt and 'AI 판단' in txt, txt[:120].replace('\n', ' '))
                box.locator('button', has_text='최근 30일').click(); pg.wait_for_timeout(1500)
                ok('③ 기간 단추(최근 30일)', '최근 30일' in box.locator('button.on').inner_text(), '')
                pg.screenshot(path=os.environ.get('SGB_QA_OUT', '.') + '/v1131_chat_stats.png', full_page=False)
                b.close()
    finally:
        psql(f"DELETE FROM agent_conversations WHERE guest_key LIKE '{TAG}%';")
        psql(f"DELETE FROM account_roles WHERE role = 'ADMIN' AND account_id = (SELECT id FROM accounts WHERE email = '{SELLER}');")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
