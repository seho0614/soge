"""v10.178 시험 — 로그인 · 저장 기본 확인(postcheck) · 느린 응답 지켜보기(D167) · 회원 투표 운영 보조(docs/277)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1178.py

  ① 코드 — D167(ops.slow_p95_ms ADMIN 1500 · 지우는 문장 없음 · 205) · 응답 시간 미들웨어(따로 · 맨 앞 · worker 빠짐) · launch_watch 알림 2개
     · 검수 큐 reportedPolls · 운영 화면(검수 「신고된 회원 투표」 · 지켜보기 「느린 응답」) · postcheck 본문 읽기 줄(문법) · docs/277 · 판
  ② (API) 본문 읽기 — postcheck 와 같은 게시판 추천 POST 200 · confident · 로그인 → 글 저장 → 투표 POST 가 400 이 아님
  ③ (API) 느린 응답 — 지켜보기 slowHour(요청 수 · p95 · 느린 주소) · 기준을 1ms 로 낮추면 launch_watch 가 SLOW_API(1시간에 한 번) · 기준 되돌림
  ④ (API · DB) 회원 투표 — 신고 3건으로 감춰지면 launch_watch 가 POLL_HIDDEN_BY_REPORTS 한 번(두 번 돌려도) · 검수 큐 reportedPolls · 다시 보이기
"""
import json, os, re, subprocess, time, urllib.error, urllib.request

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
M = rd('prisma/migrations/D167_slow_api_watch/migration.sql')
ok('① D167 — ops.slow_p95_ms(ADMIN · 1500 · 숫자 형식) · 지우는 문장 없음 · 205 이상',
   "('ops.slow_p95_ms', '1500', 'ADMIN'," in M and "'^[0-9]{1,5}$'" in M and 'ON CONFLICT (key) DO NOTHING' in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 205 and 'D167_slow_api_watch' in mig, f'{len(mig)} · {mig[-1]}')
AM = rd('src/app.module.ts'); RT = rd('src/common/response-time.ts'); SC = rd('src/worker/scheduler.service.ts')
ok('① 응답 시간 · 알림 — 미들웨어 따로(한도 줄 그대로) · worker 빠짐 · SLOW_API · POLL_HIDDEN_BY_REPORTS · 검수 큐 reportedPolls',
   "consumer.apply(ResponseTimeMiddleware).forRoutes('*');" in AM and 'consumer.apply(ContextMiddleware, AuthMiddleware, ApiRateLimitMiddleware)' in AM
   and AM.index('ResponseTimeMiddleware).forRoutes') < AM.index('ContextMiddleware, AuthMiddleware') and "startsWith('/api/v1/worker')" in RT
   and "'SLOW_API'" in SC and "'POLL_HIDDEN_BY_REPORTS'" in SC and 'reportedPolls' in rd('src/modules/community/community.service.ts'), '')
