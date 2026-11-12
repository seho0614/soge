"""v10.247 ~ v10.249 (D203 · docs/386) — 적용 결과 파일 보기 · 서버 자원 추세 · 대표 할 일 주간 알림

  KIT=<kit> API=http://localhost:13000/api/v1 DB=postgresql://sgb:sgb@localhost:15432/sgb ADMIN_WEB=http://localhost:15173 python3 test_v1247.py

  ① (코드) 결과 파일 이름 형식 · SUPER · 앞 200KB · lstat · D203(ops_server_daily 쌓기만 · 설정 · 정기 작업 월 09:05) ·
     launch_watch 하루 한 줄 · 하루 요약 디스크 추세 줄 · 주간 알림(스위치 · 아직인 줄만 · 켜 둔 길만) · 화면 · 명세 · 영어 · 문서 386 · 판 v10.249 이상
  ② (API) 결과 파일 — 점검판엔 파일 없음(빈 목록) · ADMIN · 회원 403 · 이상한 이름 422 OPS_FILE_NAME · 없는 파일 422 OPS_FILE_MISSING
  ③ (API) 서버 자원 — launch_watch 를 두 번 돌려도 오늘 줄 1개 · 추세 API(오늘 줄 · 기준 · 기울기 계산이 같은 식과 맞음) · 고치기 · 지우기 막힘 · 하루 요약 줄
  ④ (API) 주간 알림 — 스위치 off 면 안 보내고 알림 없음 · on 이면 아직인 줄 수 · 텔레그램 · 슬랙 준비 안 됨 까닭 · OWNER_TODO_WEEKLY 한 건
  ⑤ (화면) 지금 판 카드 「결과 파일」(SUPER) · 서버 자원 추세 카드
  두 번 돌아도 통과 — 기록 · 알림은 「시작 뒤」만 봄. 결과 파일이 있을 때(목록 · 본문 · 200KB · 링크)는 test_v1247_files(서버에서 직접).
"""
import json, os, re, subprocess, time, urllib.error, urllib.parse, urllib.request
from datetime import date

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
MIG = rd('prisma/migrations/D203_ops_server_daily_todo_weekly/migration.sql')
RL, TR, OT, CT, LW, SC, WK = (rd('src/modules/admin/release-log.service.ts'), rd('src/modules/admin/server-trend.service.ts'),
                              rd('src/modules/admin/owner-todo.service.ts'), rd('src/modules/admin/launch-watch.controller.ts'),
                              rd('src/modules/admin/launch-watch.service.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts'))
ST, DS, EN, DBS, AM = (rd('web/src/app/admin/StateCheck.tsx'), rd('web/src/app/admin/Dashboard.tsx'), rd('src/common/i18n/server-text.en.ts'),
                       rd('src/db/database.service.ts'), rd('src/app.module.ts'))
SJ = json.loads(rd('spec/screens.json') or '{"screens":[]}')
apis = {a for s in SJ.get('screens', []) for a in s.get('apis', [])}
ok('① 결과 파일 — 이름 형식 5종만(빌드 기록 · precheck_state 뺌) · 최근 10개 · 앞 200KB · 링크 안 따라감(lstat) · 쓰기 없음 · 422 두 가지',
   "OPS_FILE = /^(precheck|postcheck|apply|cleanup|open-prep)_(\\d{8})_(\\d{6})\\.txt$/" in RL and 'OPS_FILE_MAX = 200_000' in RL
   and '.slice(0, 10)' in RL and 'lstatSync(p)' in RL and "'OPS_FILE_NAME'" in RL and "'OPS_FILE_MISSING'" in RL
   and 'writeFileSync' not in RL and 'unlinkSync' not in RL, '')
ok('① API — releases/files · releases/file(SUPER) · server-trend · 명세 · 영어 2문장',
   "@Get('releases/files')" in CT and "@Get('releases/file')" in CT and CT.count("@Roles('SUPER')") >= 3 and "@Get('server-trend')" in CT
   and {'GET /admin/launch-watch/releases/files', 'GET /admin/launch-watch/releases/file', 'GET /admin/launch-watch/server-trend'} <= apis
   and '"적용 스크립트 결과 파일(precheck · postcheck · apply · cleanup · open-prep)만 열 수 있습니다."' in EN
   and '"그 결과 파일이 서버에 없습니다(지워졌을 수 있음)."' in EN, '')
