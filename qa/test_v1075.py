"""v10.75 시험 — 소개광장 운영 「댓글 감추기 · 되살리기」(docs/129)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1075.py

  ① 서버 — 글의 댓글 · 댓글 감추기 · 되살리기 API · 운영 역할 · 감사 기록 · 사유 필수 · 사유를 답에 담음 · SQL 고정 글
  ② 운영 화면 — 글 찾기 표의 댓글 수 → 댓글 펼침 · 감추기 · 되살리기 · 메뉴 부제 · 회원 화면 문구
  ③ (DB 가 있으면) 거래 안에서 시험하고 되돌림 — 감추면 글의 댓글 수가 줄고, 되살리면 돌아옴
  ④ (API 가 있으면) 점검판 API — 댓글 목록 · 감추기 · 되살리기 · 422 · 409 · 회원 403 · 회원 화면에 가려짐 · (DB 도 있으면) 감사 기록에 사유
"""
import json, os, re, subprocess, time, urllib.request, uuid

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
SITE = rd('site/src/app/community/[id]/page.tsx')
SCR = rd('spec/screens.json')
SMP = rd('spec/response_samples.json')

blk = lambda src, head: (lambda i: src[i:src.find('\n  @ApiBearerAuth()', i + 1) if src.find('\n  @ApiBearerAuth()', i + 1) > 0 else len(src)])(src.find(head))
cl = blk(C, "@Get('admin/community/posts/:id/comments')")
ch = blk(C, "@Post('admin/community/comments/:id/hide')")
cu = blk(C, "@Post('admin/community/comments/:id/unhide')")
ok('① API — 글의 댓글 · 운영 역할만', "@Roles('ADMIN', 'SUPER')" in cl and 'this.svc.adminComments(' in cl, '')
ok('① API — 댓글 감추기 · 되살리기 · 운영 역할만 · 감사 기록', "@Roles('ADMIN', 'SUPER')" in ch and "@Audit('COMMENT_HIDE', 'COMMENT')" in ch and 'this.svc.hideComment(' in ch
   and "@Roles('ADMIN', 'SUPER')" in cu and "@Audit('COMMENT_UNHIDE', 'COMMENT')" in cu and 'this.svc.unhideComment(' in cu, '')
fn = lambda name: S[S.find(f'async {name}('):S.find('\n  }\n', S.find(f'async {name}(')) + 4]
fh, fu, fl, fp = fn('hideComment'), fn('unhideComment'), fn('adminComments'), fn('unhide')
ok('① 댓글 감추기 — 사유 필수 · 공개 댓글만 · 아니면 409 · 사유를 답에', "PolicyViolation('REASON_REQUIRED'" in fh and "WHERE id = $1 AND state = 'PUBLISHED'" in fh
   and "StateConflict('NOT_PUBLISHED'" in fh and 'reason: reason.trim()' in fh, '')
ok('① 댓글 되살리기 — 사유 필수 · 감춘 댓글만 · 아니면 409 · 사유를 답에', "PolicyViolation('REASON_REQUIRED'" in fu and "WHERE id = $1 AND state = 'HIDDEN'" in fu
   and "StateConflict('NOT_HIDDEN'" in fu and 'reason: reason.trim()' in fu and 'hidden_at = NULL' in fu, '')
ok('① 글의 댓글 — 모든 상태 · 작성자 이름 · 없는 글 404', 'c.state' in fl and "c.state <> 'DELETED'" not in fl and "coalesce(a.name,'(탈퇴)') AS author" in fl
   and "NotFound('없는 글입니다.')" in fl, '')
