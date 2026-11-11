"""v10.200 시험 — 급한 알림 텔레그램(코드 · DB · 준비 안 됨) · 오픈 차단 「누가」 · 메인 투표 빈 자리(D178 · docs/316)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e ADMIN_WEB=http://localhost:15173 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1200.py

  ① 코드 — D178(연동 키 TELEGRAM_BOT_TOKEN · 형식 · 메일 「키 등록」 그대로 · ops.telegram_chat · pushed_at · 고르는 함수 2 · 지우는 문장 없음 · 216) ·
     텔레그램 서비스(토큰을 로그 · 오류에 안 남김 · 제목만) · 정기 작업(메일 다음 · 따로) · API 2 · 화면 · 오픈 차단 누가 · 메인 투표 칸 · 하루 요약 · 문서 · 판
  ② (DB) 텔레그램 고르는 함수 — 메일과 같은 기준(풀림 · 확인 · 24시간 · 종류마다 1시간) · 다시 보내기 12시간(한 묶음 안에서 · 되돌림)
  ③ (API · 화면) 봇 토큰 형식(422) · 넣고 지워도 메일 「키 등록」 그대로 · 토큰 없으면 NO_TOKEN · 대화방 없으면 NO_CHAT · 시험 1분 한 번(409) · ADMIN 403 ·
     오픈 차단 줄마다 owner · how · 메인 빈 자리 → 확정 질문으로 채움(비어 있는 종류만 · 바로 엶) · 다 차 있으면 만들지 않음 · 같은 질문 있으면 skipped ·
     대시보드 「메인 투표」 칸 · 투표 관리 단추 · 운영 알림 텔레그램 줄 · 오픈 체크리스트 「누가」 요약
  실제 텔레그램 보내기 · 대화방 찾기는 test_v1200_push(서버에서 · 가짜 텔레그램 서버)
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
HERE = os.path.dirname(os.path.abspath(__file__))
API = os.environ.get('API'); DB = os.environ.get('DB'); ADMIN_WEB = os.environ.get('ADMIN_WEB')
RES = []
PW = 'sgb-dev-1234'


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


# ── ① 코드 ────────────────────────────────────────────────────────────
MD = os.path.join(K, 'prisma/migrations')
mig = sorted(d for d in os.listdir(MD) if os.path.isdir(os.path.join(MD, d)))
M = rd('prisma/migrations/D178_ops_alert_telegram/migration.sql')
ok('① D178 — 연동 키 TELEGRAM_BOT_TOKEN(메일 칸) · 형식 · 메일 「키 등록」 그대로 · ops.telegram_chat(ADMIN · 빈 값) · pushed_at · repushed_at · 고르는 함수 2 · 지우는 문장 없음 · 216',
   "('MAIL','TELEGRAM_BOT_TOKEN')));" in M and "'^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$'" in M
   and "IF p_name NOT IN ('KAKAO_JS_KEY', 'TOSS_CLIENT_KEY', 'TELEGRAM_BOT_TOKEN') THEN" in M
   and "('ops.telegram_chat', NULL, 'ADMIN'" in M and "'^-?[0-9]{5,20}$'" in M
   and 'ADD COLUMN IF NOT EXISTS pushed_at timestamptz' in M and 'ADD COLUMN IF NOT EXISTS repushed_at timestamptz' in M
   and 'FUNCTION public.fn_ops_alert_push_pending()' in M and 'FUNCTION public.fn_ops_alert_repush_pending()' in M
   and 'm.pushed_at > now() - interval \'1 hour\'' in M and M.count('o.acknowledged_at IS NULL AND o.resolved_at IS NULL') == 2
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 216 and 'D178_ops_alert_telegram' in mig,
   f'{len(mig)} · {mig[-1]}')
TG = rd('src/common/telegram/telegram.service.ts'); SS = rd('src/common/integration/secret.service.ts'); AM = rd('src/app.module.ts')
ok('① 텔레그램 서비스 — 토큰은 연동 키(process.env) · 대화방 설정 · 주소 TELEGRAM_API_BASE · 오류에 주소(토큰) 안 남김 · 4,000자 · 대화방 찾기 · 등록 · 지워도 메일 「키 등록」 그대로',
   "process.env.TELEGRAM_BOT_TOKEN?.trim()" in TG and "key = 'ops.telegram_chat'" in TG and "process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org'" in TG
   and "String((e as Error)?.name ?? 'error')" in TG and ('text.slice(0, 4000)' in TG or 'text.slice(0, TG_MAX)' in TG) and "this.call('getUpdates'" in TG
   and "name: 'TELEGRAM_BOT_TOKEN', label: '텔레그램 봇 토큰(급한 운영 알림)', env: 'TELEGRAM_BOT_TOKEN'" in SS
   and "k.name !== 'TELEGRAM_BOT_TOKEN'" in SS and '    TelegramService,\n' in AM, '')
SC = rd('src/worker/scheduler.service.ts'); LW = rd('src/modules/admin/launch-watch.service.ts')
ok('① 정기 작업 — 메일 다음에 텔레그램(따로 · 준비 안 되면 까닭만 · 보낸 것만 적음) · 제목 · 등급 · 시각만(내용 없음) · 「[다시]」 · 작업 기록 alertPush',
   'const ap = await this.alertPush();' in SC and SC.index('const am = await this.alertMail()') < SC.index('const ap = await this.alertPush()')
   and 'detail = { alertMail: am, alertPush: ap, ' in SC and "if (!st.ready) return { pending: items.length, pushed: 0, reason: st.reason };" in SC
   and "`- ${x.again ? '[다시] ' : ''}[${x.severity}] ${x.raisedAt} ${x.title}`" in SC and 'this.launchWatch.markPushed(' in SC
   and 'FROM fn_ops_alert_push_pending()' in LW and 'FROM fn_ops_alert_repush_pending()' in LW and 'SET pushed_at = now()' in LW and 'SET repushed_at = now()' in LW, '')
OC = rd('src/modules/admin/ops-review.controller.ts'); OS_ = rd('src/modules/admin/ops-alerts.service.ts'); SJ = rd('spec/screens.json')
ok('① API — push-test(SUPER · 감사 OPS_PUSH_TEST · 1분 한 번 409 PUSH_TEST_WAIT) · push-find-chat(SUPER) · 준비 상태는 mail-status 의 push · 화면 목록',
   "@Post('ops-alerts/push-test')" in OC and "@Audit('OPS_PUSH_TEST', 'OPS_ALERT')" in OC and "@Post('ops-alerts/push-find-chat')" in OC
   and OC.count("@Roles('SUPER')") >= 4 and "new StateConflict('PUSH_TEST_WAIT'" in OS_ and 'push: { ready: ps.ready' in OS_
   and '"POST /admin/ops-alerts/push-test"' in SJ and '"POST /admin/ops-alerts/push-find-chat"' in SJ and '"POST /admin/community/polls/fill-home"' in SJ, '')
OB = rd('src/modules/catalog/open-blocker-owner.ts'); TS_ = rd('src/modules/catalog/terms.service.ts'); TD = rd('src/modules/catalog/terms.dto.ts')
ok('① 오픈 차단 — 줄마다 owner(CEO · VENDOR · SCREEN · DATE) · how · 판단 기준(v_open_blockers) 그대로 · DTO',
   "export type BlockerOwner = 'CEO' | 'VENDOR' | 'SCREEN' | 'DATE';" in OB and "case 'TERM':" in OB and "case 'INTEGRATION':" in OB
   and 'rows.map((r) => ({ ...r, ...blockerOwner(r.kind, r.item) }))' in TS_ and 'FROM v_open_blockers' in TS_ and 'owner!: string;' in TD and 'how!: string;' in TD, '')
PS = rd('src/modules/community/poll.service.ts'); PCN = rd('src/modules/community/poll.controller.ts')
ok('① 메인 투표 — 빈 자리만 확정 질문(seed-polls.sql 과 같은 글)으로 만들고 엶 · 같은 질문 있으면 skipped · SUPER · 감사 POLL_FILL_HOME · 지켜보기 칸 · 하루 요약 줄',
   all(t in PS and t in rd('scripts/seed-polls.sql') for t in ('로봇청소기를 산다면, 어느 쪽을 고르시겠어요?', '소개받아 살 때 가장 먼저 보는 것은?', '공기청정기를 써 보신 분들의 의견을 들려주세요!', '/home/d/vs-a.png', '사후관리(A/S)'))
   and "WHERE NOT EXISTS (SELECT 1 FROM v_poll_home h WHERE h.kind = k.kind)" in PS and "UPDATE polls SET state = 'OPEN' WHERE id = $1" in PS
   and "@Post('admin/community/polls/fill-home')" in PCN and "@Audit('POLL_FILL_HOME', 'POLL')" in PCN
   and '(SELECT count(DISTINCT kind)::int FROM v_poll_home) AS "homePolls"' in LW and LW.count('AS "homePolls"') == 2 and '메인 투표 ${c.homePolls} / 3' in LW, '')
OX = rd('web/src/app/admin/OpsAlerts.tsx'); LX = rd('web/src/app/admin/LaunchWatch.tsx'); PX = rd('web/src/app/admin/Polls.tsx'); CX = rd('web/src/app/admin/OpenChecklist.tsx')
ok('① 화면 — 운영 알림 텔레그램 줄(대화방 찾기 · 고르면 설정 · 시험) · 지켜보기 「메인 투표」 칸 → 투표 관리 · 빈 자리 채우기 단추(SUPER) · 오픈 차단 누가별 · 문서 · 판',
   'data-push-status=' in OX and 'data-push-find=""' in OX and 'data-push-test=""' in OX and "key: 'ops.telegram_chat', value: c.id" in OX
   and "['메인 투표(3자리 중)', d.homePolls ?? 3, (d.homePolls ?? 3) < 3, 'polls']" in LX and "polls: '투표 관리'" in LX
   and 'data-home-fill-btn=""' in PX and "tokenRoles().includes('SUPER')" in PX and 'data-blocker-owners=""' in CX and 'data-blocker-how=""' in CX
   and any(f.startswith('316_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 200), rd('VERSION').strip())


# ── ② · ③ DB · API ────────────────────────────────────────────────────
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


ADMU, SUPU = 't1200adm@x.com', 'admin@x.com'
FAKE_TOKEN = '123456789:AAT1200testtokenabcdefghijklmnopqrstu'
if API and DB:
    # ── ② 고르는 함수 — 메일과 같은 기준 ──────────────────────────────
    g = psql("BEGIN; UPDATE ops_alerts SET pushed_at = coalesce(pushed_at, now() - interval '2 hours'), repushed_at = coalesce(repushed_at, now() - interval '1 hour'); "
             "INSERT INTO ops_alerts (alert_code, severity, title, detail, raised_at, pushed_at) VALUES "
             "('TEST_V1200_A', 'CRITICAL', '시험 다시', '{\"test\":\"v1200\"}', now() - interval '14 hours', now() - interval '13 hours'), "
             "('TEST_V1200_B', 'CRITICAL', '시험 새', '{\"test\":\"v1200\"}', now() - interval '2 minutes', NULL), "
             "('TEST_V1200_C', 'CRITICAL', '시험 풀림', '{\"test\":\"v1200\"}', now() - interval '3 minutes', NULL), "
             "('TEST_V1200_D', 'INFO', '시험 안내', '{\"test\":\"v1200\"}', now() - interval '4 minutes', NULL), "
             "('TEST_V1200_E', 'CRITICAL', '시험 오래됨', '{\"test\":\"v1200\"}', now() - interval '30 hours', NULL), "
             "('TEST_V1200_F', 'CRITICAL', '시험 묶임1', '{\"test\":\"v1200\"}', now() - interval '6 minutes', now() - interval '10 minutes'), "
             "('TEST_V1200_F', 'CRITICAL', '시험 묶임2', '{\"test\":\"v1200\"}', now() - interval '5 minutes', NULL); "
             "UPDATE ops_alerts SET resolved_at = now(), resolve_note = '시험' WHERE detail->>'test' = 'v1200' AND title = '시험 풀림'; "
             "SELECT 'P:' || coalesce(string_agg(title, '|' ORDER BY title), '') FROM fn_ops_alert_push_pending() WHERE alert_code LIKE 'TEST_V1200_%'; "
             "SELECT 'R:' || coalesce(string_agg(title, '|' ORDER BY title), '') FROM fn_ops_alert_repush_pending() WHERE alert_code LIKE 'TEST_V1200_%'; ROLLBACK;")
    ok('② 고르는 함수 — 새 긴급만(풀림 · 안내 · 24시간 넘음 · 같은 종류 1시간 안 보냄은 빠짐) · 다시 보내기는 보낸 지 12시간 넘은 긴급 · 메일 칸과 따로',
       'P:시험 새' in g.splitlines() and 'R:시험 다시' in g.splitlines(), g.replace('\n', ' ')[:160])

    # ── ③ API · 화면 ──────────────────────────────────────────────────
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    pw = psql("SELECT password_hash FROM accounts WHERE email = 'buyer@x.com'")
    psql(f"INSERT INTO accounts(email, name, password_hash, identity_verified_at) VALUES ('{ADMU}', '시험운영1200', '{pw}', now()) ON CONFLICT DO NOTHING")
    aid = psql(f"SELECT id FROM accounts WHERE email = '{ADMU}'")
    chat0 = psql("SELECT CASE WHEN value IS NULL THEN 'NULL' ELSE quote_literal(value) END FROM site_settings WHERE key = 'ops.telegram_chat'")
    reg0 = psql("SELECT secret_registered FROM integrations WHERE code = 'MAIL'")
    tok0 = psql("SELECT count(*) FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")
    vs0 = psql("SELECT coalesce(string_agg(id::text || '=' || state || '=' || quote_literal(title), '|' ORDER BY id), '') FROM polls WHERE kind = 'VS' AND state = 'OPEN'")
    t0 = psql('SELECT now()')
    made_id = ''
    try:
        psql(f"BEGIN; SELECT set_config('app.role_reason', '시험 T1200', true); INSERT INTO account_roles(account_id, role) VALUES ('{aid}', 'ADMIN') ON CONFLICT DO NOTHING; COMMIT;")
        for e in (ADMU, SUPU): consent_ok.agree(e, PW)
        TA = call('POST', '/auth/login', {'email': ADMU, 'password': PW}).get('accessToken')
        TS = call('POST', '/auth/login', {'email': SUPU, 'password': PW}).get('accessToken')

        # 봇 토큰 — 형식 · 메일 「키 등록」 그대로 · 지우기
        if tok0 == '0':
            b1 = call('PUT', '/admin/integration-keys/MAIL/TELEGRAM_BOT_TOKEN', {'value': 'not-a-telegram-token-1200'}, TS)
            b2 = call('PUT', '/admin/integration-keys/MAIL/TELEGRAM_BOT_TOKEN', {'value': FAKE_TOKEN}, TS)
            row = next((x for x in (b2 if isinstance(b2, list) else []) if x.get('name') == 'TELEGRAM_BOT_TOKEN'), {})
            reg1 = psql("SELECT secret_registered FROM integrations WHERE code = 'MAIL'")
            b3 = call('DELETE', '/admin/integration-keys/MAIL/TELEGRAM_BOT_TOKEN', None, TS)
            reg2 = psql("SELECT secret_registered FROM integrations WHERE code = 'MAIL'")
            ok('③ 봇 토큰 — 형식 아니면 422 INTEG_SECRET_FORMAT · 넣으면 메일 칸 · 끝 4자리 · 운영 화면 · 넣고 지워도 메일 「키 등록」 그대로',
               b1.get('code') == 'INTEG_SECRET_FORMAT' and row.get('code') == 'MAIL' and row.get('source') == 'ADMIN' and row.get('masked', '').endswith(FAKE_TOKEN[-4:])
               and 'value' not in row and reg1 == reg0 and reg2 == reg0 and isinstance(b3, list),
               f'{b1.get("code")} · {row.get("source")} {row.get("masked")} · {reg0} {reg1} {reg2}')
        else:
            ok('③ 봇 토큰 — 이미 넣은 값이 있어 넣기 · 지우기는 건너뜀', True, 'skip')

        # 준비 안 됨 — 토큰 없음(점검판 .env 에 없음) · 대화방 없음 · 시험 1분 한 번 · 권한
        psql("UPDATE site_settings SET value = NULL WHERE key = 'ops.telegram_chat'")
        st0 = (call('GET', '/admin/ops-alerts/mail-status', None, TS) or {}).get('push') or {}
        # 바로 앞 시험(test_v1200_push)이 1분 안에 시험 메시지를 보냈으면 그 1분이 지나기를 기다림
        ago = psql("SELECT coalesce(extract(epoch FROM now() - max(occurred_at))::int, 999) FROM audit.audit_logs WHERE action = 'OPS_PUSH_TEST'")
        if ago.isdigit() and int(ago) < 62: time.sleep(62 - int(ago))
        r1 = call('POST', '/admin/ops-alerts/push-test', None, TS)
        r2 = call('POST', '/admin/ops-alerts/push-test', None, TS)
        f1 = call('POST', '/admin/ops-alerts/push-find-chat', None, TS)
        r3 = call('POST', '/admin/ops-alerts/push-test', None, TA)
        f2 = call('POST', '/admin/ops-alerts/push-find-chat', None, TA)
        au = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'OPS_PUSH_TEST' AND occurred_at >= '{t0}'")
        ok('③ 준비 안 됨 — 토큰 없으면 NO_TOKEN(줄 · 시험 · 대화방 찾기 모두 200 + 까닭) · 1분 안 두 번째는 409 PUSH_TEST_WAIT · ADMIN 은 403 · 감사 OPS_PUSH_TEST',
           st0.get('ready') is False and st0.get('reason') == 'NO_TOKEN' and r1.get('ok') is False and r1.get('reason') == 'NO_TOKEN' and r2.get('code') == 'PUSH_TEST_WAIT'
           and f1.get('ok') is False and f1.get('reason') == 'NO_TOKEN' and r3.get('_err') == 403 and f2.get('_err') == 403 and au == '1',
           f'{st0} · {r1.get("reason")} · {r2.get("code")} · {f1.get("reason")} · {r3.get("_err")} {f2.get("_err")} · {au}')
        s1 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_chat', 'value': '-100abc'}, TS)
        s2 = call('PATCH', '/admin/site-settings', {'key': 'ops.telegram_chat', 'value': '-1001234500200'}, TS)
        st1 = (call('GET', '/admin/ops-alerts/mail-status', None, TS) or {}).get('push') or {}
        ok('③ 대화방 설정 — 숫자 아니면 거절 · 넣으면 줄에 가운데 가린 번호(토큰은 여전히 없음 → NO_TOKEN)',
           bool(s1.get('_err')) and not s2.get('_err') and st1.get('chat') == '-100…0200' and st1.get('reason') == 'NO_TOKEN', f'{s1.get("_err")} · {s2.get("_err")} · {st1}')

        # 오픈 차단 — 줄마다 누가 · 방법
        bl = call('GET', '/admin/open-blockers', None, TS)
        bl = bl if isinstance(bl, list) else []
        own = {b.get('kind'): b.get('owner') for b in bl}
        ok('③ 오픈 차단 — 줄마다 owner(CEO · VENDOR · SCREEN · DATE) · how · 약관 = 대표 · 외부 연동 · 간주 = 업체 · 줄 수는 v_open_blockers 와 같음',
           len(bl) > 0 and len(bl) == int(psql('SELECT count(*) FROM v_open_blockers') or -1) and all(b.get('owner') in ('CEO', 'VENDOR', 'SCREEN', 'DATE') for b in bl)
           and all(b.get('how') for b in bl) and own.get('TERM', 'CEO') == 'CEO' and own.get('INTEGRATION', 'VENDOR') == 'VENDOR' and own.get('ASSUME', 'VENDOR') == 'VENDOR',
           f'{len(bl)} · {own}')

        # 메인 투표 — 다 차 있으면 만들지 않음 → 비교해요 자리를 비움(제목에 표시 · 마감) → 채움 → 같은 질문이 있으면 skipped
        hp0 = call('GET', '/admin/launch-watch', None, TS).get('homePolls')
        k0 = call('POST', '/admin/community/polls/fill-home', None, TS)
        ka = call('POST', '/admin/community/polls/fill-home', None, TA)
        for row in [x for x in vs0.split('|') if x]:
            pid = row.split('=', 1)[0]
            psql(f"UPDATE polls SET title = title || ' [T1200]', state = 'CLOSED' WHERE id = '{pid}'")
        hp1 = call('GET', '/admin/launch-watch', None, TS).get('homePolls')
        if ADMIN_WEB:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1400, 'height': 1000}); errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
                pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
                pg.fill('input[name=email]', SUPU); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
                tile = pg.evaluate("() => { const e = document.querySelector('[data-launch-watch] a.ad-tile[data-go=\"polls\"]'); return e ? e.className + '|' + e.textContent : '' }")
                pg.click('[data-launch-watch] a.ad-tile[data-go="polls"]'); pg.wait_for_timeout(2500)
                h1 = pg.evaluate("() => location.hash + '|' + !!document.querySelector('[data-home-fill-btn]')")
                pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
                h2 = pg.evaluate("() => (document.querySelector('[data-push-status]')?.getAttribute('data-push-status') ?? '') + '|' + !!document.querySelector('[data-push-find]') + '|' + (document.querySelector('[data-push-status]')?.textContent ?? '')")
                pg.goto(ADMIN_WEB + '/#/checklist', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(3000)
                h3 = pg.evaluate("() => document.querySelectorAll('[data-blocker-owners] [data-owner]').length + '|' + document.querySelectorAll('[data-blocker-how]').length + '|' + (document.querySelector('[data-blocker-view]')?.getAttribute('data-blocker-view') ?? '')")
                b.close()
            ok('③ 화면 — 지켜보기 「메인 투표」 칸(빈 자리면 노란 칸) → 투표 관리 · 빈 자리 채우기 단추 · 운영 알림 텔레그램 줄(준비 안 됨 · 대화방 찾기) · 오픈 체크리스트 누가별 요약 · 방법 · 오류 없음',
               ' warn' in tile and '메인 투표' in tile and h1 == '#/polls|true' and h2.startswith('not-ready|true|') and '봇 토큰 없음' in h2
               and int(h3.split('|')[0]) >= 1 and int(h3.split('|')[1]) >= 1 and h3.endswith('|owner') and not errs, f'{tile[:60]} · {h1} · {h2[:80]} · {h3} · {errs[:2]}')
        k1 = call('POST', '/admin/community/polls/fill-home', None, TS)
        made_id = psql("SELECT coalesce((SELECT id::text FROM polls WHERE kind = 'VS' AND title = '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?' AND state = 'OPEN' ORDER BY created_at DESC LIMIT 1), '')")
        hv = psql("SELECT title || ':' || (SELECT count(*) FROM poll_options o WHERE o.poll_id = h.id) FROM v_poll_home h WHERE kind = 'VS'")
        hp2 = call('GET', '/admin/launch-watch', None, TS).get('homePolls')
        k2 = call('POST', '/admin/community/polls/fill-home', None, TS)
        if made_id: psql(f"UPDATE polls SET state = 'CLOSED' WHERE id = '{made_id}'")
        k3 = call('POST', '/admin/community/polls/fill-home', None, TS)
        au2 = psql(f"SELECT count(*) FROM audit.audit_logs WHERE action = 'POLL_FILL_HOME' AND occurred_at >= '{t0}'")
        ok('③ 메인 투표 — 다 차 있으면 만들지 않음 · ADMIN 403 · 비교해요 자리가 비면 지켜보기 2 / 3 → 확정 질문으로 만들고 엶(보기 2) · 3 / 3 · 다시 누르면 만들지 않음 · 같은 질문이 마감으로 남아 있으면 skipped · 감사 기록',
           hp0 == 3 and k0.get('made') == [] and k0.get('ok') is True and ka.get('_err') == 403 and hp1 == 2
           and k1.get('made') == ['VS'] and made_id and hv == '로봇청소기를 산다면, 어느 쪽을 고르시겠어요?:2' and hp2 == 3 and k2.get('made') == []
           and k3.get('ok') is False and (k3.get('skipped') or [{}])[0].get('kind') == 'VS' and 'CLOSED' in (k3.get('skipped') or [{}])[0].get('why', '') and au2 == '4',
           f'{hp0} {k0.get("made")} {ka.get("_err")} · {hp1} · {k1.get("note")} · {hv} · {hp2} · {k2.get("made")} · {k3.get("skipped")} · {au2}')
    finally:
        if made_id: psql(f"DELETE FROM polls WHERE id = '{made_id}'")
        for row in [x for x in vs0.split('|') if x]:
            pid, st, title = row.split('=', 2)
            psql(f"UPDATE polls SET title = {title}, state = '{st}' WHERE id = '{pid}'")
        psql(f"UPDATE site_settings SET value = {chat0 or 'NULL'} WHERE key = 'ops.telegram_chat'")
        if tok0 == '0': psql("DELETE FROM integration_secrets WHERE integration_code = 'MAIL' AND name = 'TELEGRAM_BOT_TOKEN'")
        psql(f"UPDATE integrations SET secret_registered = {reg0 or 'false'} WHERE code = 'MAIL'")

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