ok('① D203 — ops_server_daily(날짜 기본 키 · 고치기 · 지우기 막음) · 설정 ops.owner_todo_weekly on · 작업 월요일(2) 09:05 · 지우는 문장 없음 · 쌓기만 목록',
   'CREATE TABLE IF NOT EXISTS public.ops_server_daily' in MIG and 'day           date PRIMARY KEY' in MIG
   and 'BEFORE DELETE OR UPDATE ON public.ops_server_daily' in MIG and "('ops.owner_todo_weekly', 'on'" in MIG
   and "('owner_todo_weekly', 10080, 9, 5, 2, true" in MIG and 'DROP TABLE' not in MIG and 'DELETE FROM' not in MIG and "'ops_server_daily'" in DBS, '')
ok('① 서버 자원 — launch_watch 가 그날 처음 잰 값만(ON CONFLICT (day) DO NOTHING) · 최근 14일 기울기 · 3일부터 · 하루 요약 줄 · 공급자',
   'this.trend.record(sh)' in SC and 'ON CONFLICT (day) DO NOTHING' in TR and 'export function diskTrend' in TR and '.slice(-14)' in TR
   and 'pts.length < 3' in TR and 'await this.trend.digestLine().catch(' in LW and 'ServerTrendService,' in AM, '')
ok('① 주간 알림 — 작업 owner_todo_weekly(실행 목록) · 스위치 · 아직인 줄만 · 모두 끝나면 안 보냄 · 텔레그램 · 슬랙 · OWNER_TODO_WEEKLY INFO',
   "case 'owner_todo_weekly'" in SC and "'owner_todo_weekly'," in WK and "key = 'ops.owner_todo_weekly'" in SC and 'if (!left.length) return' in SC
   and 'this.telegram.send(text)' in SC and 'this.slack.send(text)' in SC and "this.alert('OWNER_TODO_WEEKLY', 'INFO'" in SC
   and 'export function ownerTodoWeeklyText' in OT, '')
ok('① 화면 — 「결과 파일」(SUPER) · 본문 열기 · 서버 자원 추세 카드 · 첫 화면',
   'data-release-files-btn' in ST and 'function OpsFiles()' in ST and '/admin/launch-watch/releases/file?name=' in ST
   and 'export function ServerTrend()' in ST and 'data-server-trend' in ST and '<ServerTrend />' in DS, '')
DOC = [f for f in os.listdir(os.path.join(K, 'docs')) if f.startswith('386_')] if os.path.isdir(os.path.join(K, 'docs')) else []
ok('① 문서 386 · 판 v10.249 이상', bool(DOC) and tuple(int(x) for x in re.findall(r'\d+', VER)) >= (10, 249), f'{DOC} · {VER}')


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
        return {'_err': e.code, 'code': body.get('code'), 'message': body.get('message')}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
    return r.stdout.strip() if not r.returncode else ('!' + r.stderr.strip()[:200])


def trend_py(rows, limit):
    """server-trend.service.ts diskTrend 와 같은 식"""
    pts = [(date.fromisoformat(r['day']).toordinal(), r['disk']) for r in rows if r.get('disk') is not None][-14:]
    if len(pts) < 3: return None, None
    n = len(pts); mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    s = sum((p[0] - mx) * (p[1] - my) for p in pts) / sxx if sxx else 0
    last = pts[-1][1]
    import math
    days = math.ceil((limit - last) / s) if limit > 0 and s > 0.05 and last < limit else None
    return round(s * 100) / 100, days


