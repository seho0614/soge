"""v10.177 시험 — 회원 투표 만들기(D166) · 보안 정책 「보고만 하기」 수집 · 올린 파일 되살리기 · 백업 신선도(docs/275)

  docker run --rm --network host -v <qa>:/w -v $K:/core:ro -w /w -e KIT=/core -e API=http://localhost:13000/api/v1 \
      -e SITE=http://localhost:15174 -e DB=postgresql://sgb:sgb@localhost:15432/sgb sgb-qa:v1 python3 test_v1177.py

  ① 코드 — D166(설정 3 · source · report_n · 회원 규칙 · 보기 규칙 · 신고 POLL · 지우는 문장 없음 · 204) · API 5개 · 화면 2개 · 신고 화면 poll
     · 영어 사전 · screens.json · 정책 보고 길(main.ts · dev-server.js 둘 다) · 사용자 웹 Report-Only · 지켜보기 칸 · 하루 요약 경고 · 되살리기 스크립트 · postcheck · docs/275 · 판
  ② (API · DB) 꺼짐 → POLL_MEMBER_OFF · 가입 직후 → POLL_MEMBER_NEW · 만들기(바로 열림 · 김OO · 메인 안 나감) · 링크 · 금칙어 · 보기 수 · VS(DB) ·
     24시간 건수 · 준비 상태 · 메인 내기 거절 · 남의 투표 마감 거절 · 표 있으면 지우기 거절 · 마감 · 지우기 ·
     신고 3명 → 감춤 · 운영 투표 신고 거절 · 다시 열기 → 신고 기각 · 알림
  ③ (정책 보고) 옛 형식 · 새 형식 → 204 · 출처만 남김(경로 버림) · 지켜보기 cspDay · 큰 본문 · 깨진 본문 204 · 사용자 웹 /api 로도 · 화면 머리글
  ④ (사용자 웹) 투표 목록 「투표 만들기」 · 회원 투표 표시 · 신고 링크 · 만들기 화면 · 내 투표 화면 · 로그인 전 만들기 → 로그인
  ⑤ (스크립트) 목록 · 보기 · 파일 하나(있으면 거절 · .. 거절 · 없는 파일 거절) · 통째로 따로 풀기 · backup check 「가장 최근」 · 지켜보기 uploadsBackup
"""
import json, os, re, shutil, subprocess, tempfile, time, urllib.error, urllib.request

KIT = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002')
K = KIT + '/sgb'
API = os.environ.get('API'); DB = os.environ.get('DB'); SITE = os.environ.get('SITE')
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
M = rd('prisma/migrations/D166_member_polls/migration.sql')
ok('① D166 — 설정 3(member_create off GLOBAL · daily 3 · age 24) · source · report_n · 회원 규칙 · 보기 규칙 · 신고 POLL · 지우는 문장 없음 · 204 이상',
   "('poll.member_create', 'off', 'GLOBAL'," in M and "('poll.member_daily_limit', '3', 'ADMIN'," in M and "('poll.member_min_age_hours', '24', 'ADMIN'," in M
   and 'ADD COLUMN IF NOT EXISTS source' in M and 'ADD COLUMN IF NOT EXISTS report_n' in M
   and 'CREATE TRIGGER trg_poll_member_guard' in M and 'CREATE TRIGGER trg_poll_option_member_guard' in M
   and "'POST','COMMENT','POLL'" in M and "ELSIF NEW.target_type = 'POLL' THEN" in M and "NEW.target_type IN ('POST','COMMENT','POLL')" in M
   and not re.search(r'\b(DELETE FROM|DROP TABLE|DROP VIEW|DROP FUNCTION|TRUNCATE)\b', M) and len(mig) >= 204 and 'D166_member_polls' in mig, f'{len(mig)} · {mig[-1]}')
