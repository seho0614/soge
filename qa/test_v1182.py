"""v10.182 시험 — 서버 디스크 · 메모리 지켜보기 · 최근 서버 오류 · 메인 투표 자동 채우기(D171 · docs/285)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1182.py

  ① 코드 — D171(설정 2 · v_poll_home 다시 정의 · 칸 그대로 · ADMIN 만 자동 · 지우는 문장 없음 · 209) · server-health · 설명 가리기 · API · 화면 · docs/285 · 판
  ② (API · DB) 디스크 — 「지켜보기」 server(디스크 · 메모리 · 폴더) · 기준 85 · 기준을 낮추면 DISK_LOW 한 번(두 번째 없음) · 회원 403
  ③ (API · DB) 서버 오류 — 일부러 낸 500 이 최근 목록에(방법 · 주소 · 종류 · 요청 번호 · 표 이름은 보이고 값은 가림) · 회원 403
  ④ (API · DB) 메인 투표 — 고른 것이 없으면 자동으로 채움(AUTO) · 끄면 비어 있음(EMPTY) · 고르면 PICKED · 메인 목록에 반영
"""
import json, os, re, subprocess, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB')
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
M = rd('prisma/migrations/D171_ops_disk_poll_autofill/migration.sql')
ok('① D171 — 설정 ops.disk_warn_pct 85 · poll.home_autofill on · v_poll_home 칸 그대로 · 고른 것 먼저 · 자동은 ADMIN 만 · 지우는 문장 없음 · 209 이상',
   "('ops.disk_warn_pct', '85', 'ADMIN'" in M and "('poll.home_autofill', 'on', 'ADMIN'" in M and 'ON CONFLICT (key) DO NOTHING' in M
   and 'SELECT DISTINCT ON (p.kind) p.id, p.kind, p.title, p.description, p.image, p.sort, p.ends_at, p.opened_at' in M
   and 'p.show_on_home DESC' in M and "p.source = 'ADMIN'" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|TRUNCATE)\b', M) and len(mig) >= 209 and 'D171_ops_disk_poll_autofill' in mig,
   f'{len(mig)} · {mig[-1]}')

H = rd('src/common/server-health.ts'); E = rd('src/common/server-error-count.ts'); F = rd('src/common/db-error.filter.ts')
LW = rd('src/modules/admin/launch-watch.service.ts'); LC = rd('src/modules/admin/launch-watch.controller.ts'); SC = rd('src/worker/scheduler.service.ts')
ok('① 서버 — statfs · MemAvailable · 폴더 크기 멈춤(20만 · 5초) · 최근 50건 · 설명 가리기 · 오류 필터 기록 · DISK_LOW · 하루 요약 디스크 줄 · 새 패키지 없음',
   'statfsSync' in H and 'MemAvailable' in H and '200_000' in H and 'maxMs = 5000' in H
   and 'LAST_MAX = 50' in E and 'export function maskDetail' in E and 'recentServerErrors' in E
   and 'requestId: RequestCtx.get()?.requestId' in F and "@Get('server-errors')" in LC
   and "this.alert('DISK_LOW'" in SC and 'measureServerHealth()' in SC and 'diskLine(serverHealth())' in LW
   and "from 'node:fs'" in H and not re.search(r"from '(?!node:|\.)", H), '')

