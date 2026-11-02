"""v10.179 시험 — 운영 알림 목록 · 확인 · 개인정보 접속기록 월 점검(D168) · 느린 DB 조회 지켜보기(docs/279)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1179.py

  ① 코드 — D168(ack_note · 확인 지킴 · pii_reviews 고칠 수 없음 · 설정 · 지우는 문장 없음 · 206) · API 6개 · 운영 화면 2개(메뉴 · SUPER) · screens.json
     · 하루 요약 PII_REVIEW_DUE · DB 조회 시간 · 지켜보기 · docs/279 · 판
  ② (API · DB) 운영 알림 — 목록(확인 안 한 것 · 종류 거르기 · 종류별 수) · 확인(메모) · 두 번 확인 409 · DB 가 확인 되돌리기 · 내용 바꾸기 거절 · 같은 종류 한꺼번에 · 전부 보기 · 회원 403
  ③ (API · DB) 개인정보 점검 — 12달 · 지난달 운영자 요약(살펴볼 것 · 밤) · 회원 상세 보기가 셈에 들어감 · 이번 달 점검 422 · 짧은 메모 400 · 점검 완료 · 두 번 409 · DB 가 고치기 거절 · ADMIN 은 403
  ④ (API · DB) 느린 조회 — 표를 잠가 300ms 넘는 조회를 만들면 지켜보기 slowSql 에 모양으로(넘긴 값 없음)
"""
import json, os, re, subprocess, threading, time, urllib.error, urllib.request

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
M = rd('prisma/migrations/D168_ops_alert_ack_pii_review/migration.sql')
ok('① D168 — ack_note · 확인 지킴 트리거 · audit.pii_reviews(고칠 수 없음) · pii.review_flag_daily 50 · 지우는 문장 없음 · 206 이상',
   'ADD COLUMN IF NOT EXISTS ack_note' in M and 'CREATE TRIGGER trg_ops_alert_ack_guard' in M and 'CREATE TABLE IF NOT EXISTS audit.pii_reviews' in M
   and 'CREATE TRIGGER trg_pii_reviews_ro' in M and "('pii.review_flag_daily', '50', 'ADMIN'," in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 206 and 'D168_ops_alert_ack_pii_review' in mig, f'{len(mig)} · {mig[-1]}')
C = rd('src/modules/admin/ops-review.controller.ts'); MENU = rd('web/src/lib/adminMenu.ts'); APP = rd('web/src/App.tsx'); SP = rd('spec/screens.json')
ok('① API · 화면 — 운영 알림 3 · 개인정보 3(SUPER) · 메뉴 위험감지 묶음 · pii-review SUPER 만 · screens.json · 대시보드 긴급 경보 → 운영 알림',
   all(x in C for x in ("@Get('ops-alerts')", "@Post('ops-alerts/:id/ack')", "@Post('ops-alerts/ack-code')", "@Get('pii-review')", "@Get('pii-review/:month')", "@Post('pii-review')"))
   and C.count("@Roles('SUPER')") == 3 and "['ops-alerts', '운영 알림']" in MENU and "'pii-review'" in MENU
   and "'terms', 'pii-review']" in APP and "<OpsAlerts />" in APP and "<PiiReview />" in APP
   and '"SB-ADM-OPS-010"' in SP and '"SB-ADM-PII-010"' in SP and "go: 'ops-alerts'" in rd('web/src/app/admin/Dashboard.tsx'), '')
