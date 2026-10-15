"""10/2 v10.14 — 소개광장 「이건 어때?」 투표 · 사회관계망 주소 (D021) API · DB 검증.  결과: srv_poll.json

  A. 공개 조회   GET /community/polls(?scope=home) · /community/polls/{id} — 종류마다 1건 · 준비 중 · 감춘 것은 안 나감 · 참여 수 = 실제 표 수
  B. 운영       GET · POST /admin/community/polls · PATCH /admin/community/polls/{id} — 권한 · 보기 수 규칙 · 열기 · 마감 시각 · 감사 기록
  C. 투표       POST /community/polls/{id}/vote — 비로그인(방문자 키) · 회원 · 1인 1표 · 남의 보기 · 자동 프로그램 · 마감
               같은 인터넷 주소 하루 한도(poll.guest_ip_daily_limit) · 비로그인 끄기(poll.guest_vote)
  D. DB 규칙    표가 들어온 뒤 보기 · 종류 잠금(POLL_LOCKED) · 넣은 표는 고치거나 못 지움(POLL_VOTE_FIXED) · 감추기 사유 · 주소 원문 미저장
  E. 메인 노출   v_poll_home — 종류마다 순서가 가장 앞선 열린 투표 1건
  F. 사회관계망  설정 sns.* — https:// 주소만 · 공개 설정으로 나감
  G. 시드       (v10.15) scripts/seed-polls.sql — 빈 DB · v10.14 예시 문구 투표가 남은 DB(표 없음/있음) · 운영이 만든 투표만 있는 DB
               검정 전용 DB(sgb_check)에서 되돌리기(ROLLBACK)로 봅니다 — 아무것도 남기지 않습니다. 그 DB 가 없으면 건너뜁니다.

★ 공용 설정(poll.guest_vote · poll.guest_ip_daily_limit · sns.instagram)을 잠깐 바꿉니다 — 끝에 처음 값으로 되돌립니다.
★ 표는 지울 수 없어(규칙) 시험 투표는 끝에 「감춤」으로 돌려 둡니다. 여러 번 돌려도 됩니다.
사용: API=http://localhost:3000 python3 srv_poll.py
"""
import json, urllib.request, urllib.error, subprocess, uuid, sys, os

API = (os.environ.get('API') or 'http://localhost:3000').rstrip('/').removesuffix('/api/v1')
DB = os.environ.get('DB') or 'postgresql://sgb:sgb@localhost:5432/sgb'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
R = []

def psql(s):
    return subprocess.run(['psql', DB, '-v', 'ON_ERROR_STOP=1', '-tAc', s], capture_output=True, text=True)
q = lambda s: psql(s).stdout.strip().split('\n')[0]

def call(m, p, tok=None, body=None, vk=None, ua=UA, ip=None):
    h = {'content-type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex, 'user-agent': ua}
    if tok: h['authorization'] = 'Bearer ' + tok
    if vk: h['x-visitor-key'] = vk
    if ip: h['x-forwarded-for'] = ip
    req = urllib.request.Request(API + '/api/v1' + p, method=m,
        data=json.dumps(body).encode() if body is not None else (b'{}' if m in ('POST', 'PATCH') else None), headers=h)
    try: r = urllib.request.urlopen(req, timeout=30); st = r.status; raw = r.read()
    except urllib.error.HTTPError as e: st = e.code; raw = e.read()
    try: js = json.loads(raw) if raw else None
    except Exception: js = None
    return st, js

def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:240]})
    print('ok  ' if ok else 'FAIL', step, str(detail)[:160], file=sys.stderr)

def login(e, pw='sgb-dev-1234'):
    return call('POST', '/auth/login', body={'email': e, 'password': pw})[1]['accessToken']
code = lambda j: (j or {}).get('code')

ADM = login('admin@x.com'); BUY = login('buyer@x.com'); SEL = login('intro@x.com')
tag = uuid.uuid4().hex[:6]
vkey = lambda n: f'qa-{tag}-{n:04d}'
IP1 = f'203.0.113.{int(tag[:2], 16) % 200 + 20}'; IP2 = f'198.51.100.{int(tag[2:4], 16) % 200 + 20}'
made = []
SET0 = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in ('poll.guest_vote', 'poll.guest_ip_daily_limit', 'sns.instagram')}
setting = lambda k, v, tok=None: call('PATCH', '/admin/site-settings', tok or ADM, {'key': k, 'value': v})