ok('① 글 되살리기(v10.72)도 사유를 답에 담음 — 감사 기록은 답만 남김', 'reason: reason.trim()' in fp, '')
lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', S) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
ok('① 회원 화면 댓글 — 감춘 댓글은 본문을 내보내지 않음', "CASE WHEN c.state = 'HIDDEN' THEN NULL ELSE c.body END AS body" in S, '')
ok('① 소개광장 서비스 SQL 이 모두 고정 글', lits and not [x for x in lits if '${' in x], len(lits))
ok('① 명세 — 화면 연결 3 · 응답 표본 3', all(x in SCR for x in ('"GET /admin/community/posts/{id}/comments"', '"POST /admin/community/comments/{id}/hide"', '"POST /admin/community/comments/{id}/unhide"'))
   and all(x in SMP for x in ('"get /api/v1/admin/community/posts/{id}/comments"', '"post /api/v1/admin/community/comments/{id}/hide"', '"post /api/v1/admin/community/comments/{id}/unhide"')), '')

ok('② 운영 화면 — 댓글 수 단추 → 댓글 펼침', 'function CommentPanel(' in W and '<CommentPanel postId={p.id}' in W and 'aria-expanded={open === p.id}' in W
   and '/admin/community/posts/${postId}/comments' in W, '')
ok('② 운영 화면 — 댓글 감추기 · 되살리기 · 사유 없으면 안 보냄 · 지운 댓글은 단추 없음', '/admin/community/comments/${x.id}/${kind}' in W and "x.state === 'PUBLISHED'" in W
   and "x.state === 'HIDDEN'" in W and '사유를 반드시 적으십시오. 감사 기록에 남습니다.' in W, '')