S = json.loads(rd('spec/screens.json') or '{}')
scr = next((s for s in S.get('screens', []) if s.get('id') == 'SB-ADM-ERR-010'), {})
MENU = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx'); LWT = rd('web/src/app/admin/LaunchWatch.tsx'); PT = rd('web/src/app/admin/Polls.tsx')
ok('① 화면 — 서버 오류 탭 · 「지켜보기」 디스크 줄 · 링크 · 투표 메인 3자리 표 · 자동 채우기 단추 · screens.json · 영어 · docs/285 · 판 v10.182 이상',
   "'server-errors'" in MENU and '<ServerErrors />' in APP and 'data-server-health' in LWT and '#/server-errors' in LWT
   and 'data-home-slots' in PT and "'poll.home_autofill'" in PT and 'GET /admin/launch-watch/server-errors' in scr.get('apis', [])
   and '"API 를 다시 띄우면 지워집니다 · 요청 내용 · 개인정보는 남기지 않습니다."' in rd('src/common/i18n/server-text.en.ts')
   and any(f.startswith('285_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 182),
   rd('VERSION').strip())


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['authorization'] = f'Bearer {tok}'
    r = urllib.request.Request(API + path, method=method, headers=hd, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(r, timeout=120) as x:
            b = x.read(); s = x.status
    except urllib.error.HTTPError as e:
        b = e.read(); s = e.code
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


if API and DB:
    psql('DELETE FROM auth_throttle')
    TA = call('POST', '/auth/login', None, {'email': 'admin@x.com', 'password': PW})[1].get('accessToken')
    TB = call('POST', '/auth/login', None, {'email': 'buyer@x.com', 'password': PW})[1].get('accessToken')

    # ── ② 디스크 ──────────────────────────────────────────────────────
    w, jw = call('GET', '/admin/launch-watch', TA)
    sv = jw.get('server') or {}
    dk = sv.get('disk') or {}
    wb, _ = call('GET', '/admin/launch-watch', TB)
    ok('② 지켜보기 — 디스크(사용률 0 ~ 100 · 남은 GB · 전체 GB) · 메모리 · 올린 파일 · 백업(없으면 null) · 기준 85 · 회원 403',
       w == 200 and isinstance(dk.get('usedPct'), int) and 0 <= dk['usedPct'] <= 100 and dk.get('totalGB', 0) > 0 and dk.get('freeGB', -1) >= 0
       and (sv.get('mem') or {}).get('totalMB', 0) > 0 and 'uploads' in sv and 'backup' in sv and jw.get('diskWarnPct') == 85 and wb == 403,
       f"{w} · {dk} · {sv.get('mem')} · {jw.get('diskWarnPct')} · {wb}")

    psql("DELETE FROM ops_alerts WHERE alert_code = 'DISK_LOW'")
    psql("UPDATE site_settings SET value = '1' WHERE key = 'ops.disk_warn_pct'")
    try:
        j1 = call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})[1].get('detail') or {}
        j2 = call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})[1].get('detail') or {}
        al = psql("SELECT count(*) || '|' || coalesce(max(severity), '') || '|' || coalesce(max(detail->>'level'), '') FROM ops_alerts WHERE alert_code = 'DISK_LOW'")[0]
    finally:
        psql("UPDATE site_settings SET value = '85' WHERE key = 'ops.disk_warn_pct'")
        psql("DELETE FROM ops_alerts WHERE alert_code = 'DISK_LOW'")
    dg, jd = call('GET', '/admin/launch-watch/digest', TA)
    ok('② 알림 — 기준을 1%로 낮추면 DISK_LOW 한 번(WARN 또는 95% 넘으면 CRITICAL) · 두 번째 작업에서 다시 없음 · 하루 요약에 디스크 줄',
       isinstance(j1.get('diskPct'), int) and al.split('|')[0] == '1' and al.split('|')[1] in ('WARN', 'CRITICAL') and al.split('|')[1] == al.split('|')[2]
       and isinstance(j2.get('diskPct'), int) and dg == 200 and '서버 디스크' in (jd.get('text') or '') and (jd.get('disk') or {}).get('usedPct') is not None,
       f"{j1.get('diskPct')} · {al} · {dg}")

    # ── ③ 최근 서버 오류 ──────────────────────────────────────────────────
    _, e0 = psql('ALTER VIEW public.v_poll_home RENAME TO v_poll_home_v1182')
    try:
        b5, _ = call('GET', '/community/polls?scope=home&q=secret-0101234567')
    finally:
        _, e1 = psql('ALTER VIEW public.v_poll_home_v1182 RENAME TO v_poll_home')
    s1, js = call('GET', '/admin/launch-watch/server-errors', TA)
    row = next((r for r in js.get('items', []) if r.get('path') == '/api/v1/community/polls'), {})
    sm, _ = call('GET', '/admin/launch-watch/server-errors', TB)
    b6, _ = call('GET', '/community/polls?scope=home')
    ok('③ 서버 오류 — 일부러 낸 500 이 목록 맨 위 쪽에 · GET · 주소(물음표 뒤 없음) · 500 · 종류 · 요청 번호 · 설명에 DB 오류 번호 · 표 이름은 보이고 검색어 없음 · 회원 403 · 되돌린 뒤 200',
       e0 == '' and e1 == '' and b5 == 500 and s1 == 200 and row.get('method') == 'GET' and row.get('status') == 500 and row.get('code')
       and row.get('requestId') and 'v_poll_home' in (row.get('detail') or '') and '[42P01]' in (row.get('detail') or '')
       and 'secret' not in json.dumps(js) and '0101234567' not in json.dumps(js) and js.get('hour', 0) >= 1 and sm == 403 and b6 == 200,
       f"{e0[:40]} {e1[:40]} · {b5} · {s1} · {row} · {sm} · {b6}")

    # ── ④ 메인 투표 자동 채우기 ──────────────────────────────────────────
    vs = psql("SELECT string_agg(id::text || ':' || show_on_home::text, ',') FROM polls WHERE kind = 'VS'")[0]
    has_open = psql("SELECT count(*) FROM polls WHERE kind = 'VS' AND source = 'ADMIN' AND state = 'OPEN' AND (ends_at IS NULL OR ends_at > now())")[0]
    try:
        psql("UPDATE polls SET show_on_home = false WHERE kind = 'VS'")
        a1 = call('GET', '/admin/community/polls', TA)[1]
        slot1 = next((h for h in a1.get('homeSlots', []) if h.get('kind') == 'VS'), {})
        h1 = call('GET', '/community/polls?scope=home')[1]
        psql("UPDATE site_settings SET value = 'off' WHERE key = 'poll.home_autofill'")
        a2 = call('GET', '/admin/community/polls', TA)[1]
        slot2 = next((h for h in a2.get('homeSlots', []) if h.get('kind') == 'VS'), {})
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'poll.home_autofill'")
        pick = slot1.get('id')
        if pick: psql(f"UPDATE polls SET show_on_home = true WHERE id = '{pick}'")
        a3 = call('GET', '/admin/community/polls', TA)[1]
        slot3 = next((h for h in a3.get('homeSlots', []) if h.get('kind') == 'VS'), {})
    finally:
        psql("UPDATE site_settings SET value = 'on' WHERE key = 'poll.home_autofill'")
        for pair in (vs or '').split(','):
            if ':' in pair:
                pid, flag = pair.split(':'); psql(f"UPDATE polls SET show_on_home = {flag} WHERE id = '{pid}'")
    home_ids = [p.get('id') for p in (h1 if isinstance(h1, list) else h1.get('items', []))]
    ok('④ 메인 투표 — 고른 것 없으면 AUTO(최근 열린 운영 투표 · 메인 목록에 나옴) · 끄면 EMPTY · 고르면 PICKED · 자리 3개 · 설정 값 되돌림',
       int(has_open or 0) >= 1 and len(a1.get('homeSlots', [])) == 3 and slot1.get('state') == 'AUTO' and slot1.get('id') in home_ids
       and a1.get('homeAutofill') is True and slot2.get('state') == 'EMPTY' and a2.get('homeAutofill') is False and slot3.get('state') == 'PICKED',
       f"{has_open} · {slot1.get('state')} · {slot2.get('state')} · {slot3.get('state')}")
else:
    print('  (API · DB 없음 — ②③④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
