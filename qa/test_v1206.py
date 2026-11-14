"""v10.206 시험 — AI 첫 주 보고 · 위탁 목록 점검 · 카카오 위탁 줄 · 공휴일 · 운영 화면 CSS · postcheck 판 비교(D183 · docs/330)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1206.py

  ① 코드 — 카카오 줄(terms-text.js = docs/terms = D183 · Anthropic 줄 위 · 한 줄만 넣는 규칙) · v_agent_week · GET /admin/agent/week · 하루 요약 AI 7일 줄 ·
     위탁 목록 점검(GET /admin/terms/outsource-check · publish-preview outsourceGaps · 약관 화면) · 공휴일(표 · 함수 · API 3 · SUPER · 감사 · 화면) ·
     문의 답변 예정 = fn_business_day_after · 검수 마감도 공휴일 · 운영 화면 CSS(혼자 쓰인 btn · link · ghost 없음 · .plain · .block · .ghost.btn-sm) ·
     postcheck 판 비교 · 영어 사전 · 명세 · 문서 330 · 판
  ② (DB) 221 · D183 · 공휴일 처음 값 · 영업일(설 연휴 · 주말) · 검수 마감 · 카카오 줄 넣기 규칙(거래 안 · 초안에 한 줄 · 다시 돌려도 한 줄) · v_agent_week 7줄
  ③ (API) AI 첫 주 보고(사용량 · 상담 넣고 합 · 답 % · 기준 미달 · 하루 요약 줄 · 회원 403) · 공휴일(넣기 · 이름 고치기 · 다음 영업일이 밀림 · 빼기 · 404 · 422 · 감사 · 회원 403) ·
         위탁 목록 점검(AWS 늘 씀 · 쓰는 서비스는 목록에 있음 · 미리보기 outsourceGaps)
  ④ (화면) AI 첫 주 보고 표 8줄 · 공휴일 넣기 · 약관 화면 오류 없음
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'
KP = '| 카카오 | 지도 · 주소를 좌표로 바꾸기 · 동네 인증(위치로 동네 찾기) · 주변 장소 검색 |'
KO = '| 카카오 | 지도 · 주소 좌표 · 동네 인증 · 주변 장소 검색 | 매물 주소(도로명 또는 지번 — 동 · 호는 보내지 않음) · 동네 인증 · 맛집 찾기 때의 현재 위치 좌표 |'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
T = rd('scripts/terms-text.js'); M = rd('prisma/migrations/D183_ai_week_holidays_kakao/migration.sql')
def term(code):
    m = re.search(rf"\n  {code}: `((?:\\.|[^`\\])*)`", T, re.S)
    return m.group(1).replace('\\`', '`').replace('\\\\', '\\') if m else ''
P, O = term('PRIVACY'), term('OUTSOURCE')
ok('① 카카오 줄 — 처리방침 제5조 · 위탁 안내 제2조 표의 Anthropic 줄 바로 위 · 한 번씩 · terms-text.js = docs/terms · D183 같은 줄',
   P.count(KP) == 1 and f'{KP}\n| Anthropic, PBC(미국) | AI 상담 답변' in P and O.count(KO) == 1 and f'{KO}\n| Anthropic, PBC(미국) | AI 답변' in O
   and P.strip() in rd('docs/terms/PRIVACY.md') and O.strip() in rd('docs/terms/OUTSOURCE.md') and f'$R${KP}$R$' in M and f'$R${KO}$R$' in M, '')
ok('① D183 카카오 규칙 — 초안(DRAFT · LEGAL_REVIEW)에 한 줄만 · 게시된 판만 있으면 다음 번호 LEGAL_REVIEW · 이미 있으면 안 함 · 게시 안 함 · 지우는 문장 없음',
   "status IN ('DRAFT','LEGAL_REVIEW')" in M and "position('| 카카오 |' IN body) = 0" in M and "'LEGAL_REVIEW', r.display_order" in M
   and "SET status = 'PUBLISHED'" not in M and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M), '')
ok('① D183 — v_agent_week(7일 · 답 · 넘김 셈이 AI 켜기 단계와 같음) · public_holidays · fn_is_business_day · fn_business_day_after · fn_review_sla_due 가 공휴일도 건너뜀',
   'CREATE OR REPLACE VIEW public.v_agent_week' in M and "m.stop_reason IN ('refusal','max_tokens','bad_shape','banned')" in M
   and 'CREATE TABLE IF NOT EXISTS public.public_holidays' in M and 'FUNCTION public.fn_is_business_day(p_day date)' in M
   and 'FUNCTION public.fn_business_day_after(p_at timestamptz)' in M and 'WHILE NOT public.fn_is_business_day(t::date) LOOP' in M
   and "('2027-02-07', '설날')" in M and "('2027-09-15', '추석')" in M and "'2027-05-03'" not in M, '')
AC = rd('src/modules/agent/agent.controller.ts'); AS = rd('src/modules/agent/agent.service.ts'); SP = rd('spec/screens.json')
LW = rd('src/modules/admin/launch-watch.service.ts'); AW = rd('web/src/app/admin/ailearn/AgentWeek.tsx'); AST = rd('web/src/app/admin/ailearn/AgentStatus.tsx')
ok('① AI 첫 주 보고 — GET admin/agent/week(ADMIN · SUPER · 응답 스키마) · DTO 가 컨트롤러 앞 · v_agent_week · 기준 95% · 90% · 하루 요약 「AI 7일」 줄 · 화면 · 명세',
   "@Get('admin/agent/week')" in AC and '@ApiOkResponse({ type: AgentWeekDto })' in AC and AC.index('export class AgentWeekDto') < AC.index('export class AgentController')
   and AC.index('export class AgentWeekDayDto') < AC.index('export class AgentWeekDto') and 'FROM v_agent_week ORDER BY day' in AS
   and '< 95) below.push' in AS and '< 90) below.push' in AS and '...agentWeekLine(await this.agent.week())' in LW and '`AI 7일 — 상담 대화 ' in LW
   and "useApi<Week>('/admin/agent/week')" in AW and 'data-agent-week' in AW and '<AgentWeek ' in AST and '"GET /admin/agent/week"' in SP, '')
TC = rd('src/modules/catalog/terms.controller.ts'); TS_ = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts'); TX = rd('web/src/app/admin/TermsPanel.tsx')
ok('① 위탁 목록 점검 — GET terms/outsource-check(SUPER 컨트롤러) · AWS 늘 · AI 키 → Anthropic · 지도 켜짐 · 카카오 키 → 카카오 · 시행 중 → 초안 · publish-preview outsourceGaps · 약관 화면 맨 위 · 확인 창 경고 · 명세',
   "@Get('terms/outsource-check')" in TC and '@ApiOkResponse({ type: OutsourceCheckDto })' in TC and TC.index("@Get('terms/outsource-check')") < TC.index("@Put('terms/:code')")
   and "const OUTSOURCE_CODES = ['PRIVACY', 'OUTSOURCE'];" in TS_ and "used: aiKey !== 'NONE'" in TS_ and 'used: mapOn || !!kakaoKey' in TS_
   and 'private readonly geo: GeoService' in TS_ and 'outsourceGaps,' in TS_ and 'outsourceGaps!: string[]' in TD and 'export class OutsourceCheckDto' in TD
   and "useApi<OutsourceCheck>('/admin/terms/outsource-check')" in TX and 'data-terms-outsource' in TX and 'pv?.outsourceGaps?.length' in TX
   and '"GET /admin/terms/outsource-check"' in SP, '')
HC = rd('src/modules/holiday/holiday.controller.ts'); HS = rd('src/modules/holiday/holiday.service.ts'); HP = rd('web/src/app/admin/HolidayPanel.tsx')
PS = rd('src/modules/public/public.service.ts'); AM = rd('src/app.module.ts'); SI = rd('web/src/app/admin/SiteInfo.tsx')
ok('① 공휴일 — API 3(GET ADMIN · SUPER / PUT · DELETE SUPER · 감사 HOLIDAY_SAVE · HOLIDAY_DELETE) · 422 HOLIDAY_DATE · HOLIDAY_NAME · 운영 값 확인(다음 해 · 등급 기준) · 화면 · 명세 · 문의 답변 예정 = DB 함수',
   "@Controller('api/v1/admin/holidays')" in HC and "@Audit('HOLIDAY_SAVE', 'SITE')" in HC and "@Audit('HOLIDAY_DELETE', 'SITE')" in HC and HC.count("@Roles('SUPER')") == 2
   and "PolicyViolation('HOLIDAY_DATE'" in HS and "PolicyViolation('HOLIDAY_NAME'" in HS and 'partner_grade_rules WHERE rank > 1 AND min_month_earned IS NULL' in HS
   and 'HolidayController,' in AM and 'HolidayService,' in AM and '<HolidayPanel />' in SI and "useApi<HolidayList>('/admin/holidays')" in HP
   and all(f'"{a}"' in SP for a in ('GET /admin/holidays', 'PUT /admin/holidays', 'DELETE /admin/holidays/{day}'))
   and 'SELECT fn_business_day_after($1::timestamptz) AS at' in PS and 'businessDayAfter' not in PS, '')
CSS = rd('web/src/styles/app.css')
def admin_classes():
    used = set()
    for root, _, files in os.walk(os.path.join(K, 'web/src/app/admin')):
        for f in files:
            if f.endswith('.tsx'):
                for m in re.finditer(r'className="([^"{]*)"', open(os.path.join(root, f), encoding='utf-8').read()):
                    used.update(m.group(1).split())
    return used
U = admin_classes()
ok('① 운영 화면 CSS — 혼자 쓰인 btn · link 없음(btn-plain · linkbtn) · .plain · .block · .ghost.btn-sm 정의(check-guards ⑥ 관리자 0)',
   not ({'btn', 'link'} & U) and '.plain { list-style: none;' in CSS and '.block { display: block; }' in CSS and '.ghost.btn-sm { background: transparent; }' in CSS, str(sorted({'btn', 'link'} & U)))
PC = rd('deploy/aws/postcheck.sh')
ok('① postcheck — 돌고 있는 API 판(/health version) = 올린 판(VERSION) · 다르면 실패 · 모르면 확인',
   'hv=$(echo "$h" | sed -n' in PC and 'elif [ "$hv" = "$VER" ]; then ok "돌고 있는 API 판 = 올린 판 ($VER)"' in PC and 'bad "돌고 있는 API 판 $hv ≠ 올린 판 $VER"' in PC
   and 'warn "돌고 있는 API 판을 알 수 없음' in PC, '')
EN = rd('src/common/i18n/server-text.en.ts')
ok('① 영어 사전 — 공휴일 오류 3', all(f'"{k}"' in EN for k in ('날짜는 YYYY-MM-DD 로 넣으십시오.', '이름은 1 ~ 40자로 넣으십시오.', '그 날짜는 공휴일 목록에 없습니다.')), '')
docs = os.listdir(os.path.join(K, 'docs')) if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① docs/330 · 판 v10.206 이상', any(f.startswith('330_') for f in docs) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 206), rd('VERSION').strip())


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
HD1, HD2 = '2031-03-03', '2031-03-04'
PRIV = '9.9206'
if API and DB:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import consent_ok
    model = None; conv = None; usage_added = False
    try:
        # ② DB
        mig = psql("SELECT count(*) || '|' || max(name) FROM schema_migrations")
        hol = psql("SELECT count(*) FROM public_holidays WHERE day IN ('2026-12-25','2027-01-01','2027-02-07','2027-02-09','2027-05-13','2027-09-15','2027-10-11','2027-12-27')")
        ok('② 마이그레이션 221 · 끝 D183(v10.207 부터 222 · D184 — test_v1207) · 공휴일 처음 값(설날 · 대체공휴일 · 부처님오신날 · 추석 · 성탄절 대체 8곳 확인)',
           mig in ('221|D183_ai_week_holidays_kakao', '222|D184_plan_admin_price_lock', '223|D185_hlt_open_stock', '224|D186_mail_suppression', '225|D187_town_verify_guard', '226|D188_town_pick_ai', '227|D189_member_recommend', '228|D190_point_cashout', '229|D191_security_watch', '230|D192_partner_notice', '231|D193_seller_manage', '232|D194_partner_withdraw', '233|D195_staff_ip_verify', '234|D196_staff_sms', '235|D197_staff_ip_alert', '236|D198_ops_alert_pending_recent', '237|D199_mall_biz_report', '238|D200_ops_alert_slack', '239|D201_owner_todo_marks', '240|D202_ops_release_log', '241|D203_ops_server_daily_todo_weekly', '242|D204_ops_server_error_days', '243|D205_integration_progress', '244|D206_hlt_type_rates', '245|D207_terms_seller_privacy_drafts', '246|D208_hlt_rate_schedules', '247|D209_hlt_rate_notice', '248|D210_notice_grades', '249|D211_notice_manage', '250|D212_notice_reads_bulk', '251|D213_ops_board', '252|D214_setting_history', '253|D215_audit_search', '254|D216_notice_notified_purge') and hol == '8', f'{mig} · {hol}')
        bd = psql("SELECT to_char(fn_business_day_after('2027-02-05 10:00+09') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '|' || "
                  "to_char(fn_review_sla_due('2027-02-05 10:00+09', 24) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '|' || "
                  "to_char(fn_business_day_after('2026-11-06 10:00+09') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '|' || "
                  "to_char(fn_review_sla_due('2026-11-07 10:00+09', 24) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || '|' || "
                  "fn_is_business_day('2027-02-08')::text || fn_is_business_day('2027-02-10')::text")
        ok('② 영업일 — 설 연휴 앞 금요일 → 2/10 · 검수 마감 24시간도 2/10 · 금요일 → 월요일 · 토요일 접수 검수 → 화요일 0시(월요일 0시부터 24시간) · 2/8 쉼 · 2/10 영업',
           bd == '2027-02-10 10:00|2027-02-10 10:00|2026-11-09 10:00|2026-11-10 00:00|falsetrue', bd)
        blk = re.search(r'DO \$\$.*?END \$\$;', M, re.S)
        body0 = re.sub(r'\n\| 카카오 \|[^\n]*', '', P).replace("'", "''")
        kq = (f"BEGIN; INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('PRIVACY', '{PRIV}', '시험 처리방침 1206', '{body0}', true, 'infinity', 'LEGAL_REVIEW'); "
              f"{blk.group(0) if blk else ''} {blk.group(0) if blk else ''} "
              f"SELECT (length(body) - length(replace(body, '| 카카오 |', ''))) / length('| 카카오 |') || '|' || (position(E'{KP}\\n| Anthropic, PBC(미국) |' IN body) > 0)::text FROM terms WHERE code = 'PRIVACY' AND version = '{PRIV}'; ROLLBACK;")
        kr = psql(kq)
        ok('② 카카오 줄 넣기(D183 블록 · 거래 안) — 카카오 없는 초안에 Anthropic 줄 위로 한 줄 · 두 번 돌려도 한 줄 · 되돌림',
           kr.endswith('1|true') and psql(f"SELECT count(*) FROM terms WHERE code = 'PRIVACY' AND version = '{PRIV}'") == '0', kr[-60:])
        wk = psql("SELECT count(*) || '|' || max(day)::text || '|' || ((now() AT TIME ZONE 'Asia/Seoul')::date)::text FROM v_agent_week")
        n7, mx, td = (wk.split('|') + ['', '', ''])[:3]
        ok('② v_agent_week — 7줄 · 마지막 = 오늘(한국 날짜)', n7 == '7' and mx == td, wk)

        # ③ AI 첫 주 보고
        consent_ok.agree(SUPU, PW)
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')
        TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
        w0 = call('GET', '/admin/agent/week', None, TS)
        model = psql("SELECT model FROM agent_model_prices ORDER BY input_per_m LIMIT 1")
        psql(f"INSERT INTO agent_usage_daily(day, channel, model, requests, input_tokens, output_tokens, cache_read_tokens, cost_usd) "
             f"VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, 'SITE_CHAT', '{model}', 3, 0, 0, 0, 0.5) "
             f"ON CONFLICT (day, channel, model) DO UPDATE SET requests = agent_usage_daily.requests + 3, cost_usd = agent_usage_daily.cost_usd + 0.5")
        usage_added = True
        conv = psql("INSERT INTO agent_conversations(channel, guest_key) VALUES ('SITE_CHAT', 't1206') RETURNING id")
        psql(f"INSERT INTO agent_messages(conversation_id, role, body, handoff) VALUES ('{conv}', 'user', '시험 질문', NULL), ('{conv}', 'assistant', '시험 답', false), ('{conv}', 'assistant', '담당자에게', true)")
        w1 = call('GET', '/admin/agent/week', None, TS)
        t0, t1 = w0.get('total') or {}, w1.get('total') or {}
        import math
        exp_pct = math.floor(1000 * (t0.get('answers', 0) + 1) / (t0.get('answers', 0) + t0.get('handoffs', 0) + 2) + 0.5) / 10   # 서버 Math.round 와 같게
        jsn = lambda x: str(int(x)) if float(x).is_integer() else str(x)   # 자바스크립트 숫자 글(50 · 66.7)
        ok('③ AI 첫 주 보고 — 7줄 · 합 「7일」 · 사용량 3 · $0.5 · 상담 1 · 답 1 · 넘김 1 더해짐 · 답 % 다시 셈 · 쓴 것 있음',
           len(w1.get('days') or []) == 7 and t1.get('day') == '7일' and t1.get('requests') == t0.get('requests', 0) + 3
           and abs(t1.get('costUsd', 0) - t0.get('costUsd', 0) - 0.5) < 0.001 and t1.get('chats') == t0.get('chats', 0) + 1
           and t1.get('answers') == t0.get('answers', 0) + 1 and t1.get('handoffs') == t0.get('handoffs', 0) + 1 and t1.get('answeredPct') == exp_pct and w1.get('used') is True,
           f'{t0} → {t1}')
        dg = call('GET', '/admin/launch-watch/digest', None, TS); lines = [l for l in (dg.get('text') or '').splitlines() if l.startswith('AI 7일 — ')]
        wb = call('GET', '/admin/agent/week', None, TB)
        ok('③ 기준 미달(답 95% 아래) 목록 · 하루 요약 「AI 7일」 한 줄(답 % · 비용 · 기준 미달) · 회원 403',
           (exp_pct >= 95 or f'AI 상담 답 {jsn(exp_pct)}% — 기준 95%' in (w1.get('below') or [])) and len(lines) == 1 and f"답 {jsn(t1.get('answeredPct'))}%" in lines[0]
           and f"비용 ${jsn(t1.get('costUsd'))}" in lines[0] and ((exp_pct >= 95) or '기준 미달: ' in lines[0]) and wb.get('_err') == 403, f'{w1.get("below")} · {lines} · {wb.get("_err")}')

        # ③ 공휴일
        psql(f"DELETE FROM public_holidays WHERE day IN ('{HD1}', '{HD2}')")
        g0 = call('GET', '/admin/holidays', None, TS)
        s1 = call('PUT', '/admin/holidays', {'day': HD1, 'name': '시험 공휴일'}, TS)
        s2 = call('PUT', '/admin/holidays', {'day': HD1, 'name': '시험 공휴일 2'}, TS)
        s3 = call('PUT', '/admin/holidays', {'day': '2031-13-45', 'name': '틀린 날'}, TS)
        s4 = call('PUT', '/admin/holidays', {'day': HD2, 'name': '회원'}, TB)
        au = psql("SELECT count(*) FROM audit.audit_logs WHERE action = 'HOLIDAY_SAVE' AND occurred_at > now() - interval '10 minutes'")
        ok('③ 공휴일 넣기 · 같은 날은 이름만 고침 · 틀린 날짜 422 HOLIDAY_DATE · 회원 403 · 감사 HOLIDAY_SAVE · 목록 구조(올해 · 다음 해 · 다음 영업일 · 확인 줄)',
           s1.get('created') is True and s2.get('created') is False and s2.get('name') == '시험 공휴일 2' and s3.get('_err') == 422 and s3.get('code') == 'HOLIDAY_DATE'
           and s4.get('_err') == 403 and psql(f"SELECT name FROM public_holidays WHERE day = '{HD1}'") == '시험 공휴일 2' and au not in ('', '0')
           and isinstance(g0.get('items'), list) and isinstance(g0.get('checks'), list) and re.match(r'^20\d\d-\d\d-\d\d \d\d:\d\d$', g0.get('nextBusinessDay') or '')
           and (g0.get('nextYear', 0) > 0 or any('공휴일이 없습니다' in c for c in g0.get('checks') or [])), f'{s1} · {s2} · {s3} · {s4.get("_err")} · 감사 {au} · {g0.get("nextBusinessDay")} · {g0.get("checks")}')
        nb = (g0.get('nextBusinessDay') or '')[:10]
        keep_nb = psql(f"SELECT name FROM public_holidays WHERE day = '{nb}'") if nb else ''
        p1 = call('PUT', '/admin/holidays', {'day': nb, 'name': '시험 공휴일 1206'}, TS) if nb and not keep_nb else {}
        g1 = call('GET', '/admin/holidays', None, TS)
        d1 = call('DELETE', f'/admin/holidays/{nb}', None, TS) if p1.get('created') else {}
        d2 = call('DELETE', f'/admin/holidays/{HD1}', None, TS); d3 = call('DELETE', f'/admin/holidays/{HD1}', None, TS)
        ok('③ 다음 영업일을 공휴일로 넣으면 답변 예정이 그 뒤로 밀림 · 빼기 · 없는 날 빼기 404',
           (keep_nb or (p1.get('created') is True and (g1.get('nextBusinessDay') or '')[:10] > nb and d1.get('ok') is True)) and d2.get('ok') is True and d3.get('_err') == 404,
           f'{nb} → {g1.get("nextBusinessDay")} · {d1} · {d2} · {d3.get("_err")}')

        # ③ 위탁 목록 점검
        oc = call('GET', '/admin/terms/outsource-check', None, TS)
        sv = {s['name']: s for s in oc.get('services') or []}
        consistent = all((not s['used']) or all(d['state'] != 'NONE' or any(s['name'] in l for l in oc.get('lines') or []) for d in s['docs']) for s in sv.values())
        kakao = sv.get('카카오') or {}
        ok('③ 위탁 목록 점검 — AWS · Anthropic · 카카오 · AWS 늘 씀 · 쓰는 서비스가 목록에 없으면 lines · 카카오는 처리방침 · 위탁 안내(시행 중 또는 초안)에 있음(D183)',
           set(sv) == {'Amazon Web Services', 'Anthropic', '카카오'} and sv['Amazon Web Services']['used'] is True and consistent
           and all(d['state'] in ('CURRENT', 'DRAFT') for d in kakao.get('docs') or [{}]) and len(kakao.get('docs') or []) == 2,
           f"{[(n, s['used'], [d['state'] for d in s['docs']]) for n, s in sv.items()]} · {oc.get('lines')} · {oc.get('pending')}")
        psql(f"DELETE FROM terms WHERE code = 'PRIVACY' AND version = '{PRIV}'")
        r1 = psql(f"INSERT INTO terms(code, version, title, body, is_required, effective_from, status) VALUES ('PRIVACY', '{PRIV}', '시험 처리방침 1206', E'## 제5조 (처리를 맡기는 곳)\\n\\n| 맡는 곳 | 무엇을 |\\n|---|---|\\n| 본인인증 기관 | 본인 확인 |', true, 'infinity', 'LEGAL_REVIEW')")
        pv = call('GET', f'/admin/terms/PRIVACY/publish-preview?version={PRIV}', None, TS)
        pvo = call('GET', f'/admin/terms/SERVICE/publish-preview?version={PRIV}', None, TS)
        ok('③ 게시 미리보기 outsourceGaps — 위탁 표에 AWS 없는 처리방침 초안 → 「Amazon Web Services(…)」 · 처리방침 · 위탁 안내가 아니면 칸 없음(404 라도)',
           not r1.startswith('!') and any(x.startswith('Amazon Web Services(') for x in pv.get('outsourceGaps') or []) and (pvo.get('_err') == 404 or pvo.get('outsourceGaps') == []),
           f"{r1[:40]} · {pv.get('outsourceGaps')} · {pvo.get('_err')}")

        # ④ 화면
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            seen = {}; errs = []
            with sync_playwright() as p:
                b = p.chromium.launch()
                pg = b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)[:100]))
                pg.on('dialog', lambda d: d.dismiss())
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                pg.goto(ADMIN_WEB + '/#/ai-ops/agent', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['week'] = pg.evaluate("() => [document.querySelectorAll('[data-agent-week] [data-week-day]').length, document.querySelector('[data-week-day=\"7일\"]')?.textContent ?? '']")
                pg.goto(ADMIN_WEB + '/#/siteinfo', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                seen['hol'] = pg.evaluate("() => [!!document.querySelector('[data-holidays]'), document.querySelector('[data-holiday-next]')?.textContent ?? '']")
                pg.fill('[data-holiday-day]', HD2); pg.fill('[data-holiday-name]', '화면 시험 공휴일'); pg.click('[data-holiday-save]'); pg.wait_for_timeout(2000)
                seen['res'] = pg.evaluate("() => document.querySelector('[data-holiday-res]')?.textContent ?? ''")
                seen['row'] = pg.evaluate(f"() => !!document.querySelector('[data-holiday=\"{HD2}\"]')")
                pg.goto(ADMIN_WEB + '/#/terms', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                seen['terms'] = pg.evaluate("() => !!document.querySelector('[data-terms-panel]')")
                b.close()
            ok('④ 화면 — AI 첫 주 보고 8줄(7일 + 합) · 공휴일 칸 · 답변 예정 · 넣기 → 결과 글 · 목록에 보임 · DB · 약관 화면 · 오류 없음',
               seen['week'][0] == 8 and '7일' in seen['week'][1] and seen['hol'][0] and re.match(r'^20\d\d-', seen['hol'][1] or '')
               and '넣었습니다' in seen['res'] and seen['row'] and psql(f"SELECT name FROM public_holidays WHERE day = '{HD2}'") == '화면 시험 공휴일'
               and seen['terms'] and not errs, f'{seen} · {errs[:2]}')
    finally:
        psql(f"DELETE FROM public_holidays WHERE day IN ('{HD1}', '{HD2}') OR name = '시험 공휴일 1206'")
        psql(f"DELETE FROM terms WHERE code = 'PRIVACY' AND version = '{PRIV}' AND status <> 'PUBLISHED'")
        if conv and not conv.startswith('!'):
            psql(f"DELETE FROM agent_conversations WHERE id = '{conv}'")
        if usage_added and model:
            psql(f"UPDATE agent_usage_daily SET requests = requests - 3, cost_usd = cost_usd - 0.5 WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND channel = 'SITE_CHAT' AND model = '{model}'; "
                 f"DELETE FROM agent_usage_daily WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND channel = 'SITE_CHAT' AND model = '{model}' AND requests = 0 AND cost_usd = 0")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