def mk(kind, title, opts, **kw):
    st, j = call('POST', '/admin/community/polls', ADM, {'kind': kind, 'title': title, 'options': [{'label': o} for o in opts], **kw})
    if st < 300 and j and j.get('id'): made.append(j['id'])
    return st, j
patch = lambda pid, body: call('PATCH', f'/admin/community/polls/{pid}', ADM, body)
def opt_ids(pid):
    return [x for x in psql(f"select id from poll_options where poll_id='{pid}' order by sort").stdout.split()]

try:
    # ── A. 공개 조회 ──
    st, home = call('GET', '/community/polls?scope=home')
    kinds = [p['kind'] for p in (home or [])]
    rec('A-1 메인에 낼 투표 — 종류마다 1건, 비교해요 · 궁금해요 · 써본 의견 순', st == 200 and kinds == ['VS', 'ASK', 'USED'], (st, kinds))
    real = all(p['total'] == sum(o['votes'] for o in p['options']) == int(q(f"select count(*) from poll_votes where poll_id='{p['id']}'")) for p in home or [])
    rec('A-2 참여 수 = 보기별 표의 합 = DB 의 실제 표 수 (꾸며 넣은 숫자 없음)', real, [(p['kind'], p['total']) for p in home or []])
    rec('A-3 열린 투표 · 방문자 키 없이 보면 「내가 고른 보기」 없음', all(p['open'] and p['myOptionId'] is None and len(p['options']) >= 2 for p in home or []))
    st, allp = call('GET', '/community/polls')
    states = {p['state'] for p in (allp or [])}
    rec('A-4 전체 목록 — 열린 것 · 마감된 것만(준비 중 · 감춘 것은 없음) · 열린 것이 먼저', st == 200 and states <= {'OPEN', 'CLOSED'} and len(allp) >= 3
        and [p['open'] for p in allp] == sorted([p['open'] for p in allp], reverse=True), (st, states, len(allp or [])))
    st, one = call('GET', f"/community/polls/{home[0]['id']}")
    rec('A-5 1건 조회 200 · 없는 투표 404', st == 200 and one['id'] == home[0]['id'] and call('GET', f'/community/polls/{uuid.uuid4()}')[0] == 404)

    # ── B. 운영 ──
    noauth = lambda r: r[0] in (401, 403) and code(r[1]) == 'UNAUTHENTICATED'      # 이 서버는 토큰이 없으면 「로그인이 필요합니다」(UNAUTHENTICATED)로 막습니다
    denied = lambda r: r[0] == 403 and code(r[1]) == 'FORBIDDEN'
    rec('B-1 운영 목록 — 토큰 없음 「로그인 필요」 · 일반 회원 403 · 운영 200', noauth(call('GET', '/admin/community/polls')) and denied(call('GET', '/admin/community/polls', BUY))
        and call('GET', '/admin/community/polls', ADM)[0] == 200)
    n0 = q("select count(*) from polls")
    rec('B-2 만들기 · 바꾸기 — 토큰 없음 「로그인 필요」 · 일반 회원 403 · 아무것도 안 생김', noauth(call('POST', '/admin/community/polls', None, {'kind': 'VS', 'title': '권한 시험입니다', 'options': [{'label': 'a'}, {'label': 'b'}]}))
        and denied(call('POST', '/admin/community/polls', SEL, {'kind': 'VS', 'title': '권한 시험입니다', 'options': [{'label': 'a'}, {'label': 'b'}]}))
        and denied(call('PATCH', f"/admin/community/polls/{home[0]['id']}", BUY, {'state': 'CLOSED'})) and q("select count(*) from polls") == n0
        and q(f"select state from polls where id='{home[0]['id']}'") == 'OPEN')
    st, j = mk('VS', 'abc', ['가', '나'])
    rec('B-3 제목 3자 → 400', st == 400, (st, code(j)))
    st, j = mk('ASK', f'시험 {tag} 보기 1개', ['가'])
    rec('B-4 보기 1개 → 400', st == 400, (st, code(j)))
    st, j = mk('WHAT', f'시험 {tag} 없는 종류', ['가', '나'])
    rec('B-5 없는 종류 → 400', st == 400, (st, code(j)))
    st, j = mk('ASK', f'시험 {tag} 그림 주소', ['가', '나'], image='javascript:alert(1)')
    rec('B-6 그림 주소가 /경로 · https 가 아님 → 400', st == 400, (st, code(j)))
    st, j = mk('VS', f'시험 {tag} 비교해요 보기 3개', ['가', '나', '다'])
    v3 = (j or {}).get('id')
    rec('B-7 만들면 「준비 중」(DRAFT) — 아직 보이지 않음', st == 201 and j['state'] == 'DRAFT' and call('GET', f'/community/polls/{v3}')[0] == 404
        and v3 not in [p['id'] for p in call('GET', '/community/polls')[1]], (st, j))
    st, j = patch(v3, {'state': 'OPEN'})
    rec('B-8 「비교해요」 보기 3개로 열기 → 422 POLL_OPTIONS (정확히 2개)', st == 422 and code(j) == 'POLL_OPTIONS' and q(f"select state from polls where id='{v3}'") == 'DRAFT', (st, j))
    st, j = patch(v3, {'options': [{'label': '가', 'sub': '가볍다'}, {'label': '나', 'sub': '오래 간다'}], 'state': 'OPEN', 'endsAt': '2020-01-01T00:00:00+09:00'})
    rec('B-9 마감 시각이 지난 채로 열기 → 422 POLL_ENDS_AT · 보기 교체도 함께 되돌아감', st == 422 and code(j) == 'POLL_ENDS_AT' and q(f"select count(*) from poll_options where poll_id='{v3}'") == '3', (st, j))
    st, j = patch(v3, {'options': [{'label': '가', 'sub': '가볍다'}, {'label': '나', 'sub': '오래 간다'}], 'state': 'OPEN', 'endsAt': ''})
    rec('B-10 보기 2개로 바꾸고 열기 → 열림 · 공개 목록에 나옴 · 0표', st == 200 and j['state'] == 'OPEN' and call('GET', f'/community/polls/{v3}')[1]['total'] == 0
        and q(f"select (opened_at is not null)::text from polls where id='{v3}'") == 'true', (st, j))
    rec('B-11 감사 기록 — 만들기 · 바꾸기가 남음', int(q(f"select count(*) from audit.audit_logs where action='POLL_CREATE' and occurred_at > now() - interval '5 minutes'")) >= 1
        and int(q(f"select count(*) from audit.audit_logs where action='POLL_UPDATE' and occurred_at > now() - interval '5 minutes'")) >= 1)

    # ── C. 투표 ──
    o = opt_ids(v3)
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': o[0]})
    rec('C-1 비로그인 · 방문자 키 없음 → 400 (사용자 웹이 쿠키로 붙입니다)', st == 400 and code(j) == 'VALIDATION_ERROR', (st, j))
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': o[0]}, vk=vkey(1), ua='curl/8.4.0')
    rec('C-2 자동 프로그램(curl) → 422 POLL_BOT · 표 0', st == 422 and code(j) == 'POLL_BOT' and q(f"select count(*) from poll_votes where poll_id='{v3}'") == '0', (st, j))
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': 'not-a-uuid'}, vk=vkey(1))
    rec('C-3 보기 값이 형식에 안 맞음 → 400', st == 400, (st, code(j)))
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': o[0]}, vk=vkey(1), ip=IP1)
    rec('C-4 비로그인 투표 → 201 · 1명 참여 · 내가 고른 보기', st == 201 and j['poll']['total'] == 1 and j['poll']['myOptionId'] == o[0]
        and [x['votes'] for x in j['poll']['options']] == [1, 0], (st, j and j.get('note')))
    row = q(f"select (account_id is null)::text||'|'||visitor_key||'|'||length(ip_hash)||'|'||(vote_day = (now() at time zone 'Asia/Seoul')::date)::text from poll_votes where poll_id='{v3}'")
    rec('C-5 DB — 계정 없음 · 방문자 키 · 주소는 64자 해시 · 투표일', row == f'true|{vkey(1)}|64|true', row)
    cols = q("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_name='poll_votes'")
    raw = q(f"select count(*) from poll_votes where poll_id='{v3}' and (ip_hash like '%{IP1}%' or visitor_key like '%{IP1}%')")
    rec('C-6 주소(IP) 원문은 저장하지 않음 — 칸이 없고 값에도 없음', 'ip_hash' in cols and not any(c in cols.split(',') for c in ('ip', 'ip_address', 'remote_addr')) and raw == '0', cols)
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': o[1]}, vk=vkey(1), ip=IP1)
    rec('C-7 같은 방문자가 또 → 409 POLL_VOTED · 표는 그대로 1', st == 409 and code(j) == 'POLL_VOTED' and q(f"select count(*) from poll_votes where poll_id='{v3}'") == '1', (st, j))
    st, j = call('GET', f'/community/polls/{v3}', vk=vkey(1))
    rec('C-8 다시 열어도 「내가 고른 보기」가 남음 · 다른 방문자에게는 없음', j['myOptionId'] == o[0] and call('GET', f'/community/polls/{v3}', vk=vkey(2))[1]['myOptionId'] is None)
    other = opt_ids(home[1]['id'])[0]
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': other}, vk=vkey(2), ip=IP1)
    rec('C-9 다른 투표의 보기로 → 422 POLL_OPTION', st == 422 and code(j) == 'POLL_OPTION', (st, j))
    st, j = call('POST', f'/community/polls/{v3}/vote', BUY, {'optionId': o[1]}, vk=vkey(1), ip=IP1)
    rec('C-10 회원 투표 → 201 · 2명 참여 (같은 기기의 비로그인 표와 따로 셈)', st == 201 and j['poll']['total'] == 2 and j['poll']['myOptionId'] == o[1]
        and q(f"select (ip_hash is null)::text from poll_votes where poll_id='{v3}' and account_id is not null") == 'true', (st, j and j['poll']['total']))
    st, j = call('POST', f'/community/polls/{v3}/vote', BUY, {'optionId': o[0]}, vk=vkey(9))
    rec('C-11 같은 회원이 또(방문자 키를 바꿔도) → 409 POLL_VOTED', st == 409 and code(j) == 'POLL_VOTED', (st, j))
    rec('C-12 회원으로 조회하면 계정의 표가 「내가 고른 보기」', call('GET', f'/community/polls/{v3}', BUY)[1]['myOptionId'] == o[1])

    # 하루 한도 — 같은 주소에서 방문자 키만 바꿔 넣기
    st, j = mk('ASK', f'시험 {tag} 하루 한도', ['가', '나', '다']); lim = j['id']; patch(lim, {'state': 'OPEN'}); lo = opt_ids(lim)
    rec('C-13 한도 설정 — 0 · 글자는 거절, 2 는 저장', setting('poll.guest_ip_daily_limit', '0')[0] >= 400 and setting('poll.guest_ip_daily_limit', 'abc')[0] >= 400
        and setting('poll.guest_ip_daily_limit', '2')[0] == 200 and call('GET', '/admin/community/polls', ADM)[1]['guestIpDailyLimit'] == 2)
    a = [call('POST', f'/community/polls/{lim}/vote', None, {'optionId': lo[i % 3]}, vk=vkey(10 + i), ip=IP1) for i in range(3)]
    rec('C-14 같은 주소 · 방문자 키만 바꿔 3번 → 2번까지 201, 3번째 422 POLL_IP_LIMIT', [x[0] for x in a] == [201, 201, 422] and code(a[2][1]) == 'POLL_IP_LIMIT'
        and q(f"select count(*) from poll_votes where poll_id='{lim}'") == '2', [(x[0], code(x[1])) for x in a])
    st, j = call('POST', f'/community/polls/{lim}/vote', None, {'optionId': lo[0]}, vk=vkey(20), ip=IP2)
    rec('C-15 다른 주소는 들어감', st == 201 and j['poll']['total'] == 3, (st, code(j)))
    st, j = call('POST', f'/community/polls/{lim}/vote', SEL, {'optionId': lo[0]}, vk=vkey(21), ip=IP1)
    rec('C-16 한도에 걸린 주소라도 회원은 들어감(한도는 비로그인만)', st == 201 and j['poll']['total'] == 4, (st, code(j)))

    # 비로그인 끄기
    rec('C-17 비로그인 투표 설정 — 엉뚱한 값은 거절, off 는 저장', setting('poll.guest_vote', 'maybe')[0] >= 400 and setting('poll.guest_vote', 'off')[0] == 200
        and call('GET', '/admin/community/polls', ADM)[1]['guestVote'] is False)
    st, j = call('POST', f'/community/polls/{lim}/vote', None, {'optionId': lo[0]}, vk=vkey(30), ip=IP2)
    rec('C-18 끈 뒤 비로그인 투표 → 401 POLL_LOGIN · 표는 그대로', st == 401 and code(j) == 'POLL_LOGIN' and q(f"select count(*) from poll_votes where poll_id='{lim}'") == '4', (st, j))
    r = psql(f"insert into poll_votes (poll_id, option_id, visitor_key) values ('{lim}', '{lo[0]}', '{vkey(31)}')")
    rec('C-19 DB 에 직접 넣어도 막힘(POLL_LOGIN) — 화면 · 서버를 거치지 않아도', r.returncode != 0 and 'POLL_LOGIN' in r.stderr, r.stderr.strip()[:120])
    st, j = call('POST', f'/community/polls/{lim}/vote', BUY, {'optionId': lo[1]})
    rec('C-20 끈 뒤에도 회원은 투표됨', st == 201 and j['poll']['total'] == 5, (st, code(j)))
    rec('C-21 끈 뒤에도 보기(조회)는 로그인 없이 됨', call('GET', f'/community/polls/{lim}')[0] == 200 and call('GET', '/community/polls?scope=home')[0] == 200)
    setting('poll.guest_vote', 'on')
    st, j = call('POST', f'/community/polls/{lim}/vote', None, {'optionId': lo[0]}, vk=vkey(30), ip=IP2)
    rec('C-22 다시 켜면 비로그인 투표가 들어감', st == 201 and j['poll']['total'] == 6, (st, code(j)))

    # 마감
    st, j = patch(lim, {'state': 'CLOSED'})
    rec('C-23 마감 → 닫은 때가 남음', st == 200 and j['state'] == 'CLOSED' and q(f"select (closed_at is not null)::text from polls where id='{lim}'") == 'true')
    st, j = call('POST', f'/community/polls/{lim}/vote', None, {'optionId': lo[0]}, vk=vkey(40), ip=IP2)
    rec('C-24 마감 뒤 투표 → 422 POLL_CLOSED', st == 422 and code(j) == 'POLL_CLOSED', (st, j))
    st, j = call('GET', f'/community/polls/{lim}')
    rec('C-25 마감 뒤에도 결과는 보임(6표) · 목록에 「마감」으로', st == 200 and j['open'] is False and j['total'] == 6
        and any(p['id'] == lim and not p['open'] for p in call('GET', '/community/polls')[1]))
    st, j = mk('USED', f'시험 {tag} 마감 시각', ['가', '나'], endsAt='2099-12-31T23:59:59+09:00'); soon = j['id']; patch(soon, {'state': 'OPEN'})
    psql(f"set session_replication_role = replica; update polls set ends_at = now() - interval '1 minute' where id='{soon}'")
    st, j = call('POST', f'/community/polls/{soon}/vote', None, {'optionId': opt_ids(soon)[0]}, vk=vkey(41), ip=IP2)
    rec('C-26 마감 시각이 지난 열린 투표 → 422 POLL_CLOSED (운영이 닫지 않아도)', st == 422 and code(j) == 'POLL_CLOSED' and call('GET', f'/community/polls/{soon}')[1]['open'] is False, (st, j))

    # ── D. DB 규칙 ──
    st, j = patch(v3, {'options': [{'label': '가'}, {'label': '바꾼 보기'}]})
    rec('D-1 표가 들어온 투표의 보기 바꾸기 → 422 POLL_LOCKED · 보기 그대로', st == 422 and code(j) == 'POLL_LOCKED' and opt_ids(v3) == o, (st, j))
    st, j = patch(v3, {'state': 'DRAFT'})
    rec('D-2 표가 들어온 투표를 준비 중으로 → 422 POLL_LOCKED', st == 422 and code(j) == 'POLL_LOCKED', (st, j))
    r = psql(f"update polls set kind='ASK' where id='{v3}'")
    rec('D-3 표가 들어온 투표의 종류 바꾸기(DB 직접) → POLL_LOCKED', r.returncode != 0 and 'POLL_LOCKED' in r.stderr, r.stderr.strip()[:100])
    r1 = psql(f"update poll_votes set option_id='{o[1]}' where poll_id='{v3}' and account_id is null")
    r2 = psql(f"delete from poll_votes where poll_id='{v3}'")
    rec('D-4 넣은 표 고치기 · 지우기(DB 직접) → POLL_VOTE_FIXED · 표 2 그대로', r1.returncode != 0 and 'POLL_VOTE_FIXED' in r1.stderr and r2.returncode != 0 and 'POLL_VOTE_FIXED' in r2.stderr
        and q(f"select count(*) from poll_votes where poll_id='{v3}'") == '2', r1.stderr.strip()[:80])
    idx = q("select string_agg(indexname, ',' order by indexname) from pg_indexes where tablename='poll_votes' and indexdef like '%UNIQUE%'")
    rec('D-5 한 사람 한 표를 DB 가 보장 — 고유 색인 2개(계정 · 방문자)', 'ux_poll_votes_account' in idx and 'ux_poll_votes_visitor' in idx, idx)
    r = psql(f"insert into poll_options (poll_id, sort, label) values ('{v3}', 3, '몰래 추가')")
    rec('D-6 표가 들어온 투표에 보기 추가(DB 직접) → POLL_LOCKED', r.returncode != 0 and 'POLL_LOCKED' in r.stderr, r.stderr.strip()[:100])
    st, j = patch(v3, {'state': 'HIDDEN'})
    rec('D-7 사유 없이 감추기 → 422 POLL_HIDE_REASON', st == 422 and code(j) == 'POLL_HIDE_REASON', (st, j))
    st, j = patch(v3, {'state': 'HIDDEN', 'hiddenReason': '짧'})
    rec('D-8 사유 1자 → 400', st == 400, (st, code(j)))
    st, j = patch(v3, {'state': 'HIDDEN', 'hiddenReason': '시험 자료 정리(감추기 점검)'})
    adm = [p for p in call('GET', '/admin/community/polls', ADM)[1]['items'] if p['id'] == v3]
    rec('D-9 사유를 적고 감추기 → 공개 목록 · 1건 조회에서 빠짐 · 운영 목록에는 사유와 표 수가 남음', st == 200 and call('GET', f'/community/polls/{v3}')[0] == 404
        and v3 not in [p['id'] for p in call('GET', '/community/polls')[1]] and adm and adm[0]['hiddenReason'].startswith('시험 자료 정리') and adm[0]['total'] == 2, (st, adm and adm[0]['state']))
    st, j = call('POST', f'/community/polls/{v3}/vote', None, {'optionId': o[0]}, vk=vkey(50), ip=IP2)
    rec('D-10 감춘 투표에 투표 → 404', st == 404, (st, code(j)))
    st, j = patch(str(uuid.uuid4()), {'state': 'OPEN'})
    rec('D-11 없는 투표 바꾸기 → 404', st == 404, (st, code(j)))

    # ── E. 메인 노출 ──
    seed_vs = home[0]['id']
    seed_sort = int(q(f"select sort from polls where id='{seed_vs}'"))
    st, j = mk('VS', f'시험 {tag} 메인 노출', ['가', '나'], showOnHome=True, sort=max(0, seed_sort - 1)); hv = j['id']
    rec('E-1 준비 중인 투표는 메인에 안 나감', call('GET', '/community/polls?scope=home')[1][0]['id'] == seed_vs)
    patch(hv, {'state': 'OPEN'})
    h2 = call('GET', '/community/polls?scope=home')[1]
    rec('E-2 열면 — 순서가 더 앞선 투표가 그 종류의 메인 카드에(종류마다 여전히 1건)', (h2[0]['id'] == hv or seed_sort == 0) and [p['kind'] for p in h2] == ['VS', 'ASK', 'USED'], (h2[0]['id'] == hv, seed_sort))
    on = [p for p in call('GET', '/admin/community/polls', ADM)[1]['items'] if p['id'] in (hv, seed_vs)]
    rec('E-3 운영 목록의 「나가는 중」은 1건뿐', sum(1 for p in on if p['onHome']) == 1, [(p['title'][:12], p['onHome']) for p in on])
    patch(hv, {'showOnHome': False})
    rec('E-4 「메인에 내기」를 끄면 원래 투표로 돌아옴', call('GET', '/community/polls?scope=home')[1][0]['id'] == seed_vs)
    n_home = q("select count(*)||'/'||count(distinct kind) from v_poll_home")
    rec('E-5 v_poll_home — 종류마다 1건(3/3)', n_home == '3/3', n_home)

    # ── F. 사회관계망 ──
    pub = call('GET', '/site-settings/public')[1]
    rec('F-1 공개 설정에 sns.facebook · instagram · x · youtube 4개', all(k in pub for k in ('sns.facebook', 'sns.instagram', 'sns.x', 'sns.youtube')), [k for k in pub if k.startswith('sns.')])
    rec('F-2 토큰 없음 「로그인 필요」 · 일반 회원 403', noauth(call('PATCH', '/admin/site-settings', None, {'key': 'sns.instagram', 'value': 'https://www.instagram.com/x'}))
        and denied(setting('sns.instagram', 'https://www.instagram.com/x', BUY)))
    bad = [setting('sns.instagram', v)[0] for v in ('http://www.instagram.com/sogaebank', 'javascript:alert(1)', 'www.instagram.com/sogaebank', 'https://a b.com/x')]
    rec('F-3 http:// · javascript: · 주소 형식 아님 · 빈칸 섞임 → 전부 거절', all(s >= 400 for s in bad) and q("select coalesce(value,'') from site_settings where key='sns.instagram'") == SET0['sns.instagram'], bad)
    st, j = setting('sns.instagram', f'https://www.instagram.com/sogaebank_{tag}')
    rec('F-4 https:// 주소 → 저장 · 공개 설정으로 나감', st == 200 and call('GET', '/site-settings/public')[1]['sns.instagram'] == f'https://www.instagram.com/sogaebank_{tag}', (st, j))
    st, j = setting('sns.instagram', '')
    rec('F-5 비우기 → 저장(아이콘은 「준비 중」으로 돌아감)', st == 200 and (call('GET', '/site-settings/public')[1]['sns.instagram'] or '') == '', (st, j))
    pat = q("select count(*) from site_settings where key like 'sns.%' and value_pattern is not null and not is_required_for_open")
    rec('F-6 설정 4개 모두 형식 검사가 걸려 있고 오픈 필수 항목은 아님', pat == '4', pat)
    # ── G. 시드 (v10.15) ──
    _kit = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sgb')
    KIT = os.environ.get('KIT') or (_kit if os.path.isdir(os.path.join(_kit, 'scripts')) else '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
    SEED = os.path.join(KIT, 'scripts/seed-polls.sql')
    CHECK = os.environ.get('CHECK_DB') or DB.rsplit('/', 1)[0] + '/sgb_check'
    ready = subprocess.run(['psql', CHECK, '-tAc', "select to_regclass('public.polls') is not null"], capture_output=True, text=True).stdout.strip() == 't'
    if not (ready and os.path.exists(SEED)):
        R.append({'step': f'G 시드 — 검정 전용 DB(sgb_check)에 투표 표가 없어 건너뜀', 'ok': True, 'skip': True, 'detail': CHECK.rsplit('@', 1)[-1]})
    else:
        OLD = ('둘 중 어떤 제품이 더 좋을까요?', '구매할 때 가장 중요한 기준은?', '이 제품을 사용해보신 분들의 의견을 들려주세요!')
        NEW3 = ['VS|로봇청소기를 산다면, 어느 쪽을 고르시겠어요?|OPEN|2|0', 'ASK|소개받아 살 때 가장 먼저 보는 것은?|OPEN|5|0', 'USED|공기청정기를 써 보신 분들의 의견을 들려주세요!|OPEN|3|0']
        PID = 'eeeeeeee-0021-4000-a000-00000000aaaa'
        def seed_case(pre, twice=True):
            sc = ("\\t on\n\\a\nBEGIN;\ndelete from poll_options; delete from polls;\n" + pre + "\n\\i " + SEED + "\n" + ("\\i " + SEED + "\n" if twice else '') +
                  "select kind||'|'||title||'|'||state||'|'||(select count(*) from poll_options o where o.poll_id=p.id)||'|'||(select count(*) from poll_votes v where v.poll_id=p.id)"
                  "||coalesce('|'||hidden_reason,'') from polls p order by (state='HIDDEN'), sort, title;\nROLLBACK;\n")
            r = subprocess.run(['psql', CHECK, '-v', 'ON_ERROR_STOP=1', '-q'], input=sc, capture_output=True, text=True)
            return r.returncode, [l for l in r.stdout.strip().split('\n') if l.strip()], r.stderr.strip()[:200]
        n_before = subprocess.run(['psql', CHECK, '-tAc', 'select count(*) from polls'], capture_output=True, text=True).stdout.strip()
        rc, rows, err = seed_case('')
        rec('G-1 빈 DB → 확정한 질문 3건(보기 2 · 5 · 3 · 열림 · 0표) · 두 번 돌려도 3건', rc == 0 and rows == NEW3, rows or err)
        old_poll = (f"insert into polls(id,kind,title,sort,show_on_home) values ('{PID}','VS','{OLD[0]}',1,true);"
                    f"insert into poll_options(id,poll_id,sort,label) values ('eeeeeeee-0021-4000-a000-0000000000a1','{PID}',1,'A 브랜드'),('eeeeeeee-0021-4000-a000-0000000000a2','{PID}',2,'B 브랜드');"
                    f"update polls set state='OPEN' where id='{PID}';")
        rc, rows, err = seed_case(old_poll)
        rec('G-2 v10.14 예시 문구 투표가 표 없이 남은 DB → 그 투표는 지워지고 확정한 질문 3건', rc == 0 and rows == NEW3, rows or err)
        rc, rows, err = seed_case(old_poll + f"insert into poll_votes(poll_id,option_id,visitor_key) values ('{PID}','eeeeeeee-0021-4000-a000-0000000000a1','seed-test-0001');")
        rec('G-3 예시 문구 투표에 표가 있으면 → 지우지 않고 「감춤」(사유 · 표 1 그대로) + 확정한 질문 3건', rc == 0 and rows[:3] == NEW3 and len(rows) == 4
            and rows[3].startswith(f'VS|{OLD[0]}|HIDDEN|2|1|예시 문구 투표'), rows or err)
        rc, rows, err = seed_case("insert into polls(kind,title,sort) values ('ASK','운영이 직접 만든 투표입니다',1);")
        rec('G-4 운영이 만든 투표만 있는 DB → 아무것도 넣지 않음(1건 그대로)', rc == 0 and rows == ['ASK|운영이 직접 만든 투표입니다|DRAFT|0|0'], rows or err)
        n_after = subprocess.run(['psql', CHECK, '-tAc', 'select count(*) from polls'], capture_output=True, text=True).stdout.strip()
        rec('G-5 시험 뒤 검정 DB 에 남은 것 없음(되돌림)', n_before == n_after, (n_before, n_after))
finally:
    # ── 되돌리기 ──
    for k, v in SET0.items(): setting(k, v)
    back = {k: q(f"select coalesce(value,'') from site_settings where key='{k}'") for k in SET0}
    rec('Z-1 공용 설정을 처음 값으로 되돌림', back == SET0, back)
    for pid in made:
        if q(f"select state from polls where id='{pid}'") != 'HIDDEN': patch(pid, {'state': 'HIDDEN', 'hiddenReason': '시험 자료 정리(srv_poll.py)'})
    left = q("select count(*) from polls where title like '시험 %' and state <> 'HIDDEN'")
    rec('Z-2 시험 투표는 모두 「감춤」으로 — 사용자 화면에 남지 않음', left == '0', left)
    rec('Z-3 메인에 나가는 투표는 처음 그대로(3건)', q("select count(*) from v_poll_home") == '3')

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'srv_poll.json'), 'w'), ensure_ascii=False, indent=1)
real = [r for r in R if not r.get('skip')]
print(f"통과 {sum(r['ok'] for r in real)} / {len(real)}" + (f" · 건너뜀 {len(R) - len(real)}" if len(R) > len(real) else ''))