PC = os.path.join(K, 'deploy/aws/postcheck.sh')
syn = subprocess.run(['bash', '-n', PC], capture_output=True, text=True).returncode if os.path.exists(PC) else -1
ok('① 운영 화면 · postcheck · docs/277 · 판 — 검수 「신고된 회원 투표」 · 지켜보기 「느린 응답」 · postcheck 본문 읽기 줄(문법)',
   'data-reported-polls' in rd('web/src/app/admin/Community.tsx') and "'느린 응답 p95 ms(1시간)'" in rd('web/src/app/admin/LaunchWatch.tsx')
   and '/api/v1/community/classify' in rd('deploy/aws/postcheck.sh') and 'API 가 JSON 본문을 읽지 못함' in rd('deploy/aws/postcheck.sh') and syn == 0
   and any(f.startswith('277_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 178),
   f"bash -n {syn} · {rd('VERSION').strip()}")


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['Authorization'] = 'Bearer ' + tok
    r = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=hd, method=method)
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


def login(e):
    return call('POST', '/auth/login', None, {'email': e, 'password': PW})[1].get('accessToken')


if API and DB:
    # ── ② 본문 읽기 · 저장 한 바퀴 ──────────────────────────────────────
    sc, jc = call('POST', '/community/classify', None, {'title': 'postcheck 본문 읽기 확인'})
    TA, TB = login('admin@x.com'), login('buyer@x.com')
    sp, jp = call('POST', '/me/community/posts', TB, {'board': 'QNA', 'title': '시험 v1178 — 저장 길 확인', 'body': f'본문 읽기 · 저장이 되는지 확인하는 시험 글입니다({time.time_ns()}).'})
    pid = jp.get('id')
    hp = call('GET', '/community/polls?scope=home')[1]
    hp = hp if isinstance(hp, list) else []
    sv, jv = (call('POST', f"/community/polls/{hp[0]['id']}/vote", TB, {'optionId': hp[0]['options'][0]['id']}) if hp and hp[0].get('options') else (0, {}))
    ok('② 본문 읽기 · 저장 — 게시판 추천 200 · confident · 로그인 토큰 · 글 저장 201 · 투표 201 또는 409(이미) — 어느 것도 400 아님',
       sc in (200, 201) and 'confident' in jc and TA and TB and sp == 201 and pid and sv in (201, 409), f'추천 {sc} · 글 {sp} {jp.get("code")} · 투표 {sv} {jv.get("code")}')
    if pid: psql(f"UPDATE posts SET state = 'DELETED', created_at = now() - interval '2 days' WHERE id = '{pid}'")

    # ── ③ 느린 응답 ──────────────────────────────────────────────────
    for _ in range(60): call('GET', '/health')
    w = call('GET', '/admin/launch-watch', TA)[1]
    sh = w.get('slowHour') or {}
    ok('③ 지켜보기 slowHour — 요청 60건 이상 · p95(ms) 숫자 · 느린 주소 목록 · 기준 slowLimitMs 1500',
       (sh.get('n') or 0) >= 60 and isinstance(sh.get('p95'), int) and isinstance(sh.get('top'), list) and w.get('slowLimitMs') == 1500
       and not any('/worker' in (t.get('path') or '') for t in sh.get('top', [])), f"n {sh.get('n')} · p95 {sh.get('p95')} · 기준 {w.get('slowLimitMs')} · {[t.get('path') for t in sh.get('top', [])][:3]}")
    old = psql("SELECT value FROM site_settings WHERE key = 'ops.slow_p95_ms'")[0] or '1500'
    psql("DELETE FROM ops_alerts WHERE alert_code = 'SLOW_API'")
    psql("UPDATE site_settings SET value = '1' WHERE key = 'ops.slow_p95_ms'")
    try:
        s1, j1 = call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})
        s2, _ = call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})
        na = psql("SELECT count(*) FROM ops_alerts WHERE alert_code = 'SLOW_API' AND severity = 'WARN'")[0]
    finally:
        psql(f"UPDATE site_settings SET value = '{old}' WHERE key = 'ops.slow_p95_ms'")
    psql("DELETE FROM ops_alerts WHERE alert_code = 'SLOW_API'")
    ok('③ 기준 1ms → launch_watch 가 SLOW_API 한 번(두 번 돌려도 1) · slowP95 기록 · 기준 되돌림',
       s1 in (200, 201) and s2 in (200, 201) and na == '1' and isinstance((j1.get('detail') or {}).get('slowP95'), int)
       and psql("SELECT value FROM site_settings WHERE key = 'ops.slow_p95_ms'")[0] == old, f'{s1} {s2} · 알림 {na} · {(j1.get("detail") or {}).get("slowP95")} · {old}')

    # ── ④ 회원 투표 운영 보조 ──────────────────────────────────────────
    keys = ('poll.member_create', 'poll.member_min_age_hours', 'poll.member_daily_limit')
    before = dict(r.split('|') for r in psql("SELECT key || '|' || value FROM site_settings WHERE key IN ('" + "','".join(keys) + "')")[0].splitlines())
    psql("UPDATE polls SET created_at = created_at - interval '2 days' WHERE source = 'MEMBER' AND created_at > now() - interval '1 day'")
    for k, v in (('poll.member_create', 'on'), ('poll.member_min_age_hours', '0'), ('poll.member_daily_limit', '3')):
        psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
    try:
        s3, j3 = call('POST', '/community/my-polls', TB, {'kind': 'ASK', 'title': '시험 v1178 — 신고 감춤 알림', 'options': [{'label': '가'}, {'label': '나'}], 'days': 3})
        p = j3.get('id')
        rc = psql("SELECT code FROM report_reasons WHERE gwan_code IS NULL ORDER BY sort_order LIMIT 1")[0]
        for e in ('intro@x.com', 'seller@x.com', 'person@x.com'):
            psql(f"INSERT INTO reports (target_type, target_id, reason_code, reporter_id, state) SELECT 'POLL', '{p}', '{rc}', id, 'OPEN' FROM accounts WHERE email = '{e}'")
        q1 = {x.get('id'): x for x in call('GET', '/admin/community/queue', TA)[1].get('reportedPolls', [])}
        call('POST', '/admin/jobs', TA, {'job': 'launch_watch'}); call('POST', '/admin/jobs', TA, {'job': 'launch_watch'})
        na = psql(f"SELECT count(*) FROM ops_alerts WHERE alert_code = 'POLL_HIDDEN_BY_REPORTS' AND detail->>'pollId' = '{p}'")[0]
        ok('④ 신고 3건 감춤 → POLL_HIDDEN_BY_REPORTS 한 번(두 번 돌려도) · 검수 큐 reportedPolls(감춤 · 신고 3 · 만든 회원)',
           s3 == 201 and q1.get(p, {}).get('state') == 'HIDDEN' and q1.get(p, {}).get('reportCount') == 3 and q1.get(p, {}).get('author') and na == '1',
           f'{s3} · {q1.get(p, {}).get("state")} {q1.get(p, {}).get("reportCount")} · 알림 {na}')
        su, ju = call('PATCH', f'/admin/community/polls/{p}', TA, {'state': 'OPEN'})
        q2 = {x.get('id'): x for x in call('GET', '/admin/community/queue', TA)[1].get('reportedPolls', [])}
        ok('④ 다시 보이기(검수 화면과 같은 API) — OPEN · 신고 기각 3 · 검수 큐에서 빠짐(신고 수 0)', su == 200 and ju.get('dismissed') == 3 and p not in q2, f'{su} · {ju.get("dismissed")}')
    finally:
        for k, v in before.items(): psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")
        psql("UPDATE polls SET state = 'HIDDEN', hidden_reason = '시험 정리(test_v1178)' WHERE source = 'MEMBER' AND state <> 'HIDDEN'")
else:
    print('  (API · DB 없음 — ②③④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
