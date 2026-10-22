"""v10.72 시험 — 소개광장 운영 「글 찾기 · 감추기 · 되살리기」(docs/128)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1072.py

  ① 서버 — 글 찾기 · 되살리기 API · 운영 역할 · 감사 기록 · 사유 필수 · 지운 글 제외 · SQL 고정 글 · import
  ② 운영 화면 — 글 찾기 칸 · 되살리기 단추 · 신고된 글 표의 되살리기 · 메뉴 부제
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림 — 신고 3건 자동 감춤 → 되살리기 SQL → 신고 기각 · 수 0 → 새 신고 1건은 그대로 공개
  ④ (API 가 있으면) 점검판 API — 찾기 · 감추기 · 되살리기 · 사유 없으면 422 · 지운 글 409 · 일반 회원 403
"""
import json, os, re, subprocess, urllib.request, uuid

K = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002') + '/sgb'
DB = os.environ.get('DB')
API = os.environ.get('API')
RES = []


def ok(name, cond, detail=''):
    RES.append((bool(cond), name, detail))
    print(('ok  ' if cond else 'FAIL') + f' {name} — {detail}', flush=True)


def rd(rel):
    p = os.path.join(K, rel)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else ''


S = rd('src/modules/community/community.service.ts')
C = rd('src/modules/community/community.controller.ts')
W = rd('web/src/app/admin/Community.tsx')
MENU = rd('web/src/lib/adminMenu.ts')

blk = lambda src, head: (lambda i: src[i:src.find('\n  @ApiBearerAuth()', i + 1) if src.find('\n  @ApiBearerAuth()', i + 1) > 0 else len(src)])(src.find(head))
cp, cu = blk(C, "@Get('admin/community/posts')"), blk(C, "@Post('admin/community/posts/:id/unhide')")
ok('① API — 글 찾기 · 되살리기 · 운영 역할만 · 감사 기록', "@Roles('ADMIN', 'SUPER')" in cp and 'this.svc.adminPosts(' in cp
   and "@Roles('ADMIN', 'SUPER')" in cu and "@Audit('POST_UNHIDE', 'POST')" in cu and 'this.svc.unhide(' in cu, '')
fu = S[S.find('async unhide('):S.find('\n  }\n', S.find('async unhide(')) + 4]
ok('① 되살리기 — 사유 필수 · 감춘 글만 · 지운 글 409', "PolicyViolation('REASON_REQUIRED'" in fu and "StateConflict('NOT_HIDDEN'" in fu
   and "WHERE id = $1 AND state = 'HIDDEN'" in fu and '작성자가 지운 글은 되살리지 않습니다' in fu, '')
ok('① 되살리기 — 신고 수 0 · 처리 전 신고 기각 · 신고자 알림 · 한 거래', 'report_count = 0' in fu and "SET state = 'DISMISSED', resolution = $2" in fu
   and "state IN ('OPEN','QUEUED')" in fu and "'REPORT_RESOLVED'" in fu and 'this.db.transaction(' in fu, '')
ok('① 감추기 — 작성자가 지운 글은 감추지 않음', "WHERE id = $1 AND state <> 'DELETED' RETURNING id" in S, '')
fa = S[S.find('async adminPosts('):S.find('async hide(')]
ok('① 글 찾기 — 상태 · 게시판(맛집 포함) · 검색 · 쪽 · 건수와 목록 조건 같음', "ADMIN_STATES.includes(state)" in fa and "[...BOARDS, 'FOOD']" in fa
   and fa.count("WHERE ($1::text IS NULL OR p.state = $1)\n          AND ($2::text IS NULL OR p.board = $2)\n          AND fn_search_match(p.title, p.body, $3)") == 2
   and 'Math.min(sizeIn, 50)' in fa, '')
lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', S) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
ok('① 소개광장 서비스 SQL 이 모두 고정 글(통합 검정 SQL 대조 · srv_cmu E-4 와 같은 규칙)', lits and not [x for x in lits if '${' in x], len(lits))
ok('① import — StateConflict', "import { NotFound, PolicyViolation, StateConflict } from '../../core/errors';" in S, '')
ok('① 신고된 글 — 감춘 때(hiddenAt)를 돌려줌', 'hidden_at AS "hiddenAt"\n         FROM v_post_reported' in S, '')