ok('① 하루 요약 PII_REVIEW_DUE · DB 조회 시간(300ms) · 지켜보기 slowSql · 운영 알림 바로가기 · docs/279 · 판',
   "'PII_REVIEW_DUE'" in rd('src/worker/scheduler.service.ts') and 'recordSql(sql, performance.now() - t0)' in rd('src/db/database.service.ts')
   and 'slowSql: slowSqlSince(60)' in rd('src/modules/admin/launch-watch.service.ts') and 'href="#/ops-alerts"' in rd('web/src/app/admin/LaunchWatch.tsx')
   and any(f.startswith('279_') for f in os.listdir(os.path.join(K, 'docs'))) and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 179), rd('VERSION').strip())


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
    TA, TB, TO = login('admin@x.com'), login('buyer@x.com'), login('ops@t.local')

    # ── ② 운영 알림 ──────────────────────────────────────────────────
    psql("DELETE FROM ops_alerts WHERE alert_code = 'TEST_V1179'")
    psql("""INSERT INTO ops_alerts (alert_code, severity, title, detail) VALUES
            ('TEST_V1179', 'WARN', '시험 알림 1', '{"n": 1}'), ('TEST_V1179', 'WARN', '시험 알림 2', '{"n": 2}'), ('TEST_V1179', 'INFO', '시험 알림 3', NULL)""")
    s1, l1 = call('GET', '/admin/ops-alerts?code=TEST_V1179', TA)
    cd = {c.get('code'): c for c in l1.get('codes', [])}.get('TEST_V1179', {})
    first = (l1.get('items') or [{}])[0]
    sa, ja = call('POST', f"/admin/ops-alerts/{first.get('id')}/ack", TA, {'note': '시험 확인 메모'})
    sb, jb = call('POST', f"/admin/ops-alerts/{first.get('id')}/ack", TA, {})
    _, e1 = psql(f"UPDATE ops_alerts SET acknowledged_at = NULL WHERE id = {first.get('id') or 0}")
    _, e2 = psql("UPDATE ops_alerts SET title = '바꿈' WHERE alert_code = 'TEST_V1179' AND acknowledged_at IS NULL")
    sc_, jc = call('POST', '/admin/ops-alerts/ack-code', TA, {'code': 'TEST_V1179', 'note': '한꺼번에'})
    _, l2 = call('GET', '/admin/ops-alerts?code=TEST_V1179', TA)
    _, l3 = call('GET', '/admin/ops-alerts?state=all&code=TEST_V1179', TA)
    note1 = {x.get('id'): x for x in l3.get('items', [])}.get(first.get('id'), {})
    sm, _ = call('GET', '/admin/ops-alerts', TB)
    ok('② 목록 — 확인 안 한 것 3 · 종류별 open 3 · 가장 최근 먼저 · 자세히(detail)', s1 == 200 and l1.get('total') == 3 and cd.get('open') == 3 and cd.get('openSeverity') == 'WARN'
       and first.get('title') == '시험 알림 3', f"{s1} · {l1.get('total')} · {cd} · {first.get('title')}")
    ok('② 확인 — 200 · 두 번 409 ALERT_ACKED · DB 가 되돌리기 ALERT_ACKED · 내용 바꾸기 ALERT_FIXED 거절',
       sa == 200 and sb == 409 and jb.get('code') == 'ALERT_ACKED' and 'ALERT_ACKED' in e1 and 'ALERT_FIXED' in e2, f'{sa} · {sb} {jb.get("code")} · {e1[:40]} · {e2[:40]}')
    ok('② 한꺼번에 — 남은 2건 확인 · 확인 안 한 것 0 · 전부 보기 3 · 메모 · 확인한 사람 · 회원 403',
       sc_ == 200 and jc.get('acknowledged') == 2 and l2.get('total') == 0 and l3.get('total') == 3 and note1.get('ackNote') == '시험 확인 메모'
       and note1.get('acknowledgedBy') and sm == 403, f"{sc_} {jc.get('acknowledged')} · {l2.get('total')} · {l3.get('total')} · {note1.get('ackNote')} · {sm}")
    psql("DELETE FROM ops_alerts WHERE alert_code = 'TEST_V1179'")

    # ── ③ 개인정보 접속기록 점검 ──────────────────────────────────────────
    prev = psql("SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month', 'YYYY-MM')")[0]
    cur = psql("SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')")[0]
    aid = psql("SELECT id FROM accounts WHERE email = 'admin@x.com'")[0]
    bid = psql("SELECT id FROM accounts WHERE email = 'buyer@x.com'")[0]
    rv_before = psql(f"SELECT count(*) FROM audit.pii_reviews WHERE month = '{prev}-01'")[0]
    if rv_before == '0':
        # 지난달 10일 낮 60건 · 밤(23시) 12건 — 하루 최다 72 ≥ 50 · 밤 12 ≥ 10 → 살펴볼 것
        psql(f"""INSERT INTO audit.pii_access_logs (actor_account_id, target_type, target_account_id, access_type, reason, occurred_at)
                 SELECT '{aid}', 'ACCOUNT', '{bid}', 'VIEW', '시험 v1179', ('{prev}-10 14:00'::timestamp AT TIME ZONE 'Asia/Seoul') + make_interval(secs => g) FROM generate_series(1, 60) g""")
        psql(f"""INSERT INTO audit.pii_access_logs (actor_account_id, target_type, target_account_id, access_type, reason, occurred_at)
                 SELECT '{aid}', 'ACCOUNT', '{bid}', 'EXPORT', '시험 v1179', ('{prev}-10 23:00'::timestamp AT TIME ZONE 'Asia/Seoul') + make_interval(secs => g) FROM generate_series(1, 12) g""")
    n0 = (lambda d: next((a.get('views') for a in d.get('actors', []) if a.get('actorId') == aid), 0))(call('GET', f'/admin/pii-review/{cur}', TA)[1])
    sv, _ = call('GET', f'/admin/accounts/{bid}', TA)
    time.sleep(1.5)   # 감사 기록은 응답 뒤에 남음
    n1 = (lambda d: next((a.get('views') for a in d.get('actors', []) if a.get('actorId') == aid), 0))(call('GET', f'/admin/pii-review/{cur}', TA)[1])
    sm_, months = call('GET', '/admin/pii-review', TA)
    _, dp = call('GET', f'/admin/pii-review/{prev}', TA)
    me = next((a for a in dp.get('actors', []) if a.get('actorId') == aid), {})
    ok('③ 12달 · 지난달 운영자 요약 — 조회 ≥ 72 · 하루 최다 ≥ 72 · 밤 ≥ 12 · 내려받기 ≥ 12 · 살펴볼 것 · 이번 달은 회원 상세 보기로 1 늘어남',
       sm_ == 200 and isinstance(months, list) and len(months) == 12 and months[0].get('month') == cur and months[0].get('closed') is False
       and (rv_before != '0' or (me.get('views', 0) >= 72 and me.get('maxPerDay', 0) >= 72 and me.get('nightViews', 0) >= 12 and me.get('exports', 0) >= 12 and me.get('flagged') is True))
       and sv == 200 and n1 == n0 + 1, f"{len(months) if isinstance(months, list) else months} · {me} · 이번 달 {n0} → {n1}")
    s4, j4 = call('POST', '/admin/pii-review', TA, {'month': cur, 'note': '이번 달은 아직 안 됨'})
    s5, _ = call('POST', '/admin/pii-review', TA, {'month': prev, 'note': '짧'})
    s6, j6 = call('POST', '/admin/pii-review', TA, {'month': prev, 'note': '시험 v1179 — 살펴볼 것 1명 · 시험 자료로 확인'})
    s7, j7 = call('POST', '/admin/pii-review', TA, {'month': prev, 'note': '두 번째 점검 시도입니다'})
    _, e3 = psql(f"UPDATE audit.pii_reviews SET note = '고침' WHERE month = '{prev}-01'")
    _, dp2 = call('GET', f'/admin/pii-review/{prev}', TA)
    so, _ = call('GET', '/admin/pii-review', TO) if TO else (403, {})
    ok('③ 점검 — 이번 달 422 PII_REVIEW_OPEN_MONTH · 짧은 메모 400 · 지난달 완료(이미 했으면 409) · 두 번 409 · DB 고치기 거절 · 점검 기록 · ADMIN 403',
       s4 == 422 and j4.get('code') == 'PII_REVIEW_OPEN_MONTH' and s5 == 400 and (s6 in (200, 201) or (rv_before != '0' and s6 == 409))
       and s7 == 409 and j7.get('code') == 'PII_REVIEW_DONE' and 'append-only' in e3 and (dp2.get('review') or {}).get('note') and so == 403,
       f"{s4} {j4.get('code')} · {s5} · {s6} · {s7} · {e3[:30]} · ADMIN {so}{'' if TO else '(ops 계정 없음)'}")
    sj, jj = call('POST', '/admin/jobs', TA, {'job': 'launch_digest'})
    ok('③ 하루 요약 — 지난달 점검이 있으면 PII_REVIEW_DUE 없음(piiReviewDue null)', sj in (200, 201) and (jj.get('detail') or {}).get('piiReviewDue') is None,
       str(jj.get('detail'))[:120])

    # ── ④ 느린 조회 ──────────────────────────────────────────────────
    def lock():
        psql("BEGIN; LOCK TABLE polls IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(1.2); COMMIT;")
    t = threading.Thread(target=lock); t.start(); time.sleep(0.3)
    call('GET', '/community/polls'); t.join()
    w = call('GET', '/admin/launch-watch', TA)[1]
    ss = w.get('slowSql') or {}
    hit = [x for x in ss.get('top', []) if 'polls' in (x.get('sql') or '')]
    ok('④ 느린 조회 — 표를 잠가 300ms 넘긴 조회가 slowSql 에 · 모양(빈칸 줄임 · 값 없음) · 가장 느림 ≥ 300',
       (ss.get('n') or 0) >= 1 and ss.get('thresholdMs') == 300 and hit and hit[0].get('maxMs', 0) >= 300 and '\n' not in hit[0].get('sql', ''),
       f"n {ss.get('n')} · {[(x.get('maxMs'), x.get('sql', '')[:50]) for x in ss.get('top', [])][:2]}")
else:
    print('  (API · DB 없음 — ②③④ 건너뜀)')

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