ok('② 운영 화면 — 표 칸 수와 펼침 칸(colSpan 8) 일치', W.count('<th>', W.find('function PostFinder(')) - W.count('<th>', W.find('function CommentPanel(')) == 8 and 'colSpan={8}' in W, '')
ok('② import — Fragment', "import { Fragment, useState } from 'react';" in W, '')
ok('② 메뉴 부제', '모든 글과 댓글을 찾아 감추거나 되살립니다' in MENU, '')
ok('② 회원 화면 — 신고 기능이 없으므로 「운영 기준에 따라 가려진 댓글」', '운영 기준에 따라 가려진 댓글입니다.' in SITE and '신고가 들어와 가려진 댓글' not in SITE, '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    A = psql("SELECT id FROM accounts ORDER BY created_at, id LIMIT 1")[1]
    PID, CID = str(uuid.uuid4()), str(uuid.uuid4())
    NEW = (f"INSERT INTO posts(id, board, author_id, title, body, state) VALUES ('{PID}', 'QNA', '{A}', '점검 댓글 감추기 글', '점검 댓글 감추기 본문입니다', 'PUBLISHED'); "
           f"UPDATE posts SET state = 'PUBLISHED' WHERE id = '{PID}'; "
           f"INSERT INTO post_comments(id, post_id, author_id, body) VALUES ('{CID}', '{PID}', '{A}', '점검 댓글입니다'); ")
    LOOK = f"SELECT p.comment_count || '|' || c.state FROM posts p JOIN post_comments c ON c.post_id = p.id WHERE c.id = '{CID}'; "
    if A:
        rc, out, err = psql(f"BEGIN; {NEW} {LOOK} "
                            f"UPDATE post_comments SET state = 'HIDDEN', hidden_at = now() WHERE id = '{CID}' AND state = 'PUBLISHED'; {LOOK} "
                            f"UPDATE post_comments SET state = 'PUBLISHED', hidden_at = NULL WHERE id = '{CID}' AND state = 'HIDDEN'; {LOOK} ROLLBACK;")
        lines = out.split('\n')
        ok('③ 댓글 감추기 → 글의 댓글 수 1 → 0 · 되살리기 → 1', rc == 0 and lines[-3:] == ['1|PUBLISHED', '0|HIDDEN', '1|PUBLISHED'], (out or err)[:200])
    else:
        ok('③ 시험 자료(회원)', False, '')
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
    ADM, MEM, CMT = login('admin@x.com'), login(os.environ.get('MEMBER', 'person@x.com')), login(os.environ.get('COMMENTER', 'buyer@x.com'))
    tag = uuid.uuid4().hex[:6]
    sc, jc = call('POST', '/me/community/posts', MEM, {'board': 'QNA', 'title': f'점검 댓글 감추기 {tag}', 'body': f'점검 댓글 감추기 본문입니다 {tag}'})
    pid = (jc or {}).get('id')
    if pid and (jc or {}).get('state') == 'PENDING':
        call('POST', f'/admin/community/posts/{pid}/approve', ADM)
    sm, jm = (call('POST', f'/me/community/posts/{pid}/comments', CMT, {'body': f'점검 댓글입니다 {tag}'}) if pid else (0, None))
    cid = (jm or {}).get('id')
    if cid:
        s0, j0 = call('GET', f'/admin/community/posts/{pid}/comments', ADM)
        ok('④ 글의 댓글 — 운영자 200 · 상태 · 작성자', s0 == 200 and any(i['id'] == cid and i['state'] == 'PUBLISHED' and i['author'] for i in (j0 or {}).get('items', [])), f'{s0}')
        r1, _ = call('GET', f'/admin/community/posts/{pid}/comments', MEM)
        r2, _ = call('POST', f'/admin/community/comments/{cid}/hide', MEM, {'reason': '회원'})
        r3, _ = call('POST', f'/admin/community/comments/{cid}/hide', ADM, {'reason': ' '})
        ok('④ 회원 403(목록 · 감추기) · 사유 없으면 422', r1 == 403 and r2 == 403 and r3 == 422, f'{r1} {r2} {r3}')
        h1, jh = call('POST', f'/admin/community/comments/{cid}/hide', ADM, {'reason': f'점검 감추기 {tag}'})
        h2, _ = call('POST', f'/admin/community/comments/{cid}/hide', ADM, {'reason': '두 번째'})
        _, pub = call('GET', f'/community/posts/{pid}')
        pc = [c for c in (pub or {}).get('comments', []) if c.get('id') == cid]
        _, jf = call('GET', f'/admin/community/posts?q={tag}&size=5', ADM)
        cc = [i.get('commentCount') for i in (jf or {}).get('items', []) if i.get('id') == pid]
        ok('④ 감추기 → 답에 사유 · 다시 누르면 409', h1 in (200, 201) and (jh or {}).get('reason') == f'점검 감추기 {tag}' and h2 == 409, f'{h1} {h2} {jh}')
        ok('④ 회원 화면 — 가려진 댓글로 나옴 · 본문 안 나감 · 글의 댓글 수 0', pc and pc[0].get('hidden') is True and pc[0].get('body') is None and cc == [0], f'{pc} {cc}')
        u1, ju = call('POST', f'/admin/community/comments/{cid}/unhide', ADM, {'reason': f'점검 되살리기 {tag}'})
        u2, _ = call('POST', f'/admin/community/comments/{cid}/unhide', ADM, {'reason': '두 번째'})
        u3, _ = call('POST', f'/admin/community/comments/{uuid.uuid4()}/unhide', ADM, {'reason': '없는 댓글'})
        ok('④ 되살리기 → 답에 사유 · 다시 누르면 409 · 없는 댓글 404', u1 in (200, 201) and (ju or {}).get('reason') == f'점검 되살리기 {tag}' and u2 == 409 and u3 == 404, f'{u1} {u2} {u3}')
        if DB:
            time.sleep(1)  # 감사 기록은 답을 보낸 뒤 씁니다
            rc, out, err = psql(f"SELECT string_agg(action || ':' || coalesce(after_data->>'reason',''), ' · ' ORDER BY id) FROM audit.audit_logs "
                                f"WHERE target_type = 'COMMENT' AND target_id = '{cid}' AND action IN ('COMMENT_HIDE','COMMENT_UNHIDE')")
            ok('④ 감사 기록에 사유가 남음(감추기 · 되살리기)', rc == 0 and out == f'COMMENT_HIDE:점검 감추기 {tag} · COMMENT_UNHIDE:점검 되살리기 {tag}', (out or err)[:200])
    else:
        ok('④ 시험 글 · 댓글 쓰기', False, f'{sc} {jc} {sm} {jm}')
else:
    print('     (API 없음 — ④ 건너뜀 · API=http://localhost:13000/api/v1 로 점검판에서)')

ok('VERSION v10.75 이상', re.match(r'v10\.(7[5-9]|[89]\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
