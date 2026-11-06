"""v10.205 시험 — 처음 게시 약관 경고 · AI 켜기 다음 단계 알림(D182 · docs/328)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1205.py

  ① 코드 — publish-preview API(SUPER · 404 · 422 · 응답 스키마 · screens.json) · DTO 순서 · 게시 규칙 그대로 · 확인 창 경고 · D182(급한 알림 대상 · 지우는 문장 없음) ·
     launch_watch 의 AGENT_STEP_READY(단계마다 한 번 · 메일보다 앞) · 하루 요약 · 지켜보기 AI 켜기 단계 줄 · 운영 화면 · 문서 328 · 322 · 판
  ② (DB) 급한 알림 대상(메일 · 텔레그램)에 AGENT_STEP_READY — 거래 안에서 되돌림
  ③ (API) publish-preview — 처음 게시(앞 판 없음 → first · 대상 = 활동 중 계정) · 앞 판 있음(처리방침 · AI 이미 풀림 → aiUnlock 아님) · 없는 판 404 · 게시된 판 422
         AI 켜기 단계 — 「할 차례」 단계마다 한 번(두 번째 작업에 안 남김) · 하루 요약 · 지켜보기 줄 = rollout
         (키가 있어야 단계가 열림 — 회귀 실행기는 API 를 AGENT_PROVIDER=MOCK 으로 띄움 · 키가 없으면 알림 0 을 확인)
  ④ (화면) 게시 확인 창 「처음 게시」 경고(누르지 않고 닫음 · 게시 안 됨) · 첫 화면 AI 켜기 단계 줄 · 오류 없음
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
TC = rd('src/modules/catalog/terms.controller.ts'); TS_ = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
SP = rd('spec/screens.json')
ok('① publish-preview — GET terms/:code/publish-preview(컨트롤러 SUPER) · 응답 스키마 · 404 · 422(게시 · 보관) · screens.json SB-ADM-SIT-070 · DTO 가 결과 DTO 뒤 · 컨트롤러보다 앞에 선언',
   "@Get('terms/:code/publish-preview')" in TC and '@ApiOkResponse({ type: TermPublishPreviewDto })' in TC and "@Roles('SUPER')" in TC
   and "'TERM_PUBLISHED 이미 게시된 판 · TERM_ARCHIVED 보관된 판'" in TC and '"GET /admin/terms/{code}/publish-preview"' in SP
   and 'export class TermPublishPreviewDto' in TD and TD.index('class TermPublishResultDto') < TD.index('class TermPublishPreviewDto'), '')
ok('① 미리보기 셈 — 앞 판 = v_terms_current(이 판 빼고) · 대상 = 활동 중 계정(필수만) · AI 잠금 = fn_privacy_ai_ready 와 같은 제목 줄 규칙 · 빠진 것 3 · 게시 규칙(publish)은 그대로',
   "(SELECT version FROM v_terms_current WHERE code = $1 AND version <> $2) AS current" in TS_ and "target: t.required ? r.target : 0" in TS_
   and "code === 'PRIVACY' && !r.ready && /(^|\\n)#{1,4}[^\\n]*국외 이전/.test(t.body)" in TS_
   and "'AI 키 없음'" in TS_ and "'월 상한 0'" in TS_ and "'AI 전체 꺼짐'" in TS_ and 'private readonly agent: AgentService' in TS_
   and "throw new PolicyViolation('TERM_ADVERSE_30D'" in TS_ and 'first: !r.current' in TS_, '')
TX = rd('web/src/app/admin/TermsPanel.tsx')
ok('① 게시 확인 창 — 미리보기를 먼저 부름 · 「처음 게시하는 약관입니다 … 게시하는 순간 바로 시행」 · 활동 계정 n명 · 그날 게시 · AI 잠금 줄 · 결과 글',
   '/publish-preview?version=${encodeURIComponent(t.version)}' in TX and '⚠ 처음 게시하는 약관입니다 — ' in TX and '게시하는 순간 바로 시행됩니다' in TX
   and '모두 다음 로그인 때 이 약관에 동의해야 합니다.' in TX and '에 시행하려면 그날 게시하십시오.' in TX and '⚠ AI 잠금이 ' in TX
   and "' · 앞 판이 없어 지금부터 시행 중'" in TX
   and TX.index('/publish-preview?version=') < TX.index('if (!window.confirm(lines.join'), '')
MIG = rd('prisma/migrations/D182_ai_step_ready/migration.sql')
ok('① D182 — 급한 알림 대상(메일 · 텔레그램)에 AGENT_STEP_READY · 옛 대상 그대로 · 지우는 문장 없음',
   MIG.count("'AGENT_LIVE', 'AGENT_READY_GAP', 'AGENT_CAP_NEAR', 'AGENT_STEP_READY'))") == 2 and MIG.count("'STAFF_LOGIN_NEW',") == 2
   and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_mail_pending()' in MIG and 'CREATE OR REPLACE FUNCTION public.fn_ops_alert_push_pending()' in MIG
   and 'DROP ' not in MIG, '')
LW = rd('src/modules/admin/launch-watch.service.ts'); SC = rd('src/worker/scheduler.service.ts')
ok('① 정기 작업 launch_watch — AGENT_STEP_READY(정보 · 단계마다 한 번 · 검수 보조 · 상담 · 내 정보 조회 · 신청서 초안) · rollout 과 같은 셈 · 급한 알림 메일보다 앞',
   "const STEP_ALERT = ['REVIEW', 'CHAT', 'LOOKUP', 'DRAFTS'];" in LW and "x.state === 'READY'" in LW and "detail->>'step' AS step FROM ops_alerts WHERE alert_code = 'AGENT_STEP_READY'" in LW
   and 'return (await this.agent.rollout()) as AgentStep[];' in LW
   and "await this.alert('AGENT_STEP_READY', 'INFO', x.title, x.detail);" in SC
   and SC.index('const sr = await this.launchWatch.agentStepReady();') < SC.index('const am = await this.alertMail();'), '')
LX = rd('web/src/app/admin/LaunchWatch.tsx'); OX = rd('web/src/app/admin/OpsAlerts.tsx')
ok('① 하루 요약 · 지켜보기 — AI 켜기 단계 줄(처리방침 시행 뒤 · 지금 · 다음) · 운영 화면 줄 · 알림 이름',
   "...agentStepLine(await this.agentSteps())," in LW and 'aiStep: agentStepLine(await this.agentSteps()),' in LW and "if (!steps.length || steps[0].state !== 'DONE') return [];" in LW
   and 'data-watch-ai-step=""' in LX and "AGENT_STEP_READY: 'AI 다음 단계 켤 수 있음'" in OX, '')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
D322 = next((rd('docs/' + f) for f in docs if f.startswith('322_')), '')
ok('① 문서 328 · 운영 지침서 322 에 AGENT_STEP_READY · VERSION v10.205 이상',
   any(f.startswith('328_') for f in docs) and '| `AGENT_STEP_READY` |' in D322 and '`AGENT_STEP_READY`(D179 · D181 · D182' in D322
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 205), rd('VERSION').strip())


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


SUPU = 'admin@x.com'
NEWC, NEWV, PRIV = 'T1205', '1.0', '9.9201'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    sv = lambda k: psql(f"SELECT coalesce((SELECT quote_literal(value) FROM site_settings WHERE key = '{k}'), 'NULL')")
    keep = {k: sv(k) for k in ('agent.monthly_cap_usd', 'agent.enabled', 'agent.review_shadow.enabled', 'agent.chat.enabled')}
    usage_day = None
    try:
        # ② 급한 알림 대상 — 거래 안에서(다른 보내지 않은 알림은 보낸 것으로 두어 50건 묶음에 밀리지 않게)
        out = psql(
            "BEGIN; UPDATE ops_alerts SET mailed_at = coalesce(mailed_at, now() - interval '2 hours'), pushed_at = coalesce(pushed_at, now() - interval '2 hours'); "
            "INSERT INTO ops_alerts(alert_code, severity, title, detail) VALUES ('AGENT_STEP_READY', 'INFO', '시험', '{\"step\": \"T1205\"}'); "
            "SELECT 'P:' || (SELECT count(*) FROM fn_ops_alert_mail_pending() WHERE alert_code = 'AGENT_STEP_READY') || ':' || (SELECT count(*) FROM fn_ops_alert_push_pending() WHERE alert_code = 'AGENT_STEP_READY'); ROLLBACK;")
        ok('② AGENT_STEP_READY(정보) 도 급한 알림 메일 · 텔레그램 대상 · 거래 되돌림', 'P:1:1' in out, out[-80:])

        # ③ publish-preview
        consent_ok.agree(SUPU, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        psql(f"DELETE FROM terms WHERE (code = '{NEWC}') OR (code = 'PRIVACY' AND version = '{PRIV}')")
        r0 = psql(f"INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('{NEWC}', '{NEWV}', '시험 새 약관 1205', E'## 제1조 시험\\n본문', true, 'infinity', 'LEGAL_REVIEW')")
        p1 = call('GET', f'/admin/terms/{NEWC}/publish-preview?version={NEWV}', None, TS)
        act = psql("SELECT count(*) FROM accounts WHERE status = 'ACTIVE'")
        ok('③ 처음 게시(앞 판 없음) → first · current 없음 · 필수 → 대상 = 활동 중 계정 · 처리방침 아님 → AI 줄 없음',
           not r0.startswith('!') and p1.get('first') is True and p1.get('current') is None and p1.get('required') is True and str(p1.get('target')) == act
           and p1.get('aiUnlock') is False and p1.get('aiGaps') == [] and p1.get('aiSwitches') == '', f'{r0[:60]} · {p1} · {act}')
        cur = psql("SELECT version FROM v_terms_current WHERE code = 'PRIVACY'")
        ready = psql('SELECT fn_privacy_ai_ready()') == 't'
        r1 = psql(f"INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('PRIVACY', '{PRIV}', '시험 처리방침', E'## 제6조 개인정보의 국외 이전\\n시험', true, 'infinity', 'LEGAL_REVIEW')")
        p2 = call('GET', f'/admin/terms/PRIVACY/publish-preview?version={PRIV}', None, TS)
        ok('③ 앞 판이 있는 처리방침 → first 아님 · current = 지금 판 · AI 이미 풀려 있으면 aiUnlock 아님(잠겨 있으면 aiUnlock · 빠진 것 목록)',
           not r1.startswith('!') and bool(cur) and p2.get('first') is False and p2.get('current') == cur
           and ((ready and p2.get('aiUnlock') is False) or (not ready and p2.get('aiUnlock') is True and isinstance(p2.get('aiGaps'), list))),
           f'{r1[:60]} · cur={cur} · ready={ready} · {p2}')
        p3 = call('GET', f'/admin/terms/{NEWC}/publish-preview?version=9.9', None, TS)
        p4 = call('GET', f'/admin/terms/PRIVACY/publish-preview?version={cur}', None, TS)
        TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
        p5 = call('GET', f'/admin/terms/{NEWC}/publish-preview?version={NEWV}', None, TB)
        ok('③ 없는 판 404 · 게시된 판 422 TERM_PUBLISHED · 회원 403', p3.get('_err') == 404 and p4.get('_err') == 422 and p4.get('code') == 'TERM_PUBLISHED' and p5.get('_err') == 403,
           f"{p3.get('_err')} · {p4.get('_err')} {p4.get('code')} · {p5.get('_err')}")

        # ③ AI 켜기 다음 단계 — 키(점검판 MOCK 등) · 월 상한 · AI 전체가 갖춰지면 「검수 보조」 할 차례 → 한 번
        st = call('GET', '/admin/agent/status', None, TS)
        key_ok = st.get('keySource') not in (None, 'NONE')
        psql("UPDATE site_settings SET value = '50' WHERE key = 'agent.monthly_cap_usd'")
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'agent.enabled'")
        psql("UPDATE site_settings SET value = 'off' WHERE key IN ('agent.review_shadow.enabled', 'agent.chat.enabled')")
        psql("DELETE FROM ops_alerts WHERE alert_code = 'AGENT_STEP_READY'")
        ro = call('GET', '/admin/agent/rollout', None, TS)
        rs = {x['code']: x['state'] for x in ro} if isinstance(ro, list) else {}
        j1 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        j2 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        STEPS = ('REVIEW', 'CHAT', 'LOOKUP', 'DRAFTS')
        want1 = sorted(c for c in STEPS if rs.get(c) == 'READY')
        a1 = psql("SELECT count(*) || '|' || coalesce(string_agg(detail->>'step', ',' ORDER BY detail->>'step'), '') || '|' || coalesce(string_agg(DISTINCT severity, ','), '') || '|' || coalesce(string_agg(title, ' // ' ORDER BY id), '') FROM ops_alerts WHERE alert_code = 'AGENT_STEP_READY'")
        n1, s1, sev1, t1 = (a1.split('|', 3) + ['', '', ''])[:4]
        exp_review = rs.get('TERMS') == 'DONE' and key_ok
        ok('③ 키 · 월 상한 · AI 전체 갖춤 → 3 검수 보조 「할 차례」 → AGENT_STEP_READY 「할 차례」 단계마다 한 번(정보 · 두 번째 작업에 안 남김 · 제목에 단계 · 켜기는 최고 관리자) · 작업 결과 agentStep',
           (exp_review and 'REVIEW' in want1 and n1 == str(len(want1)) and s1 == ','.join(want1) and sev1 == 'INFO' and '3 AI 검수 보조' in t1 and '켜기는 최고 관리자' in t1
            and sorted((j1.get('detail') or {}).get('agentStep') or []) == want1 and (j2.get('detail') or {}).get('agentStep') == [])
           or (not exp_review and n1 == '0'),
           f'key={st.get("keySource")} · {rs} · {a1[:240]} · {(j1.get("detail") or {}).get("agentStep")} · {(j2.get("detail") or {}).get("agentStep")}')
        # 검수 보조를 7일 넘게 쓴 것으로(사용량 한 줄 · 스위치는 그대로 꺼 둠) → 4 AI 상담 「할 차례」 → 한 번 더(상담 단계만)
        model = psql("SELECT model FROM agent_model_prices ORDER BY input_per_m LIMIT 1")
        usage_day = psql(f"INSERT INTO agent_usage_daily(day, channel, model, requests, input_tokens, output_tokens, cache_read_tokens, cost_usd) "
                         f"VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date - 9, 'REVIEW_SHADOW', '{model}', 1, 0, 0, 0, 0) ON CONFLICT DO NOTHING RETURNING day::text") or None
        if usage_day and usage_day.startswith('!'): usage_day = None
        ro2 = call('GET', '/admin/agent/rollout', None, TS)
        rs2 = {x['code']: x['state'] for x in ro2} if isinstance(ro2, list) else {}
        j3 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
        a2 = psql("SELECT count(*) || '|' || coalesce(string_agg(detail->>'step', ',' ORDER BY detail->>'step'), '') FROM ops_alerts WHERE alert_code = 'AGENT_STEP_READY'")
        want2 = sorted(set(want1) | {c for c in STEPS if rs2.get(c) == 'READY'})
        new2 = sorted(c for c in STEPS if rs2.get(c) == 'READY' and c not in want1)
        ok('③ 검수 보조 7일 넘음 → 4 AI 상담 「할 차례」 → 새로 할 차례가 된 단계만 한 번 더(이미 남긴 단계는 다시 안 남김)',
           (exp_review and rs2.get('CHAT') == 'READY' and a2 == f"{len(want2)}|{','.join(want2)}"
            and sorted((j3.get('detail') or {}).get('agentStep') or []) == new2)
           or (not exp_review and a2.startswith('0|')),
           f'usage={usage_day} · {rs2} · {a2} · {(j3.get("detail") or {}).get("agentStep")}')

        # ③ 하루 요약 · 지켜보기 — AI 켜기 단계 줄(rollout 과 같은 글)
        dg = call('GET', '/admin/launch-watch/digest', None, TS); txt = dg.get('text') or ''
        lw = call('GET', '/admin/launch-watch', None, TS)
        stl = [l for l in txt.splitlines() if l.startswith('AI 켜기 단계 — ')]
        cur3 = next((x for x in reversed(ro2) if x.get('on')), None) if isinstance(ro2, list) else None
        ok('③ 하루 요약 AI 켜기 단계 줄 — 지금(켜진 마지막 단계 · 숫자) · 다음 단계 · 할 차례 · 지켜보기 aiStep 과 같음(처리방침 시행 전이면 줄 없음)',
           (rs2.get('TERMS') == 'DONE' and len(stl) == 1 and cur3 is not None and f"지금 {cur3['step']} {cur3['label']}: {cur3['now']}" in stl[0]
            and ((' · 다음 3 AI 검수 보조' in stl[0] and stl[0].endswith('할 차례')) if exp_review else True) and (lw.get('aiStep') or []) == stl)
           or (rs2.get('TERMS') != 'DONE' and not stl and not lw.get('aiStep')),
           f'{stl} · {lw.get("aiStep")}')

        # ④ 화면
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            seen = {}; errs = []; msgs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.on('dialog', lambda d: (msgs.append(d.message), d.dismiss()))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/home', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['step'] = pg.evaluate("() => document.querySelector('[data-watch-ai-step]')?.textContent ?? ''")
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                day4 = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date + 4, 'YYYY-MM-DD')")
                pg.fill('[data-terms-date]', day4); pg.wait_for_timeout(300)
                pg.locator(f'[data-term-row="{NEWC}:{NEWV}"] [data-term-publish]').click(); pg.wait_for_timeout(2500)
                b.close()
            m = msgs[0] if msgs else ''
            stat = psql(f"SELECT status FROM terms WHERE code = '{NEWC}' AND version = '{NEWV}'")
            ok('④ 게시 확인 창 — 처음 게시 경고(시행일 4일 뒤로 넣어도 게시하는 순간 시행 · 활동 계정 n명 · 그날 게시) · 닫으면 게시 안 됨 · 첫 화면 AI 켜기 단계 줄 · 오류 없음',
               '⚠ 처음 게시하는 약관입니다 — 시행일을 ' in m and '게시하는 순간 바로 시행됩니다' in m and f'활동 계정 {int(act):,}명 모두' in m and '그날 게시하십시오' in m
               and stat == 'LEGAL_REVIEW' and (('AI 켜기 단계 — ' in seen['step']) if rs2.get('TERMS') == 'DONE' else seen['step'] == '') and not errs,
               f'{m[:220]!r} · {stat} · {seen} · {errs[:2]}')
    finally:
        for k, v in keep.items():
            psql(f"UPDATE site_settings SET value = {v} WHERE key = '{k}'")
        if usage_day:
            psql(f"DELETE FROM agent_usage_daily WHERE day = '{usage_day}' AND channel = 'REVIEW_SHADOW' AND requests = 1 AND cost_usd = 0")
        psql(f"DELETE FROM terms WHERE (code = '{NEWC}' AND status <> 'PUBLISHED') OR (code = 'PRIVACY' AND version = '{PRIV}' AND status <> 'PUBLISHED')")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