PC = rd('src/modules/community/poll.controller.ts'); PS = rd('src/modules/community/poll.service.ts')
ok('① API — ready · 내 투표 · 만들기 · 마감 · 지우기(MEMBER) · 신고 대상 POLL · 영어 사전 · screens.json',
   all(x in PC for x in ("@Get('community/my-polls/ready')", "@Get('community/my-polls')", "@Post('community/my-polls')", "@Post('community/my-polls/:id/close')", "@Delete('community/my-polls/:id')"))
   and PC.count("@Roles('MEMBER')") >= 4 and "source, created_by, ends_at" in PS and 'POLL_UNHIDE_RESOLUTION' in PS
   and "'POST', 'COMMENT', 'POLL']" in rd('src/modules/review/abuse.controller.ts')
   and '"회원 투표에는 링크를 넣을 수 없습니다": "Links are not allowed in member polls"' in rd('src/common/i18n/server-text.en.ts')
   and all(x in rd('spec/screens.json') for x in ('"SB-HOM-CMU-041"', '"SB-HOM-CMU-042"', '"POST /community/my-polls"', '"DELETE /community/my-polls/{id}"')), '')
ok('① 사용자 웹 — 만들기 · 내 투표 화면 · 목록 단추 · 회원 표시 · 신고 화면 poll · 사전(ko · en)',
   os.path.exists(os.path.join(K, 'site/src/app/community/polls/new/page.tsx')) and os.path.exists(os.path.join(K, 'site/src/app/community/polls/mine/page.tsx'))
   and 'data-poll-create' in rd('site/src/app/community/polls/page.tsx') and 'data-poll-report' in rd('site/src/components/community/PollList.tsx')
   and "poll: 'POLL'" in rd('site/src/app/report/[targetType]/[targetId]/page.tsx')
   and all('pollNew' in json.loads(rd(f'site/src/i18n/messages/{l}/plaza.json')) and 'POLL' in json.loads(rd(f'site/src/i18n/messages/{l}/deal.json'))['report']['type'] for l in ('ko', 'en')), '')
SH = rd('src/common/security-headers.ts'); NC = rd('site/next.config.js'); RS = os.path.join(K, 'deploy/aws/uploads-restore.sh')
syn = subprocess.run(['bash', '-n', RS], capture_output=True, text=True).returncode if os.path.exists(RS) else -1
ok('① 정책 보고 · 백업 — 보고 길(보안 머리글 함수 = main.ts · dev-server.js) · Report-Only · 지켜보기 칸 · 하루 요약 경고 · 되살리기(문법 · 실행 권한) · postcheck · docs/275 · 판',
   "app.use('/api/v1/csp-report', ...cspReportRoute)" in SH and 'Content-Security-Policy-Report-Only' in NC and 'report-uri /api/v1/csp-report' in NC
   and "['정책 보고(24시간)', d.cspDay?.n ?? 0" in rd('web/src/app/admin/LaunchWatch.tsx')   # v10.199 — 뒤에 갈 곳(칸 링크) and 'cspDay: cspReportsDay()' in rd('src/modules/admin/launch-watch.service.ts')
   and "'UPLOADS_BACKUP_STALE'" in rd('src/worker/scheduler.service.ts') and syn == 0 and os.access(RS, os.X_OK)
   and '올린 파일 백업 묶음 없음' in rd('deploy/aws/postcheck.sh') and any(f.startswith('275_') for f in os.listdir(os.path.join(K, 'docs')))
   and tuple(int(x) for x in re.findall(r'\d+', rd('VERSION'))) >= (10, 177), f"bash -n {syn} · {rd('VERSION').strip()}")


# ── 공통 ──────────────────────────────────────────────────────────────
def raw(url, hd=None, method='GET', body=None):
    r = urllib.request.Request(url, data=body, headers=hd or {}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, dict(x.headers), x.read(), x.geturl()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), url


def H(h, k):
    return {a.lower(): b for a, b in h.items()}.get(k.lower())


def call(method, path, tok=None, body=None):
    hd = {'content-type': 'application/json'}
    if tok: hd['Authorization'] = 'Bearer ' + tok
    s, _, b, _ = raw(API + path, hd, method, json.dumps(body).encode() if body is not None else None)
    try: return s, json.loads(b or b'{}')
    except Exception: return s, {}


def psql(sql):
    r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-c', sql], capture_output=True, text=True)
    return (r.stdout.strip(), r.stderr.strip())


def login(email):
    return call('POST', '/auth/login', None, {'email': email, 'password': PW})[1].get('accessToken')


