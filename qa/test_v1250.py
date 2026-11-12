"""v10.250 ~ v10.252 (D204 · docs/387) — 서버 오류 30일 기록 · 적용 전 점검 요약 · 운영 알림 주간 정리

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1250.py

  ① (코드) D204 ops_server_error_days(날짜 · 방법 · 주소 · 종류 · 응답 번호 · 30일) · 아직 안 넣은 몫(pending · 되돌림) · launch_watch 가 더함 ·
     7일 표 · 하루 요약 줄 · precheck 요약(읽기만) · alerts-week · 주간 알림에 7일 알림 · 화면 3곳 · 명세 · 문서 387 · 판 v10.252 이상
  ② (API · DB) 서버 오류 — 일부러 낸 500 두 번 → launch_watch 뒤 DB 오늘 줄 +2(가린 설명 · 요청 번호 · 검색어 없음) · server-errors week · 하루 요약 줄
  ③ (API) 적용 전 점검 요약 — 점검판엔 결과 파일 없음(null) · alerts-week 숫자가 DB 와 맞음 · ADMIN 봄 · 회원 403
  ④ (API) 주간 알림 — 지난 7일 경고 이상 수(warn7)가 alerts-week 와 맞음 · 알림 제목에 「지난 7일 경고 이상 알림 n건」
  ⑤ (화면) 운영 알림 「지난 7일」 표 · 서버 오류 「최근 7일」 · 지금 판 카드 precheck 줄(없음)
  두 번 돌아도 통과 — 시작 전후 차이만 봄. precheck 결과 파일이 있을 때는 test_v1250_files(서버에서 직접).
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API') or 'http://localhost:13000/api/v1'
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:15432/sgb'
ADMIN_WEB = os.environ.get('ADMIN_WEB')
HERE = os.path.dirname(os.path.abspath(__file__))
RES = []
PW = 'sgb-dev-1234'          # admin@x.com(SUPER)
RPW = 'sgb-test-1234'        # ops@t.local(ADMIN)


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8-sig').read() if os.path.exists(p) else ''


VER = rd('VERSION').strip()
# ── ① 코드 ──────────────────────────────────────────────────────────────
MIG = rd('prisma/migrations/D204_ops_server_error_days/migration.sql')
SE, LW, SC, RL, CT = (rd('src/common/server-error-count.ts'), rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts'),
                      rd('src/modules/admin/release-log.service.ts'), rd('src/modules/admin/launch-watch.controller.ts'))
OA, SV, ST = rd('web/src/app/admin/OpsAlerts.tsx'), rd('web/src/app/admin/ServerErrors.tsx'), rd('web/src/app/admin/StateCheck.tsx')
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
apis = {a for s in SJ.get('screens', []) for a in s.get('apis', [])}
ok('① D204 — ops_server_error_days(날짜 · 방법 · 주소 · 종류 · 응답 번호 기본 키 · 500 ~ 599 · 설명 200자) · 지우는 문장 없음',
   'CREATE TABLE IF NOT EXISTS public.ops_server_error_days' in MIG and 'PRIMARY KEY (day, method, path, code, status)' in MIG
   and 'status BETWEEN 500 AND 599' in MIG and 'DROP TABLE' not in MIG and 'DELETE FROM' not in MIG, '')
ok('① 아직 안 넣은 몫 — 오류마다 pending(날짜(한국) 키 · 500개까지) · 가져가기 · 되돌리기 · launch_watch 가 더하고 30일 지난 줄 지움',
   'export function takeServerErrorPending' in SE and 'export function restoreServerErrorPending' in SE and 'PENDING_MAX = 500' in SE and 'addPending({ day: kstDay(now)' in SE
   and 'async flushServerErrors()' in LW and 'restoreServerErrorPending(list)' in LW and 'DELETE FROM ops_server_error_days WHERE day <= ' in LW
   and 'this.launchWatch.flushServerErrors()' in SC, '')
ok('① 7일 표 · 하루 요약 「어제 서버 오류」 · alerts-week API · 명세',
   'async serverErrorWeek()' in LW and 'const week = await this.serverErrorWeek()' in LW and 'await this.serverErrorDigestLine().catch(' in LW
   and "@Get('alerts-week')" in CT and 'async alertsWeek()' in LW and 'GET /admin/launch-watch/alerts-week' in apis, '')
ok('① 적용 전 점검 요약 — 가장 최근 precheck_YYYYMMDD_HHMMSS.txt · 통과 · 실패 · 확인 · 마이그레이션 · 되돌린 상태 · 오픈 차단 · 약관 · 링크 안 따라감 · 읽기만',
   'export function readPrecheck' in RL and 'precheck: readPrecheck()' in RL and '적용 전 점검 — 통과' in RL and '마이그레이션 — 적용됨' in RL
   and '확인  되돌린 상태' in RL and '오픈 차단' in RL and 'lstatSync(p)' in RL and 'writeFileSync' not in RL, '')
ok('① 주간 알림 — 지난 7일 운영 알림을 같은 한 통에 · 할 일이 끝났어도 경고 이상이 있었으면 보냄',
   'const aw = await this.launchWatch.alertsWeek();' in SC and 'if (!left.length && !aw.warnTotal) return' in SC and 'alertsWeekText(aw)' in SC
   and 'export function alertsWeekText' in LW, '')
ok('① 화면 — 운영 알림 「지난 7일」 · 서버 오류 「최근 7일」 · 지금 판 precheck 줄',
   'function AlertsWeek()' in OA and '<AlertsWeek />' in OA and 'data-alerts-week=' in OA and 'data-server-errors-week=' in SV
   and 'data-release-precheck=' in ST, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('387_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 387 · 판 v10.252 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 252), f'{DOC} · {VER}')


def call(m_, p, b=None, t=None):
    hd = {'content-type': 'application/json'}
    if t: hd['Authorization'] = 'Bearer ' + t
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else (b'{}' if m_ in ('POST', 'PATCH', 'PUT') else None), headers=hd, method=m_)
    try:
        raw = urllib.request.urlopen(r, timeout=300).read()
        return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b'{}')
        except Exception:
            body = {}
        return {'_err': e.code, 'code': body.get('code')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    t0 = psql("SELECT now()")
    SQL_N = ("SELECT coalesce(sum(n), 0) FROM ops_server_error_days WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date "
             "AND method = 'GET' AND path = '/api/v1/community/polls' AND status = 500")

    # ── ② 서버 오류 30일 ──
    call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)          # 앞서 쌓인 몫을 먼저 넣어 둠
    n0 = int(psql(SQL_N) or 0)
    e0 = psql('ALTER VIEW public.v_poll_home RENAME TO v_poll_home_v1250')
    try:
        b1 = call('GET', '/community/polls?scope=home&q=secret-0101234567')
        b2 = call('GET', '/community/polls?scope=home&q=secret-0101234567')
    finally:
        e1 = psql('ALTER VIEW public.v_poll_home_v1250 RENAME TO v_poll_home')
    j = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
    n1 = int(psql(SQL_N) or 0)
    row = psql("SELECT code || '|' || coalesce(last_detail, '') || '|' || coalesce(last_request_id, '') FROM ops_server_error_days "
               "WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND method = 'GET' AND path = '/api/v1/community/polls' AND status = 500 ORDER BY last_at DESC LIMIT 1")
    saved = (j.get('detail') or {}).get('serverErrorsSaved') or {}
    ok('② 일부러 낸 500 두 번 → launch_watch 뒤 DB 오늘 줄 +2 · 종류 · 가린 설명(표 이름 · DB 오류 번호) · 요청 번호 · 검색어 없음',
       e0 == '' and e1 == '' and b1.get('_err') == 500 and b2.get('_err') == 500 and n1 - n0 >= 2 and 'v_poll_home' in row and '[42P01]' in row
       and 'secret' not in row and '0101234567' not in row and row.split('|')[-1] != '' and isinstance(saved.get('added'), int),
       f'{b1.get("_err")} {b2.get("_err")} · {n0} → {n1} · {row[:120]} · {saved}')
    se = call('GET', '/admin/launch-watch/server-errors', None, TA)
    wk = se.get('week') or {}
    top = next((r for r in wk.get('top', []) if r.get('path') == '/api/v1/community/polls' and r.get('status') == 500), {})
    days = wk.get('days') or []
    ok('② server-errors week — 7일(오래된 것부터 · 맨 끝 오늘) · 합계 · 많이 난 것에 그 줄(건수 · 마지막 · 설명) · ADMIN 봄 · 회원 403',
       se.get('_err') is None and len(days) == 7 and days[-1].get('day') == psql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date") and wk.get('total') == sum(d['n'] for d in days)
       and (top.get('n') or 0) >= 2 and top.get('lastAt') and 'secret' not in json.dumps(se) and call('GET', '/admin/launch-watch/server-errors', None, TB).get('_err') == 403,
       f"{len(days)} · {wk.get('total')} · {top}")
    dg = call('GET', '/admin/launch-watch/digest', None, TS).get('text') or ''
    dl = next((l for l in dg.splitlines() if l.startswith('어제 서버 오류')), '')
    ok('② 하루 요약 「어제 서버 오류 n건(· 많이 난 곳 …)」', re.match(r'^어제 서버 오류 (0건|\d+건 · 많이 난 곳 .+)$', dl) is not None, dl[:160])

    # ── ③ 적용 전 점검 요약 · alerts-week ──
    rl = call('GET', '/admin/launch-watch/releases', None, TS)
    ok('③ 지금 판 — 점검판엔 precheck 결과 파일 없음 → precheck null', 'precheck' in rl and rl.get('precheck') is None, str(rl.get('precheck'))[:100])
    aw = call('GET', '/admin/launch-watch/alerts-week', None, TS)
    db_w = psql("SELECT count(*) || '|' || count(*) FILTER (WHERE acknowledged_at IS NULL AND resolved_at IS NULL) FROM ops_alerts WHERE raised_at > now() - interval '7 days' AND severity IN ('WARN', 'CRITICAL')")
    codes = [r.get('code') for r in aw.get('rows') or []]
    sev = [{'CRITICAL': 2, 'WARN': 1, 'INFO': 0}[r.get('severity')] for r in aw.get('rows') or []]
    ok('③ alerts-week — 경고 이상 합계 · 확인 안 한 합계가 DB 와 맞음 · 종류 겹치지 않음 · 급함 → 경고 → 정보 순',
       aw.get('_err') is None and f"{aw.get('warnTotal')}|{aw.get('warnOpen')}" == db_w and len(codes) == len(set(codes)) and sev == sorted(sev, reverse=True),
       f"{aw.get('warnTotal')}|{aw.get('warnOpen')} · DB {db_w} · {len(codes)}종류")
    ok('③ alerts-week — ADMIN 봄 · 회원 403', call('GET', '/admin/launch-watch/alerts-week', None, TA).get('_err') is None
       and call('GET', '/admin/launch-watch/alerts-week', None, TB).get('_err') == 403, '')

    # ── ④ 주간 알림 ──
    psql("UPDATE site_settings SET value = 'on' WHERE key = 'ops.owner_todo_weekly'")
    time.sleep(1.2)
    aw1 = call('GET', '/admin/launch-watch/alerts-week', None, TS)
    w = call('POST', '/admin/jobs', {'job': 'owner_todo_weekly'}, TS)
    d = w.get('detail') or {}
    al = psql(f"SELECT coalesce(max(title), '') FROM ops_alerts WHERE alert_code = 'OWNER_TODO_WEEKLY' AND raised_at >= '{t0}'")
    if d.get('left') or d.get('warn7'):
        ok('④ 주간 알림 — warn7 = alerts-week 경고 이상 합계 · 알림 제목 「… · 지난 7일 경고 이상 알림 n건 — …」',
           d.get('warn7') == aw1.get('warnTotal') and f"지난 7일 경고 이상 알림 {d.get('warn7')}건" in al, f'{d} · {al[:140]}')
    else:
        ok('④ 주간 알림 — 할 일 끝남 · 경고 이상 0건이면 안 보냄', al == '', f'{d} · {al}')

    # ── ⑤ 화면 ──
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        sync_playwright = None
    if ADMIN_WEB and sync_playwright:
        errs = []
        with sync_playwright() as p:
            b_ = p.chromium.launch()
            pg = b_.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
            pg.goto(ADMIN_WEB + '/', wait_until='networkidle', timeout=120000)
            pg.fill('input[name=email]', 'admin@x.com'); pg.fill('input[name=password]', PW); pg.click('button[type=submit]'); pg.wait_for_timeout(3000)
            pre = pg.locator('[data-release-precheck]').get_attribute('data-release-precheck') if pg.locator('[data-release-precheck]').count() else None
            pg.goto(ADMIN_WEB + '/#/ops-alerts', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            awv = pg.locator('[data-alerts-week]').get_attribute('data-alerts-week') if pg.locator('[data-alerts-week]').count() else None
            pg.goto(ADMIN_WEB + '/#/server-errors', wait_until='networkidle', timeout=120000); pg.wait_for_timeout(2500)
            sev_ = pg.locator('[data-server-errors-week]').get_attribute('data-server-errors-week') if pg.locator('[data-server-errors-week]').count() else None
            b_.close()
        ok('⑤ 화면 — 지금 판 precheck 줄(없음) · 운영 알림 「지난 7일」 · 서버 오류 「최근 7일」(1건 이상) · 화면 오류 없음',
           pre == 'none' and awv is not None and sev_ is not None and int(sev_) >= 2 and not errs, f'{pre} · {awv} · {sev_} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
