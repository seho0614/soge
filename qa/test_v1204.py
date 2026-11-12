"""v10.204 시험 — AI 가동 지켜보기 · AI 상한 80% 경고 · 하루 요약 AI 줄 · 약관 재동의 현황(D181 · docs/326)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1204.py

  ① 코드 — D181(설정 agent.cap_warn_pct · 80% 경고 · fn_agent_watch_state · 급한 알림 대상 · 지우는 문장 없음) · 정기 작업 launch_watch 의 AI 알림 ·
     하루 요약 · 지켜보기 AI 줄 · 재동의 줄 · 약관 목록 동의 현황 · 운영 화면(지켜보기 · 약관 · 알림 이름) · 문서 326 · 322 · 판
  ② (DB · 거래 안에서 되돌림) 80% 경고 한 번 · 급한 알림 대상 · 100% 는 그대로 끔 / 시행 예정 처리방침(국외 이전 조항 · 3일 안) 감지 · 판마다 한 번
  ③ (API) AI 사용 가능해짐 한 번(빠진 것 → 경고) · 하루 요약 AI 줄 = DB 숫자 · 재동의 줄 · 약관 목록 동의 현황 = v_term_not_agreed · 지켜보기
  ④ (화면) 운영 화면 첫 화면 AI 줄 · 약관 동의 칸 · 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MIG = rd('prisma/migrations/D181_ai_watch_reconsent/migration.sql')
ok('① D181 — 설정 agent.cap_warn_pct(80 · 1 ~ 99) · 80% 경고 AGENT_CAP_NEAR(그달 한 번 · 100% 끄기 그대로) · fn_agent_watch_state · 급한 알림 대상 3종(메일 · 텔레그램) · 지우는 문장 없음',
   "('agent.cap_warn_pct', '80', 'GLOBAL'" in MIG and "'^([1-9]|[1-9][0-9])$'" in MIG
   and "alert_code = 'AGENT_CAP_NEAR' AND detail->>'month' = v_ym" in MIG and "VALUES ('AGENT_CAP_NEAR', 'WARN', clock_timestamp()," in MIG
   and "UPDATE public.site_settings SET value = 'off', updated_at = now() WHERE key = 'agent.enabled';" in MIG
   and 'CREATE OR REPLACE FUNCTION public.fn_agent_watch_state()' in MIG and "u.effective_from <= now() + interval '3 days'" in MIG
   and MIG.count("'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR'))") == 2 and 'DROP ' not in MIG, '')
LW = rd('src/modules/admin/launch-watch.service.ts'); SC = rd('src/worker/scheduler.service.ts'); AG = rd('src/modules/agent/agent.service.ts')
ok('① 정기 작업 launch_watch — AI 사용 가능해짐(한 번 · 빠진 것 있으면 경고) · 준비 덜 됨(판마다 한 번) · 키는 출처만(keySource) · 급한 알림 메일 · 텔레그램보다 앞',
   'const aw = await this.launchWatch.agentWatch();' in SC and "this.alert('AGENT_LIVE', aw.live.severity" in SC and "this.alert('AGENT_READY_GAP', 'WARN'" in SC
   and SC.index('const aw = await this.launchWatch.agentWatch();') < SC.index('const am = await this.alertMail();')
   and 'SELECT * FROM fn_agent_watch_state()' in LW and "keySource === 'NONE' ? 'AI 키 없음'" in LW and "'월 상한 0'" in LW and "'AI 전체 꺼짐'" in LW
   and 'async keySource(): Promise<AgentKeySource> { return (await this.resolve()).source; }' in AG
   and 'private readonly agent: AgentService' in LW, '')
ok('① 하루 요약 · 지켜보기 — AI 줄(어제 · 오늘 · 잠김 · 꺼짐 · 이번 달 / 상한 %) · 재동의 줄(남은 것만) · v_term_not_agreed 와 같은 셈',
   "...agentLines(await this.agentDay('yesterday'), '어제')," in LW and '...reconsentLines(await this.reconsent()),' in LW
   and "ai: agentLines(await this.agentDay('today'), '오늘')" in LW and "'AI — 잠김(국외 이전 조항이 든 처리방침이 " in LW and "['AI — 꺼짐']" in LW
   and '`재동의 — ${r.title} ${r.version}: ${r.agreed} / ${r.target}' in LW and 'FROM v_term_not_agreed n WHERE n.code = t.code' in LW
   and LW.index("...agentLines(await this.agentDay('yesterday')") < LW.index('diskLine(serverHealth()),'), '')
TS_ = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
ok('① 약관 목록 — 필수 약관 지금 판만 consent(target · agreed · missing) · DTO 순서(TermConsentDto 가 앞)',
   'END AS consent' in TS_ and "'missing', (SELECT count(*)::int FROM v_term_not_agreed n WHERE n.code = t.code)" in TS_
   and 'export class TermConsentDto' in TD and TD.index('class TermConsentDto') < TD.index('class TermDetailDto') and 'consent?: TermConsentDto | null;' in TD, '')
LX = rd('web/src/app/admin/LaunchWatch.tsx'); TX = rd('web/src/app/admin/TermsPanel.tsx'); OX = rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 운영 화면 — 지켜보기 AI 줄 · 재동의 줄 · 약관 「동의 n / n · 남음」 · 운영 알림 이름 3',
   'data-watch-ai=""' in LX and 'data-watch-reconsent=' in LX and '<a href="#/ai-ops/agent">AI 에이전트 →</a>' in LX
   and 'data-term-consent={`${t.consent.agreed}/${t.consent.target}`}' in TX
   and "AGENT_LIVE: 'AI 사용 가능해짐'" in OX and "AGENT_READY_GAP: 'AI 준비 덜 됨'" in OX and "AGENT_CAP_NEAR: 'AI 월 상한 가까움'" in OX, '')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D322 = next((rd('docs/' + f) for f in docs if f.startswith('322_')), '')
ok('① 문서 326 · 운영 지침서 322 에 알림 3종 · VERSION v10.204 이상',
   any(f.startswith('326_') for f in docs) and all(f'| `{c}` |' in D322 for c in ('AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR'))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 204), rd('VERSION').strip())


# ── ② · ③ · ④ ─────────────────────────────────────────────────────────
def call(m, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m)
    try:
        raw = urllib.request.urlopen(r, timeout=120).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


SUPU, MISSU = 'admin@x.com', 't1204none@x.com'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    sv = lambda k: psql(f"SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = '{k}'), 'NULL')")
    cap0, en0 = sv('agent.monthly_cap_usd'), sv('agent.enabled')
    try:
        # ② 80% 경고 — 거래 안에서(비용 · 알림 · 스위치 모두 되돌림)
        model = psql("SELECT model FROM agent_model_prices ORDER BY input_per_m DESC LIMIT 1")
        out = psql(
            "BEGIN; UPDATE site_settings SET value = 'on' WHERE key = 'agent.enabled'; "
            "DELETE FROM ops_alerts WHERE alert_code IN ('AGENT_CAP_NEAR', 'AGENT_CAP_REACHED'); "
            "UPDATE ops_alerts SET mailed_at = coalesce(mailed_at, now() - interval '2 hours'), pushed_at = coalesce(pushed_at, now() - interval '2 hours'); "
            f"SELECT 'X:' || (fn_agent_record_usage('SITE_CHAT', '{model}', 10000000, 0, 0) > 0)::text; "
            "UPDATE site_settings SET value = round(fn_agent_month_cost() / 0.85, 2)::text WHERE key = 'agent.monthly_cap_usd'; "
            f"SELECT 'Y:' || fn_agent_record_usage('SITE_CHAT', '{model}', 1000, 0, 0)::text; "
            f"SELECT 'Y:' || fn_agent_record_usage('SITE_CHAT', '{model}', 1000, 0, 0)::text; "
            "SELECT 'N:' || count(*) || ':' || coalesce(max(severity), '') || ':' || coalesce(max(detail->>'month'), '') FROM ops_alerts WHERE alert_code = 'AGENT_CAP_NEAR'; "
            "SELECT 'T:' || max(title) FROM ops_alerts WHERE alert_code = 'AGENT_CAP_NEAR'; "
            "SELECT 'P:' || (SELECT count(*) FROM fn_ops_alert_mail_pending() WHERE alert_code = 'AGENT_CAP_NEAR') || ':' || (SELECT count(*) FROM fn_ops_alert_push_pending() WHERE alert_code = 'AGENT_CAP_NEAR'); "
            "SELECT 'E1:' || value FROM site_settings WHERE key = 'agent.enabled'; "
            "UPDATE site_settings SET value = round(fn_agent_month_cost() * 0.99, 2)::text WHERE key = 'agent.monthly_cap_usd'; "
            f"SELECT 'Y:' || fn_agent_record_usage('SITE_CHAT', '{model}', 1000, 0, 0)::text; "
            "SELECT 'R:' || count(*) || ':' || (SELECT value FROM site_settings WHERE key = 'agent.enabled') FROM ops_alerts WHERE alert_code = 'AGENT_CAP_REACHED'; "
            "SELECT 'N2:' || count(*) FROM ops_alerts WHERE alert_code = 'AGENT_CAP_NEAR'; ROLLBACK;")
        g = {l.split(':', 1)[0]: l.split(':', 1)[1] for l in out.splitlines() if ':' in l and not l.startswith('Y:')}
        ym = psql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')")
        ok('② AI 상한 80% — 넘으면 AGENT_CAP_NEAR 경고 한 번(그달 · 두 번째 기록에 또 안 남김) · 급한 알림 메일 · 텔레그램 대상 · 켜진 채 · 100% 에 닿으면 그대로 끄고 긴급 · 거래 되돌림',
           g.get('X') == 'true' and g.get('N') == f'1:WARN:{ym}' and '상한의 8' in g.get('T', '') and g.get('P') == '1:1' and g.get('E1') == 'on'
           and g.get('R') == '1:off' and g.get('N2') == '1' and sv('agent.monthly_cap_usd') == cap0, f'{model} · {g} · {ym}')

        # ② 시행 예정 처리방침(국외 이전 조항 · 3일 안) — 거래 안에서 판을 넣어 봄(게시 판은 지울 수 없어 거래 둘)
        NOAI = "INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('PRIVACY', '9.9101', '시험 처리방침', E'## 제1조 시험\\n국외 조항 없음', true, now() - interval '1 second', 'PUBLISHED'); "
        AI_ = lambda v, d: f"INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('PRIVACY', '{v}', '시험 처리방침', E'## 제6조 개인정보의 국외 이전\\n시험', true, now() + interval '{d} days', 'PUBLISHED'); "
        out = psql(
            "BEGIN; " + NOAI + AI_('9.9102', 2) + "DELETE FROM ops_alerts WHERE alert_code = 'AGENT_READY_GAP'; "
            "SELECT 'S1:' || unlocked || ':' || privacy_ver || ':' || coalesce(upcoming_ver, '-') || ':' || upcoming_day || ':' || gap_sent FROM fn_agent_watch_state(); "
            "INSERT INTO ops_alerts(alert_code, severity, title, detail) VALUES ('AGENT_READY_GAP', 'WARN', '시험', '{\"version\": \"9.9102\"}'); "
            "SELECT 'S2:' || gap_sent FROM fn_agent_watch_state(); ROLLBACK;")
        out2 = psql("BEGIN; " + NOAI + AI_('9.9103', 5) + "SELECT 'S3:' || unlocked || ':' || coalesce(upcoming_ver, '-') FROM fn_agent_watch_state(); ROLLBACK;")
        g = {l.split(':', 1)[0]: l.split(':', 1)[1] for l in (out + '\n' + out2).splitlines() if ':' in l}
        d2 = psql("SELECT to_char((now() + interval '2 days') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')")
        ok('② 처리방침 지금 판에 국외 이전 조항 없음 + 3일 안 시행 예정 판에 있음 → 잠김 · 그 판 · 시행일(한국 날짜) · 「준비 덜 됨」 남기면 그 판은 다시 안 남김 · 5일 뒤 판은 아직 아님',
           g.get('S1') == f'false:9.9101:9.9102:{d2}:false' and g.get('S2') == 'true' and g.get('S3') == 'false:-', f'{g} · {out[:120]} · {out2[:120]}')

        # ③ AI 사용 가능해짐 — 잠금이 풀린 점검판에서 한 번(월 상한 0 → 경고 · 빠진 것 적힘)
        for e in (SUPU,): consent_ok.agree(e, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        unlocked = psql('SELECT fn_privacy_ai_ready()') == 't'
        psql("DELETE FROM ops_alerts WHERE alert_code = 'AGENT_LIVE'")
        psql("UPDATE site_settings SET value = '0' WHERE key = 'agent.monthly_cap_usd'")
        j1 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        lv = psql("SELECT count(*) || '|' || coalesce(max(severity), '') || '|' || coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'AGENT_LIVE'")
        n_, sev, ttl = (lv.split('|', 2) + ['', ''])[:3]
        ok('③ AI 잠금이 풀린 상태 → 정기 작업이 「AI 사용 가능해짐」 한 번(두 번째 작업에 또 안 남김) · 월 상한 0 → 경고 · 제목에 빠진 것 · 스위치 상태',
           (unlocked and n_ == '1' and sev == 'WARN' and '빠진 것: ' in ttl and '월 상한 0' in ttl and '검수 보조 ' in ttl and 'AI 상담 ' in ttl
            and (j1.get('detail') or {}).get('agentLive') == 'WARN' and (j2.get('detail') or {}).get('agentLive') is None)
           or (not unlocked and n_ == '0'),
           f'unlocked={unlocked} · {lv[:200]} · {(j1.get("detail") or {}).get("agentLive")} · {(j2.get("detail") or {}).get("agentLive")}')

        # ③ 하루 요약 AI 줄 = DB 숫자 · 재동의 줄 · 약관 목록 동의 현황
        pw = psql(f"SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
        psql(f"INSERT INTO accounts(email, name, password_hash) VALUES ('{MISSU}', '시험동의없음1204', '{pw}') ON CONFLICT DO NOTHING")
        psql(f"UPDATE accounts SET status = 'ACTIVE' WHERE email = '{MISSU}'")
        psql("UPDATE site_settings SET value = '50' WHERE key = 'agent.monthly_cap_usd'")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'agent.enabled'")
        dg = call('GET', '/admin/launch-watch/digest', None, TS)
        txt = dg.get('text') or ''
        Y = "((now() AT TIME ZONE 'Asia/Seoul')::date - 1)"
        exp = psql(
            f"SELECT (SELECT count(*) FROM agent_conversations WHERE channel = 'SITE_CHAT' AND (created_at AT TIME ZONE 'Asia/Seoul')::date = {Y}) || '|' || "
            f"(SELECT count(*) FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id WHERE c.channel = 'SITE_CHAT' AND m.role = 'assistant' AND (m.created_at AT TIME ZONE 'Asia/Seoul')::date = {Y}) || '|' || "
            f"(SELECT count(*) FROM agent_messages m JOIN agent_conversations c ON c.id = m.conversation_id WHERE c.channel = 'SITE_CHAT' AND m.role = 'assistant' AND m.handoff IS TRUE AND (m.created_at AT TIME ZONE 'Asia/Seoul')::date = {Y}) || '|' || "
            f"(SELECT count(*) FROM ai_review_opinions WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date = {Y}) || '|' || "
            f"(SELECT round(coalesce(sum(cost_usd), 0), 2) FROM agent_usage_daily WHERE day = {Y}) || '|' || round(fn_agent_month_cost(), 2)")
        c_, a_, h_, r_, co_, mo_ = (exp.split('|') + [''] * 6)[:6]
        want = f'AI — 어제 상담 대화 {c_} · 답 {a_} · 사람에게 넘김 {h_} · 검수 보조 {r_}건 · 비용 ${co_}'
        want2 = f'이번 달 ${mo_} / 상한 $50 ('
        ok('③ 하루 요약(지금 보기) — AI 줄 = DB 숫자(어제 상담 대화 · 답 · 넘김 · 검수 보조 · 비용) · 이번 달 / 상한 % · 디스크 줄보다 앞',
           unlocked and want in txt and want2 in txt and txt.index(want) < txt.index('서버 디스크') or (not unlocked and 'AI — ' in txt),
           f'{want} · {want2} · {[l for l in txt.splitlines() if "AI" in l or "이번 달" in l][:3]}')
        rows = call('GET', '/admin/terms', None, TS)
        cur = [r for r in rows if r.get('consent')] if isinstance(rows, list) else []
        db_ = psql("SELECT string_agg(t.code || ':' || (SELECT count(*) FROM v_term_not_agreed n WHERE n.code = t.code) || ':' || (SELECT count(*) FROM accounts WHERE status = 'ACTIVE'), ',' ORDER BY t.code) FROM v_terms_current t WHERE t.is_required")
        api_ = ','.join(f"{r['code']}:{r['consent']['missing']}:{r['consent']['target']}" for r in sorted(cur, key=lambda r: r['code']))
        nonreq = [r for r in rows if not r.get('isRequired') and r.get('consent')] if isinstance(rows, list) else ['?']
        miss1 = all(r['consent']['missing'] >= 1 and r['consent']['agreed'] + r['consent']['missing'] <= r['consent']['target'] for r in cur)
        recl = [l for l in txt.splitlines() if l.startswith('재동의 — ')]
        ok('③ 약관 목록 동의 현황 — 필수 약관 지금 판만 · 남음 = v_term_not_agreed · 대상 = 활동 중 계정 · 동의 안 한 시험 계정이 있어 남음 1 이상 · 하루 요약 재동의 줄(필수 약관마다)',
           len(cur) >= 1 and api_ == db_ and not nonreq and miss1 and len(recl) == len(cur) and all(f"{r['title']} {r['version']}: " in txt for r in cur),
           f'{api_} · db {db_} · {recl[:2]}')
        lw = call('GET', '/admin/launch-watch', None, TS)
        ok('③ 공개 직후 지켜보기 — ai(오늘 · 이번 달 / 상한) · reconsent(하루 요약과 같은 줄)',
           ((any(l.startswith('AI — 오늘 ') for l in (lw.get('ai') or [])) and any('/ 상한 $50' in l for l in (lw.get('ai') or []))) if unlocked else bool(lw.get('ai')))
           and (lw.get('reconsent') or []) == recl, f"{lw.get('ai')} · {(lw.get('reconsent') or [])[:2]}")

        # ④ 화면
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            seen = {}; errs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['ai'] = pg.evaluate("() => document.querySelector('[data-watch-ai]')?.textContent ?? ''")
                seen['rc'] = pg.evaluate("() => document.querySelector('[data-watch-reconsent]')?.getAttribute('data-watch-reconsent') ?? ''")
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['tc'] = pg.evaluate("() => [...document.querySelectorAll('[data-term-consent]')].map(e => e.textContent)")
                b.close()
            ok('④ 운영 화면 — 첫 화면 AI 줄 · 재동의 줄 · 약관 표 「동의 n / n · 남음」(필수 약관 지금 판 수만큼) · 오류 없음',
               (('AI — 오늘 ' in seen['ai'] and '상한 $50' in seen['ai']) if unlocked else 'AI — ' in seen['ai']) and seen['rc'] == str(len(recl)) and len(seen['tc']) == len(cur)
               and all('동의 ' in t and '남음 ' in t for t in seen['tc']) and not errs, f'{seen} · {errs[:2]}')
    finally:
        psql(f"UPDATE site_settings SET value = {cap0} WHERE key = 'agent.monthly_cap_usd'")
        psql(f"UPDATE site_settings SET value = {en0} WHERE key = 'agent.enabled'")
        psql(f"UPDATE accounts SET status = 'SUSPENDED' WHERE email = '{MISSU}'")   # 다른 시험의 「동의 안 한 계정」 수에 남지 않게

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