def setting(k, v):
    psql(f"UPDATE site_settings SET value = '{v}' WHERE key = '{k}'")


made = []
if API and DB:
    TA, TB, TI, TS, TP = (login(e) for e in ('admin@x.com', 'buyer@x.com', 'intro@x.com', 'seller@x.com', 'person@x.com'))
    # 정책 보고 길의 본문 읽기가 Nest 의 JSON 본문 읽기를 가리면 모든 POST 가 400(v10.177 점검에서 한 번 남) — 로그인으로 확인
    ok('② 본문 읽기 — 로그인 5명 모두 토큰(정책 보고 길이 API 의 JSON 본문 읽기를 가리지 않음)', all((TA, TB, TI, TS, TP)), '')
    psql("DELETE FROM polls p WHERE p.source = 'MEMBER' AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id)")   # 다시 돌릴 때
    psql("UPDATE polls SET state = 'HIDDEN', hidden_reason = '시험 정리(test_v1177)' WHERE source = 'MEMBER' AND state <> 'HIDDEN'")
    psql("UPDATE polls SET created_at = created_at - interval '2 days' WHERE source = 'MEMBER' AND created_at > now() - interval '1 day'")   # 24시간 건수에서 빼기
    old = dict(r.split('|') for r in psql("SELECT key || '|' || value FROM site_settings WHERE key IN ('poll.member_create', 'poll.member_daily_limit', 'poll.member_min_age_hours')")[0].splitlines())
    P = lambda **k: {'kind': 'ASK', 'title': '시험 투표 v1177 — 무엇을 먼저 보나요?', 'options': [{'label': '가격'}, {'label': '후기'}, {'label': '거리'}], 'days': 7, **k}
    try:
        setting('poll.member_create', 'off')
        r0 = call('GET', '/community/my-polls/ready', TB)[1]
        s1, j1 = call('POST', '/community/my-polls', TB, P())
        ok('② 꺼짐 — ready.open false · reason OFF · 만들기 422 POLL_MEMBER_OFF', r0.get('open') is False and r0.get('reason') == 'OFF' and s1 == 422 and j1.get('code') == 'POLL_MEMBER_OFF', f'{r0.get("reason")} · {s1} {j1.get("code")}')
        setting('poll.member_create', 'on'); setting('poll.member_min_age_hours', '9999'); setting('poll.member_daily_limit', '3')
        r1 = call('GET', '/community/my-polls/ready', TB)[1]
        s2, j2 = call('POST', '/community/my-polls', TB, P())
        ok('② 가입 뒤 시간 — ready reason NEW · 만들기 422 POLL_MEMBER_NEW', r1.get('reason') == 'NEW' and s2 == 422 and j2.get('code') == 'POLL_MEMBER_NEW', f'{r1.get("reason")} · {s2} {j2.get("code")}')
        setting('poll.member_min_age_hours', '0')
        s3, j3 = call('POST', '/community/my-polls', TB, P())
        pid = j3.get('id'); made.append(pid)
        pub = call('GET', '/community/polls')[1]
        mine = next((p for p in pub if p.get('id') == pid), {}) if isinstance(pub, list) else {}
        home = call('GET', '/community/polls?scope=home')[1]
        row = psql(f"SELECT state || '|' || source || '|' || show_on_home || '|' || round(extract(epoch FROM ends_at - now()) / 86400) FROM polls WHERE id = '{pid}'")[0] if pid else ''
        ok('② 만들기 — 201 · 바로 열림 · 목록에 「MEMBER · 김OO」 · 메인에 안 나감 · 마감 7일',
           s3 == 201 and j3.get('state') == 'OPEN' and mine.get('source') == 'MEMBER' and re.fullmatch(r'.OO', mine.get('author') or '') and mine.get('open') is True
           and len(mine.get('options') or []) == 3 and pid not in [h.get('id') for h in (home if isinstance(home, list) else [])] and row == 'OPEN|MEMBER|false|7', f'{s3} · {mine.get("author")} · {row}')
        sl, jl = call('POST', '/community/my-polls', TB, P(title='여기 보세요 https://spam.example 투표'))
        psql("INSERT INTO banned_words (word, match_type, severity, is_active) VALUES ('금칙v1177', 'CONTAINS', 'BLOCK', true)")
        sb, jb = call('POST', '/community/my-polls', TB, P(options=[{'label': '좋음'}, {'label': '금칙v1177 보기'}]))
        psql("DELETE FROM banned_words WHERE word = '금칙v1177'")
        so, jo = call('POST', '/community/my-polls', TB, P(kind='USED', options=[{'label': f'보기{i}'} for i in range(6)]))
        sv, _ = call('POST', '/community/my-polls', TB, P(kind='VS', options=[{'label': 'A'}, {'label': 'B'}]))
        _, ev = psql("INSERT INTO polls (kind, title, source, created_by, ends_at) SELECT 'VS', 'DB 직접 VS 시험', 'MEMBER', id, now() + interval '2 days' FROM accounts WHERE email = 'buyer@x.com'")
        n_now = psql("SELECT count(*) FROM polls p JOIN accounts a ON a.id = p.created_by WHERE a.email = 'buyer@x.com' AND p.source = 'MEMBER' AND p.created_at > now() - interval '1 day'")[0]
        ok('② 거절 — 링크 POLL_MEMBER_LINK · 금칙어(보기) BANNED_WORD · 써본 의견 보기 6개 POLL_OPTIONS(되돌림) · VS 400 · DB 직접 VS POLL_MEMBER_KIND · 실패는 건수에 안 셈',
           sl == 422 and jl.get('code') == 'POLL_MEMBER_LINK' and sb == 422 and jb.get('code') == 'BANNED_WORD' and so == 422 and jo.get('code') == 'POLL_OPTIONS'
           and sv == 400 and 'POLL_MEMBER_KIND' in ev and n_now == '1', f'{sl} {jl.get("code")} · {sb} {jb.get("code")} · {so} {jo.get("code")} · {sv} · {ev[:60]} · {n_now}')
        s4, j4 = call('POST', '/community/my-polls', TB, P(title='시험 투표 v1177 — 둘째', kind='USED', options=[{'label': '좋아요'}, {'label': '별로예요'}], days=1))
        s5, j5 = call('POST', '/community/my-polls', TB, P(title='시험 투표 v1177 — 셋째', days=14))
        made += [j4.get('id'), j5.get('id')]
        s6, j6 = call('POST', '/community/my-polls', TB, P(title='시험 투표 v1177 — 넷째'))
        r2 = call('GET', '/community/my-polls/ready', TB)[1]
        ok('② 24시간 건수 — 3건까지 · 넷째 422 POLL_MEMBER_LIMIT · ready reason LIMIT · left 0',
           s4 == 201 and s5 == 201 and s6 == 422 and j6.get('code') == 'POLL_MEMBER_LIMIT' and r2.get('reason') == 'LIMIT' and r2.get('left') == 0, f'{s4} {s5} {s6} {j6.get("code")} · {r2.get("reason")} {r2.get("left")}')
        sh, jh = call('PATCH', f'/admin/community/polls/{pid}', TA, {'showOnHome': True})
        sc, jc = call('POST', f'/community/my-polls/{pid}/close', TI)
        my = call('GET', '/community/my-polls', TB)[1]
        ok('② 메인 내기 422 POLL_MEMBER_HOME · 남의 투표 마감 409 POLL_NOT_OPEN · 내 투표에 3건',
           sh == 422 and jh.get('code') == 'POLL_MEMBER_HOME' and sc == 409 and jc.get('code') == 'POLL_NOT_OPEN' and isinstance(my, list) and {pid, j4.get('id'), j5.get('id')} <= {m.get('id') for m in my}, f'{sh} {jh.get("code")} · {sc} · {len(my) if isinstance(my, list) else my}')
        opt = (mine.get('options') or [{}])[0].get('id')
        svt, _ = call('POST', f'/community/polls/{pid}/vote', TI, {'optionId': opt})
        sd1, jd1 = call('DELETE', f'/community/my-polls/{pid}', TB)
        scl, jcl = call('POST', f'/community/my-polls/{pid}/close', TB)
        sd2, _ = call('DELETE', f'/community/my-polls/{j4.get("id")}', TB)
        gone = psql(f"SELECT count(*) FROM polls WHERE id = '{j4.get('id')}'")[0]
        ok('② 표가 있으면 지우기 422 POLL_HAS_VOTES · 마감 200 · 표 없는 투표 지우기 200(없어짐)',
           svt == 201 and sd1 == 422 and jd1.get('code') == 'POLL_HAS_VOTES' and scl == 200 and jcl.get('state') == 'CLOSED' and sd2 == 200 and gone == '0', f'{svt} · {sd1} · {scl} · {sd2} · {gone}')
        made.remove(j4.get('id'))
        # 신고 3명 → 감춤(셋째 투표)
        p5 = j5.get('id'); rc = psql("SELECT code FROM report_reasons WHERE gwan_code IS NULL ORDER BY sort_order LIMIT 1")[0]
        _, eself = psql(f"INSERT INTO reports (target_type, target_id, reason_code, reporter_id, state) SELECT 'POLL', '{p5}', '{rc}', id, 'OPEN' FROM accounts WHERE email = 'buyer@x.com'")
        for e in ('intro@x.com', 'seller@x.com', 'person@x.com'):
            psql(f"INSERT INTO reports (target_type, target_id, reason_code, reporter_id, state) SELECT 'POLL', '{p5}', '{rc}', id, 'OPEN' FROM accounts WHERE email = '{e}'")
        st5 = psql(f"SELECT state || '|' || report_n || '|' || coalesce(hidden_reason, '') FROM polls WHERE id = '{p5}'")[0]
        pub2 = call('GET', '/community/polls')[1]
        my2 = {p.get('id'): p for p in call('GET', '/community/my-polls', TB)[1]}
        adm = {p.get('id'): p for p in call('GET', '/admin/community/polls', TA)[1].get('items', [])}
        aid = psql("SELECT id FROM polls WHERE source = 'ADMIN' ORDER BY created_at LIMIT 1")[0]
        _, eadm = psql(f"INSERT INTO reports (target_type, target_id, reason_code, reporter_id, state) SELECT 'POLL', '{aid}', '{rc}', id, 'OPEN' FROM accounts WHERE email = 'intro@x.com'") if aid else ('', 'REPORT')
        ok('② 신고 — 자기 투표 거절 · 서로 다른 3명 → HIDDEN(신고 3건 사유) · 목록에서 빠짐 · 내 투표 reportHidden · 운영 reportCount 3 · 운영 투표 신고 거절',
           'REPORT' in eself and st5 == 'HIDDEN|3|신고 3건 — 운영 확인 대기' and p5 not in [p.get('id') for p in pub2] and my2.get(p5, {}).get('reportHidden') is True
           and adm.get(p5, {}).get('reportCount') == 3 and adm.get(p5, {}).get('source') == 'MEMBER' and adm.get(p5, {}).get('authorName') and 'REPORT' in eadm,
           f'{eself[:30]} · {st5} · {adm.get(p5, {}).get("reportCount")} · {eadm[:30]}')
        su, ju = call('PATCH', f'/admin/community/polls/{p5}', TA, {'state': 'OPEN'})
        after = psql(f"SELECT state || '|' || report_n FROM polls WHERE id = '{p5}'")[0]
        dis = psql(f"SELECT count(*) FROM reports WHERE target_type = 'POLL' AND target_id = '{p5}' AND state = 'DISMISSED'")[0]
        nt = psql("SELECT count(*) FROM notifications WHERE event_code = 'REPORT_RESOLVED' AND body LIKE '%규칙에 어긋나지 않는 투표%' AND created_at > now() - interval '5 minutes'")[0]
        ok('② 다시 열기 — OPEN · 신고 수 0 · 처리 전 신고 3건 기각 · 신고한 3명에게 알림', su == 200 and ju.get('dismissed') == 3 and after == 'OPEN|0' and dis == '3' and int(nt or 0) >= 3, f'{su} · {ju.get("dismissed")} · {after} · {dis} · 알림 {nt}')
    finally:
        for k, v in old.items(): setting(k, v)