ok('② 운영 화면 — 글 찾기(상태 · 게시판 · 검색 · 쪽)', 'function PostFinder(' in W and '<PostFinder ' in W and '/admin/community/posts?page=' in W
   and 'aria-label="상태"' in W and 'aria-label="게시판"' in W and '다음 쪽 →' in W, '')
ok('② 운영 화면 — 되살리기 단추(찾기 표 · 신고된 글 표) · 사유 없으면 안 보냄', W.count('되살리기</button>') == 2 and '/unhide`' in W
   and '되살리실 때도 사유를 적으십시오' in W, '')
ok('② 운영 화면 — 지운 글은 단추 없음', "p.state === 'PUBLISHED' || p.state === 'PENDING'" in W and "p.state === 'HIDDEN'" in W, '')
ok('② 메뉴 부제', '모든 글을 찾아 감추거나 되살립니다' in MENU, '')
ok('② import — useState · ymdKst', "import { useState } from 'react';" in W and "import { ymdKst } from '../../lib/format';" in W, '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    # 작성자 1명 · 신고자 4명(작성자가 아닌 회원) · 신고 사유 1개
    A = psql("SELECT id FROM accounts ORDER BY created_at, id LIMIT 1")[1]
    RP = psql(f"SELECT string_agg(id::text, ',') FROM (SELECT id FROM accounts WHERE id <> '{A}' ORDER BY created_at, id LIMIT 4) x")[1].split(',')
    RC = psql("SELECT code FROM report_reasons ORDER BY code LIMIT 1")[1]
    PID = str(uuid.uuid4())
    NEW = (f"INSERT INTO posts(id, board, author_id, title, body, state) VALUES ('{PID}', 'QNA', '{A}', '점검 되살리기 글', '점검 되살리기 본문입니다', 'PUBLISHED'); "
           f"UPDATE posts SET state = 'PUBLISHED' WHERE id = '{PID}'; ")  # 첫 글이면 트리거가 검수 대기로 둡니다 — 승인한 것으로
    REP = lambda who: ''.join(f"INSERT INTO reports(target_type, target_id, reason_code, reporter_id) VALUES ('POST', '{PID}', '{RC}', '{w}'); " for w in who)
    # 서비스의 되살리기 SQL 과 같은 두 문장
    UNHIDE = (f"UPDATE posts SET state = 'PUBLISHED', hidden_at = NULL, hidden_reason = NULL, report_count = 0, updated_at = now() WHERE id = '{PID}' AND state = 'HIDDEN'; "
              f"UPDATE reports SET state = 'DISMISSED', resolution = '점검 기각', handled_by = NULL, handled_at = now() "
              f"WHERE target_type = 'POST' AND target_id = '{PID}' AND state IN ('OPEN','QUEUED'); ")
    LOOK = f"SELECT state || '|' || report_count FROM posts WHERE id = '{PID}'; "
    ready = A and len(RP) == 4 and RC
    if ready:
        rc, out, err = psql(f"BEGIN; {NEW} {LOOK} {REP(RP[:3])} {LOOK} {UNHIDE} {LOOK} "
                            f"SELECT count(*) FILTER (WHERE state = 'DISMISSED') || '/' || count(*) FROM reports WHERE target_type = 'POST' AND target_id = '{PID}'; "
                            f"{REP(RP[3:4])} {LOOK} ROLLBACK;")
        lines = out.split('\n')
        ok('③ 신고 3건 → 자동 감춤', rc == 0 and len(lines) >= 2 and lines[1] == 'HIDDEN|3', (out or err)[:200])
        ok('③ 되살리기 → 공개 · 신고 수 0 · 처리 전 신고 3건 기각', rc == 0 and len(lines) >= 4 and lines[2] == 'PUBLISHED|0' and lines[3] == '3/3', (out or err)[:200])
        ok('③ 되살린 뒤 새 신고 1건 → 공개 그대로 · 수 1(예전 신고는 세지 않음)', rc == 0 and len(lines) >= 5 and lines[4] == 'PUBLISHED|1', (out or err)[:200])
        rc, out, err = psql(f"BEGIN; {NEW} UPDATE posts SET state = 'DELETED' WHERE id = '{PID}'; "
                            f"UPDATE posts SET state = 'HIDDEN' WHERE id = '{PID}' AND state <> 'DELETED' RETURNING id; {LOOK} ROLLBACK;")
        ok('③ 지운 글은 감추기 SQL 이 건드리지 않음', rc == 0 and out.strip().split('\n')[-1].startswith('DELETED|'), (out or err)[:120])
        rc, out, err = psql(f"BEGIN; {NEW} SELECT count(*) FROM posts p WHERE ('PUBLISHED'::text IS NULL OR p.state = 'PUBLISHED') "
                            f"AND ('QNA'::text IS NULL OR p.board = 'QNA') AND fn_search_match(p.title, p.body, '되살리기 본문'); ROLLBACK;")
        ok('③ 글 찾기 조건(상태 · 게시판 · 검색어)이 새 글을 찾음', rc == 0 and out.isdigit() and int(out) >= 1, (out or err)[:120])
    else:
        ok('③ 시험 자료(회원 5명 · 신고 사유)', False, f'{A} {RP} {RC}')
else:
    print('     (DB 없음 — ③ 건너뜀 · DB=postgresql://sgb:sgb@localhost:15432/sgb 로 점검판에서)')

if API:
    def call(m, p, tok=None, body=None):
        h = {'content-type': 'application/json'}
        if tok: h['authorization'] = 'Bearer ' + tok
        req = urllib.request.Request(API + p, method=m, data=json.dumps(body).encode() if body is not None else None, headers=h)
        try:
            r = urllib.request.urlopen(req, timeout=30); st, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            st, raw = e.code, e.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    login = lambda e: call('POST', '/auth/login', body={'email': e, 'password': 'sgb-dev-1234'})[1]['accessToken']
    ADM, MEM = login('admin@x.com'), login(os.environ.get('MEMBER', 'member@t.local'))
    st, js = call('GET', '/admin/community/posts?state=PUBLISHED&size=5', ADM)
    ok('④ 글 찾기 — 운영자 200 · 모양', st == 200 and isinstance(js, dict) and {'items', 'total', 'page', 'size', 'pages'} <= set(js) and js['size'] == 5, f'{st}')
    st2, _ = call('GET', '/admin/community/posts', MEM)
    st3, _ = call('GET', '/admin/community/posts?state=NOPE', ADM)
    ok('④ 글 찾기 — 일반 회원 403 · 없는 상태 400', st2 == 403 and st3 == 400, f'{st2} {st3}')
    tgt = (js or {}).get('items') or []
    if tgt:
        pid = tgt[0]['id']
        s1, _ = call('POST', f'/admin/community/posts/{pid}/hide', ADM, {'reason': '점검 감추기'})
        s2, j2 = call('GET', '/admin/community/posts?state=HIDDEN&size=50', ADM)
        s3, _ = call('POST', f'/admin/community/posts/{pid}/unhide', ADM, {'reason': ' '})
        s4, j4 = call('POST', f'/admin/community/posts/{pid}/unhide', ADM, {'reason': '점검 되살리기'})
        s5, _ = call('POST', f'/admin/community/posts/{pid}/unhide', ADM, {'reason': '점검 두 번째'})
        s6, _ = call('POST', f'/admin/community/posts/{pid}/unhide', MEM, {'reason': '회원'})
        ok('④ 감추기 → 감춘 글 찾기에 나옴', s1 in (200, 201) and any(i['id'] == pid and i['hiddenReason'] == '점검 감추기' for i in (j2 or {}).get('items', [])), f'{s1} {s2}')
        ok('④ 되살리기 — 사유 없으면 422 · 되살림 · 다시 누르면 409 · 회원 403', s3 == 422 and s4 in (200, 201) and (j4 or {}).get('ok') is True and s5 == 409 and s6 == 403,
           f'{s3} {s4} {s5} {s6} {j4}')
    else:
        ok('④ 공개 글 1건 이상', False, 'items 0')
else:
    print('     (API 없음 — ④ 건너뜀 · API=http://localhost:13000/api/v1 로 점검판에서)')

ok('VERSION v10.72 이상', re.match(r'v10\.(7[2-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