if API and DB:
    import sys
    sys.path.insert(0, HERE)
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = call('POST', '/auth/login', {'email': 'admin@x.com', 'password': PW}).get('accessToken')
    TA = call('POST', '/auth/login', {'email': 'ops@t.local', 'password': RPW}).get('accessToken')
    TB = call('POST', '/auth/login', {'email': 'buyer@x.com', 'password': PW}).get('accessToken')
    t0 = psql("SELECT now()")

    # ── ② 결과 파일(점검판에는 파일 없음) ──
    fl = call('GET', '/admin/launch-watch/releases/files', None, TS)
    fa, fb = call('GET', '/admin/launch-watch/releases/files', None, TA), call('GET', '/admin/launch-watch/releases/files', None, TB)
    ok('② 결과 파일 목록 — SUPER 봄(점검판은 빈 목록 · 폴더 이름) · ADMIN 403 · 회원 403',
       fl.get('_err') is None and fl.get('files') == [] and str(fl.get('dir', '')).endswith('/logs') and fa.get('_err') == 403 and fb.get('_err') == 403,
       f"{fl.get('dir')} · {len(fl.get('files') or [])} · {fa.get('_err')} · {fb.get('_err')}")
    bad = [call('GET', '/admin/launch-watch/releases/file?name=' + urllib.parse.quote(n), None, TS)
           for n in ('../../etc/passwd', 'precheck_state.txt', 'apply_20261112_100500_build.log', 'postcheck_x.txt', '')]
    miss = call('GET', '/admin/launch-watch/releases/file?name=postcheck_19990101_000000.txt', None, TS)
    fa2 = call('GET', '/admin/launch-watch/releases/file?name=postcheck_19990101_000000.txt', None, TA)
    ok('② 결과 파일 본문 — 이상한 이름 5가지 422 OPS_FILE_NAME · 없는 파일 422 OPS_FILE_MISSING · ADMIN 403',
       all(b.get('_err') == 422 and b.get('code') == 'OPS_FILE_NAME' for b in bad) and miss.get('_err') == 422 and miss.get('code') == 'OPS_FILE_MISSING'
       and fa2.get('_err') == 403, f"{[(b.get('_err'), b.get('code')) for b in bad]} · {miss.get('_err')} {miss.get('code')} · {fa2.get('_err')}")

    # ── ③ 서버 자원 ──
    today = psql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date")
    j1 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
    j2 = call('POST', '/admin/jobs', {'job': 'launch_watch'}, TS)
    n_today = psql(f"SELECT count(*) FROM ops_server_daily WHERE day = '{today}'")
    row = psql(f"SELECT coalesce(disk_pct::text, '-') || '|' || mem_pct FROM ops_server_daily WHERE day = '{today}'")
    ok('③ launch_watch 두 번 → 오늘(한국 날짜) 줄 1개 · 두 번째는 넣지 않음(serverDaily false) · 디스크 · 메모리 %',
       j1.get('_err') is None and j2.get('_err') is None and n_today == '1' and (j2.get('detail') or {}).get('serverDaily') is False
       and re.match(r'^\d{1,3}\|\d{1,3}$', row or '') is not None, f"{n_today} · {row} · {(j1.get('detail') or {}).get('serverDaily')} → {(j2.get('detail') or {}).get('serverDaily')}")
    # 기울기 계산을 보려고 지난날 3줄(아주 옛날 · 쌓기만이라 남음 · 두 번째부터는 넣지 않음)
    psql("INSERT INTO ops_server_daily (day, disk_pct, disk_free_gb, mem_pct) VALUES ('2000-01-01', 40, 30, 20), ('2000-01-02', 42, 29, 21), ('2000-01-03', 44, 28, 22) ON CONFLICT (day) DO NOTHING")
    tr = call('GET', '/admin/launch-watch/server-trend', None, TS)
    rows = tr.get('rows') or []
    lim = psql("SELECT coalesce((SELECT nullif(value, '')::int FROM site_settings WHERE key = 'ops.disk_warn_pct'), 85)")
    es, ed = trend_py(rows, int(lim or 85))
    ok('③ 추세 API — 오래된 것부터 · 맨 끝이 오늘 · 기준 = ops.disk_warn_pct · 기울기 · 남은 날이 같은 식과 맞음 · 30줄까지',
       tr.get('_err') is None and rows and rows[-1].get('day') == today and [r['day'] for r in rows] == sorted(r['day'] for r in rows)
       and tr.get('limit') == int(lim) and len(rows) <= 30 and tr.get('points') == min(14, sum(1 for r in rows if r.get('disk') is not None))
       and (es is None or abs((tr.get('slope') or 0) - es) < 0.011) and tr.get('daysToLimit') == ed,
       f"{len(rows)}줄 · 끝 {rows[-1] if rows else None} · 기준 {tr.get('limit')} · {tr.get('slope')}/{es} · {tr.get('daysToLimit')}/{ed}")
    ta_, tb_ = call('GET', '/admin/launch-watch/server-trend', None, TA), call('GET', '/admin/launch-watch/server-trend', None, TB)
    up = psql(f"UPDATE ops_server_daily SET mem_pct = 1 WHERE day = '{today}'")
    de = psql("DELETE FROM ops_server_daily WHERE day = '2000-01-01'")
    ok('③ ADMIN 도 봄 · 회원 403 · 고치기 · 지우기 막힘', ta_.get('_err') is None and tb_.get('_err') == 403 and up.startswith('!') and de.startswith('!'),
       f"{ta_.get('_err')} · {tb_.get('_err')} · {up[:30]} · {de[:30]}")
    dg = call('GET', '/admin/launch-watch/digest', None, TS).get('text') or ''
    dl = next((l for l in dg.splitlines() if l.startswith('디스크 추세')), '')
    ok('③ 하루 요약 「디스크 추세 하루 ±n%p · …」', re.match(r'^디스크 추세( 하루 [+-]?\d+(\.\d+)?%p · (늘지 않음|\d+% 까지 약 \d+일|이미 \d+% 넘음\(\d+%\))| — 기록 \d+일\(3일부터 계산\))$', dl) is not None, dl)

    # ── ④ 주간 알림 ──
    td = call('GET', '/admin/launch-watch/owner-todo', None, TS)
    left = [r for r in td.get('rows', []) if r.get('done') is not True]
    psql("UPDATE site_settings SET value = 'off' WHERE key = 'ops.owner_todo_weekly'")
    w0 = call('POST', '/admin/jobs', {'job': 'owner_todo_weekly'}, TS)
    a0 = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'OWNER_TODO_WEEKLY' AND raised_at >= '{t0}'")
    psql("UPDATE site_settings SET value = 'on' WHERE key = 'ops.owner_todo_weekly'")
    ok('④ 스위치 off — 보내지 않음 · 알림 없음', w0.get('_err') is None and (w0.get('detail') or {}).get('off') is True and a0 == '0', f"{w0.get('detail')} · 알림 {a0}")
    time.sleep(1.2)
    w1 = call('POST', '/admin/jobs', {'job': 'owner_todo_weekly'}, TS)
    d1 = w1.get('detail') or {}
    al = psql(f"SELECT count(*) || '|' || max(severity) || '|' || max(title) FROM ops_alerts WHERE alert_code = 'OWNER_TODO_WEEKLY' AND raised_at >= '{t0}'")
    if left:
        ok('④ 스위치 on — 아직인 줄 수 = owner-todo · 텔레그램 · 슬랙은 준비 안 된 까닭(점검판) · OWNER_TODO_WEEKLY INFO 한 건 「보낸 길 없음」',
           w1.get('affected') == len(left) and d1.get('left') == len(left) and d1.get('total') == td.get('total')
           and d1.get('telegram') not in (None, 'SENT') and d1.get('slack') not in (None, 'SENT')
           and al.startswith('1|INFO|대표 할 일 아직 ') and '보낸 길 없음' in al, f'{d1} · {al[:120]}')
    else:
        ok('④ 스위치 on — 모두 끝나 보내지 않음 · 알림 없음', d1.get('left') == 0 and al.startswith('0|'), f'{d1} · {al}')

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
            pg.click('[data-release-files-btn]'); pg.wait_for_timeout(2000)
            of = pg.locator('[data-ops-files]')
            ofn = of.get_attribute('data-ops-files') if of.count() else None
            tc = pg.locator('[data-server-trend]')
            tcv = (tc.count(), int(tc.get_attribute('data-server-trend-points') or 0) if tc.count() else 0,
                   pg.locator('[data-server-trend-day]').count())
            b_.close()
        ok('⑤ 첫 화면 — 「결과 파일」 → 목록(점검판 0개) · 서버 자원 추세 카드(막대 = 줄 수) · 화면 오류 없음',
           ofn == '0' and tcv[0] == 1 and tcv[1] >= 1 and tcv[2] == tcv[1] and not errs, f'{ofn} · {tcv} · {errs[:2]}')
    else:
        print('  (운영 화면 · playwright 없음 — ⑤ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