else:
    print('  (API · DB 없음 — ② 건너뜀)')


# ── ③ 정책 보고 ────────────────────────────────────────────────────────
if API and DB:
    T_ = login('admin@x.com')
    lw = lambda: call('GET', '/admin/launch-watch', T_)[1]
    c0 = (lw().get('cspDay') or {}).get('n', -1)
    old = json.dumps({'csp-report': {'document-uri': 'https://sogaebank.com/community?q=secret', 'violated-directive': 'script-src-elem',
                                     'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x/y.js?token=abc'}}).encode()
    s1, _, b1, _ = raw(API + '/csp-report', {'content-type': 'application/csp-report'}, 'POST', old)
    new = json.dumps([{'type': 'csp-violation', 'body': {'documentURL': 'https://sogaebank.com/mall', 'effectiveDirective': 'connect-src', 'blockedURL': 'https://api.other.example/v1'}}]).encode()
    s2, _, _, _ = raw(API + '/csp-report', {'content-type': 'application/reports+json'}, 'POST', new)
    s3, _, _, _ = raw(API + '/csp-report', {'content-type': 'application/csp-report'}, 'POST', b'{not json')
    s4, _, _, _ = raw(API + '/csp-report', {'content-type': 'application/csp-report'}, 'POST', json.dumps({'csp-report': {'blocked-uri': 'https://big.example/' + 'a' * 20000}}).encode())
    d = lw().get('cspDay') or {}
    top = {(t.get('directive'), t.get('blocked')): t for t in d.get('top', [])}
    ev = top.get(('script-src-elem', 'https://evil.example'), {})
    ok('③ 정책 보고 — 옛 형식 · 새 형식 204 · 깨진 본문 · 16KB 넘는 본문도 204(안 셈) · 출처만(경로 · 물음표 버림) · 화면 경로만 · 지켜보기 cspDay 2 늘어남',
       s1 == 204 and b1 == b'' and s2 == 204 and s3 == 204 and s4 == 204 and d.get('n') == c0 + 2 and ev.get('page') == '/community'
       and ('connect-src', 'https://api.other.example') in top and not any('big.example' in (t.get('blocked') or '') for t in d.get('top', []))
       and 'token' not in json.dumps(d) and 'secret' not in json.dumps(d), f'{s1} {s2} {s3} {s4} · {c0} → {d.get("n")} · {ev}')
    if SITE:
        s5, _, _, _ = raw(SITE + '/api/v1/csp-report', {'content-type': 'application/csp-report'}, 'POST', old)
        st, hd, _, _ = raw(SITE + '/community')
        ro = H(hd, 'Content-Security-Policy-Report-Only') or ''
        ok('③ 사용자 웹 — /api/v1/csp-report 로도 204 · 화면 머리글 Report-Only(script-src · connect-src · report-uri) · 막는 CSP 는 frame-ancestors 그대로',
           s5 == 204 and (lw().get('cspDay') or {}).get('n') == c0 + 3 and "script-src 'self'" in ro and "connect-src 'self'" in ro and 'report-uri /api/v1/csp-report' in ro
           and H(hd, 'Content-Security-Policy') == "frame-ancestors 'self'", f'{s5} · {ro[:60]}')


# ── ④ 사용자 웹 화면 ───────────────────────────────────────────────────
if API and DB and SITE:
    TB = login('buyer@x.com')
    setting('poll.member_create', 'on')
    try:
        _, _, h1, _ = raw(SITE + '/community/polls')
        _, _, h2, _ = raw(SITE + '/community/polls/new', {'Cookie': f'sgb_at={TB}'})
        _, _, h3, _ = raw(SITE + '/community/polls/mine', {'Cookie': f'sgb_at={TB}'})
        _, _, _, u4 = raw(SITE + '/community/polls/new')
        h1, h2, h3 = (x.decode('utf-8', 'replace') for x in (h1, h2, h3))
        ok('④ 화면 — 목록에 「투표 만들기」 · 회원 투표 표시 · 신고 링크 · 만들기 화면(폼 또는 까닭) · 내 투표 화면 · 로그인 전 만들기 → 로그인',
           'data-poll-create' in h1 and 'data-poll-member' in h1 and '/report/poll/' in h1 and 'SB-HOM-CMU-041' in h2 and ('data-poll-form' in h2 or 'data-poll-ready' in h2)
           and 'SB-HOM-CMU-042' in h3 and 'data-my-poll' in h3 and '/login' in u4, u4)
        setting('poll.member_create', 'off')
        _, _, h5, _ = raw(SITE + '/community/polls')
        ok('④ 꺼지면 목록에 「투표 만들기」 없음', 'data-poll-create' not in h5.decode('utf-8', 'replace'), '')
    finally:
        setting('poll.member_create', 'off')
    if made:   # 시험 투표는 감춤(표는 지울 수 없어 행을 남김) — 다른 시험의 목록에 섞이지 않게
        psql("UPDATE polls SET state = 'HIDDEN', hidden_reason = '시험 정리(test_v1177)' WHERE source = 'MEMBER' AND state <> 'HIDDEN'")


# ── ⑤ 되살리기 스크립트 ────────────────────────────────────────────────
BS = os.path.join(K, 'deploy/aws/uploads-backup.sh')


def run(script, env, *args):
    r = subprocess.run(['bash', script, *args], capture_output=True, text=True, env={**os.environ, **env})
    return r.returncode, r.stdout


if os.path.exists(RS):
    td = tempfile.mkdtemp()
    try:
        app, data = os.path.join(td, 'app'), os.path.join(td, 'data')
        up = os.path.join(data, 'uploads'); os.makedirs(os.path.join(up, '2026', '11')); os.makedirs(app)
        open(os.path.join(app, '.env'), 'w').write(f'UPLOAD_DIR={up}\n')
        open(os.path.join(up, '2026', '11', 'a.jpg'), 'w').write('A'); open(os.path.join(up, 'b.png'), 'w').write('B')
        env = {'APP_LINK': app, 'DATA_DIR': data}
        rb, _ = run(BS, env)
        r1, o1 = run(RS, env); r2, o2 = run(RS, env, 'show', 'latest')
        r3, o3 = run(RS, env, 'file', 'latest', '2026/11/a.jpg')
        os.remove(os.path.join(up, '2026', '11', 'a.jpg'))
        r4, o4 = run(RS, env, 'file', 'latest', 'uploads/2026/11/a.jpg')
        back = open(os.path.join(up, '2026', '11', 'a.jpg')).read() if os.path.exists(os.path.join(up, '2026', '11', 'a.jpg')) else ''
        r5, _ = run(RS, env, 'file', 'latest', '../etc/passwd'); r6, _ = run(RS, env, 'file', 'latest', 'nope.jpg'); r7, _ = run(RS, env, 'show', '19990101')
        r8, o8 = run(RS, env, 'extract', 'latest')
        ex = [os.path.relpath(os.path.join(a, f), os.path.join(data, 'restore')) for a, _, fs in os.walk(os.path.join(data, 'restore')) for f in fs]
        rc, oc = run(BS, env, 'check')
        ok('⑤ 되살리기 — 목록 · 보기(2개) · 있는 파일 거절(1) · 없어진 파일 되살림 · .. 거절 · 묶음에 없는 파일 거절 · 없는 묶음 거절 · 통째로 따로 풀기(원본 그대로) · check 「가장 최근」',
           rb == 0 and r1 == 0 and 'uploads_' in o1 and r2 == 0 and '파일 2개' in o2 and r3 == 1 and '덮어쓰지 않습니다' in o3 and r4 == 0 and back == 'A'
           and r5 == 1 and r6 == 1 and r7 == 1 and r8 == 0 and len(ex) == 2 and all('/uploads/' in x for x in ex) and len(os.listdir(up)) == 2
           and rc == 0 and '가장 최근: uploads_' in oc, f'{rb} {r1} {r2} {r3} {r4} {r5} {r6} {r7} {r8} · {ex}')
    finally:
        shutil.rmtree(td, ignore_errors=True)
if API and DB:
    ub = call('GET', '/admin/launch-watch', login('admin@x.com'))[1].get('uploadsBackup') or {}
    ok('⑤ 지켜보기 uploadsBackup — 칸 있음(점검판엔 묶음 없음 → count 0 · stale false)', 'count' in ub and ub.get('stale') is False, json.dumps(ub, ensure_ascii=False))

passed = sum(1 for r in RES if r[0])
print(f'\n결과: {passed} / {len(RES)}')
raise SystemExit(0 if passed == len(RES) else 1)
