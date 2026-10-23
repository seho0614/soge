"""v10.80 시험 — 소개광장 댓글 신고(D110 · docs/133)

  KIT=… [DB=postgresql://sgb:sgb@localhost:15432/sgb] [API=http://localhost:13000/api/v1] python3 -I test_v1080.py

  ① 마이그레이션 — 신고 대상 COMMENT · 두 신고 함수는 D031 정의 그대로 + 댓글 갈래만 · 자료 안 지움 · 마지막 D110 · 148
  ② 서버 · 화면 — 신고 API 대상 · 댓글 mine · hiddenBy · 검수 큐 신고된 댓글 · 되살리기 결정 A · 사용자 화면 「신고」 · 운영 화면 표 · 이름
  ③ (DB) 거래 안에서 — 3명 신고 → 가려짐 · 자기 댓글 · 지운 댓글 거절 · 되살리기 SQL → 신고 수 0 · 기각 · 글 신고는 그대로
  ④ (API) 점검판 — 본인인증 회원 3명이 신고 → 회원 화면 「신고로 가려짐」 · 검수 큐 · 되살리기 → 기각 3 · 알림 · 작성자 자기 신고 거절
"""
import glob, json, os, re, subprocess, time, urllib.request, uuid

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


M, O = rd('prisma/migrations/D110_comment_report/migration.sql'), rd('prisma/migrations/D031_fix_open_findings_v1027/migration.sql')
def fn(src, name):
    i = src.find(f'CREATE OR REPLACE FUNCTION public.{name}()'); return src[i:src.find('END $$;', i) + 7] if i >= 0 else ''
g, e = fn(M, 'fn_report_guard'), fn(M, 'fn_report_escalate')
cut = lambda t, a, b: t[:t.find(a)] + t[t.find(b):] if a in t and b in t else t
g0 = cut(g, "  ELSIF NEW.target_type = 'COMMENT' THEN", "  END IF;\n\n  IF v_owner IS NOT NULL")
e0 = cut(e, "  /* D110 · v10.80", "  END IF;\n\n  SELECT auto_queue_at").replace("NEW.target_type IN ('POST','COMMENT')", "NEW.target_type = 'POST'")
ok('① 신고 대상에 COMMENT', "CHECK (target_type = ANY (ARRAY['LISTING','REQUEST','SERVICE','PROFILE','POST','COMMENT']))" in M, '')
ok('① fn_report_guard — D031 그대로 + 댓글 갈래(주인 · 지운 댓글 거절)', g and g0 == fn(O, 'fn_report_guard') and 'SELECT author_id INTO v_owner FROM post_comments' in g
   and "state IN ('PUBLISHED','HIDDEN')) THEN\n      RAISE EXCEPTION 'REPORT: 신고할 수 없는 댓글입니다" in g, '')
ok('① fn_report_escalate — D031 그대로 + 댓글 갈래(서로 다른 신고자 · 3명이면 가림 · 큐)', e and e0 == fn(O, 'fn_report_escalate') and 'UPDATE post_comments SET report_count = v_posters' in e
   and "WHERE target_type = 'COMMENT' AND target_id = NEW.target_id AND state IN ('OPEN','QUEUED','UPHELD')" in e, '')
ok('① 자료를 지우지 않음', not re.search(r'\b(DELETE FROM|TRUNCATE|DROP TABLE)\b', M), '')
mig = sorted(os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(K, 'prisma/migrations/*/migration.sql')))
ok('① 마이그레이션 148 · 마지막 D110(v10.83 부터 D111 · 149 — test_v1083)', (len(mig), mig[-1] if mig else '') in ((148, 'D110_comment_report'), (149, 'D111_search_synonym_expand'), (150, 'D112_search_synonym_seed')), f'{len(mig)} · {mig[-1] if mig else ""}')

S, C = rd('src/modules/community/community.service.ts'), rd('src/modules/community/community.controller.ts')
ok('② 신고 API 대상에 COMMENT', "'POST', 'COMMENT'] as const" in rd('src/modules/review/abuse.controller.ts'), '')
co = S[S.find('private async commentsOf('):S.find('async classify(')]
ok('② 회원 화면 댓글 — mine · hiddenBy(신고 3건 REPORT · 운영 ADMIN) · 본문은 가린 댓글에 안 나감', '(c.author_id = $2::uuid) AS mine' in co
   and "CASE WHEN c.state <> 'HIDDEN' THEN NULL WHEN c.report_count >= 3 THEN 'REPORT' ELSE 'ADMIN' END AS \"hiddenBy\"" in co and '[id, this.me ?? null]' in co
   and "CASE WHEN c.state = 'HIDDEN' THEN NULL ELSE c.body END AS body" in co, '')
uc = S[S.find('async unhideComment('):]
ok('② 댓글 되살리기 — 한 거래 · 신고 수 0 · 처리 전 신고 기각 · 알림(결정 A)', 'this.db.transaction(' in uc and 'report_count = 0' in uc
   and "WHERE target_type = 'COMMENT' AND target_id = $1 AND state IN ('OPEN','QUEUED')" in uc and "'REPORT_RESOLVED'" in uc and 'COMMENT_UNHIDE_RESOLUTION' in uc, '')
ok('② 검수 큐 — 신고된 댓글(3건 이상) · 운영 댓글 신고 수', 'reportedComments' in S and 'WHERE c.report_count >= 3 AND c.state <> \'DELETED\'' in S and 'c.report_count AS "reportCount", coalesce(a.name' in S, '')
lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', S) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
ok('② 소개광장 서비스 SQL 이 모두 고정 글', lits and not [x for x in lits if '${' in x], len(lits))
PG, RP = rd('site/src/app/community/[id]/page.tsx'), rd('site/src/app/report/[targetType]/[targetId]/page.tsx')
ok('② 사용자 화면 — 남의 공개 댓글에 「신고」 · 가린 까닭별 문구', "{loggedIn && !c.mine && !c.hidden && <a className=\"dim cmu-rpt\" href={`/report/comment/${c.id}`}" in PG
   and "c.hiddenBy === 'REPORT' ? '신고가 들어와 가려진 댓글입니다.' : '운영 기준에 따라 가려진 댓글입니다.'" in PG, '')
ok('② 신고 화면 — comment · 「소개광장 댓글」 · 3명 안내', "comment: 'COMMENT'" in RP and "COMMENT: '소개광장 댓글'" in RP and "t === 'COMMENT' ? '댓글이' : '글이'" in RP, '')
ok('② 이름 — 내 신고 · 운영 신고 처리', all("POST: '소개광장 글', COMMENT: '소개광장 댓글'" in rd(f) for f in ('site/src/app/my/reports/page.tsx', 'web/src/app/admin/ReportQueue.tsx')), '')
W = rd('web/src/app/admin/Community.tsx')
ok('② 운영 화면 — 신고된 댓글 표 · 감추기 · 되살리기 · 댓글 신고 수 칸', 'data-reported-comments' in W and "commentAct(c, 'unhide')" in W and "commentAct(c, 'hide')" in W
   and '<th>쓴 날</th><th>신고</th><th>상태</th>' in W, '')

if DB:
    def psql(sql):
        r = subprocess.run(['psql', DB, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], capture_output=True, text=True)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    acc = psql("SELECT string_agg(id::text, ',') FROM (SELECT id FROM accounts ORDER BY created_at, id LIMIT 5) x")[1].split(',')
    RC = psql("SELECT code FROM report_reasons ORDER BY code LIMIT 1")[1]
    A, R3 = acc[0], acc[1:4]
    PID, CID = str(uuid.uuid4()), str(uuid.uuid4())
    NEW = (f"INSERT INTO posts(id, board, author_id, title, body, state) VALUES ('{PID}', 'QNA', '{A}', '점검 댓글 신고 글', '점검 댓글 신고 본문입니다', 'PUBLISHED'); "
           f"UPDATE posts SET state = 'PUBLISHED' WHERE id = '{PID}'; "
           f"INSERT INTO post_comments(id, post_id, author_id, body) VALUES ('{CID}', '{PID}', '{A}', '점검 댓글입니다'); ")
    REP = lambda who: ''.join(f"INSERT INTO reports(target_type, target_id, reason_code, reporter_id) VALUES ('COMMENT', '{CID}', '{RC}', '{w}'); " for w in who)
    LOOK = f"SELECT state || '|' || report_count FROM post_comments WHERE id = '{CID}'; "
    if len(acc) == 5 and RC:
        rc, out, err = psql(f"BEGIN; {NEW} {REP(R3[:2])} {LOOK} {REP(R3[2:3])} {LOOK} "
                            f"SELECT count(*) FILTER (WHERE state = 'QUEUED') FROM reports WHERE target_type = 'COMMENT' AND target_id = '{CID}'; "
                            f"UPDATE post_comments SET state = 'PUBLISHED', hidden_at = NULL, report_count = 0 WHERE id = '{CID}' AND state = 'HIDDEN'; "
                            f"UPDATE reports SET state = 'DISMISSED', resolution = '점검 기각', handled_at = now() WHERE target_type = 'COMMENT' AND target_id = '{CID}' AND state IN ('OPEN','QUEUED'); "
                            f"{LOOK} SELECT state FROM posts WHERE id = '{PID}'; ROLLBACK;")
        L = out.split('\n')
        ok('③ 신고 2명 → 공개 · 수 2 / 3명 → 가려짐 · 수 3 · 신고는 큐로', rc == 0 and L[:3] == ['PUBLISHED|2', 'HIDDEN|3', '3'], (out or err)[:200])
        ok('③ 되살리기 SQL → 공개 · 수 0 · 글은 그대로 공개', rc == 0 and L[3:5] == ['PUBLISHED|0', 'PUBLISHED'], (out or err)[:200])
        rc1, _, e1 = psql(f"BEGIN; {NEW} INSERT INTO reports(target_type, target_id, reason_code, reporter_id) VALUES ('COMMENT', '{CID}', '{RC}', '{A}'); ROLLBACK;")
        rc2, _, e2 = psql(f"BEGIN; {NEW} UPDATE post_comments SET state = 'DELETED' WHERE id = '{CID}'; {REP(R3[:1])} ROLLBACK;")
        ok('③ 자기 댓글 신고 · 지운 댓글 신고 → DB 가 거절', rc1 != 0 and '자기 등록은 신고할 수 없습니다' in e1 and rc2 != 0 and '신고할 수 없는 댓글' in e2, f'{e1[:60]} · {e2[:60]}')
        rc3, out3, e3 = psql(f"BEGIN; {NEW} " + ''.join(f"INSERT INTO reports(target_type, target_id, reason_code, reporter_id) VALUES ('POST', '{PID}', '{RC}', '{w}'); " for w in R3)
                             + f"SELECT state || '|' || report_count FROM posts WHERE id = '{PID}'; ROLLBACK;")
        ok('③ 글 신고는 그대로 — 3명 → 가려짐(D031 과 같음)', rc3 == 0 and out3.endswith('HIDDEN|3'), (out3 or e3)[:120])
    else:
        ok('③ 시험 자료(회원 5명 · 신고 사유)', False, f'{len(acc)} {RC}')
else:
    print('     (DB 없음 — ③ 건너뜀)')

if API and DB:
    def call(m_, p, tok=None, body=None):
        h = {'content-type': 'application/json'}
        if tok: h['authorization'] = 'Bearer ' + tok
        req = urllib.request.Request(API + p, method=m_, data=json.dumps(body).encode() if body is not None else None, headers=h)
        try:
            r = urllib.request.urlopen(req, timeout=30); st, raw = r.status, r.read()
        except urllib.error.HTTPError as ex:
            st, raw = ex.code, ex.read()
        try: js = json.loads(raw) if raw else None
        except Exception: js = None
        return st, js
    login = lambda em: call('POST', '/auth/login', body={'email': em, 'password': 'sgb-dev-1234'})[1]['accessToken']
    ADM, AUT = login('admin@x.com'), login(os.environ.get('MEMBER', 'person@x.com'))
    REPS = [login(x) for x in ('buyer@x.com', 'intro@x.com', 'seller@x.com')]
    for t in REPS + [AUT]: call('POST', '/verifications/identity', t, {'provider': 'PASS'})       # 신고는 본인인증한 회원만
    pid = psql("SELECT id FROM posts WHERE state = 'PUBLISHED' AND board <> 'FOOD' ORDER BY created_at DESC LIMIT 1")[1]
    tag = uuid.uuid4().hex[:6]
    sc, jc = call('POST', f'/me/community/posts/{pid}/comments', AUT, {'body': f'점검 댓글 신고 {tag}'})
    cid = (jc or {}).get('id')
    code = next((x['code'] for x in (call('GET', '/report-reasons')[1] or []) if x['code'] != 'OTHER'), 'OTHER')
    if cid:
        s0, _ = call('POST', '/reports', AUT, {'targetType': 'COMMENT', 'targetId': cid, 'reasonCode': code, 'detail': f'점검 {tag}'})
        st = [call('POST', '/reports', t, {'targetType': 'COMMENT', 'targetId': cid, 'reasonCode': code, 'detail': f'점검 {tag}'})[0] for t in REPS]
        _, pub = call('GET', f'/community/posts/{pid}')
        pc = [c for c in (pub or {}).get('comments', []) if c.get('id') == cid]
        ok('④ 작성자 자기 댓글 신고 거절 · 3명 신고 받음', s0 >= 400 and all(x < 300 for x in st), f'{s0} · {st}')
        ok('④ 회원 화면 — 신고로 가려짐(hiddenBy REPORT · 본문 없음)', pc and pc[0].get('hidden') is True and pc[0].get('hiddenBy') == 'REPORT' and pc[0].get('body') is None, pc)
        _, qj = call('GET', '/admin/community/queue', ADM)
        ok('④ 검수 큐 — 신고된 댓글에 나옴(신고 3)', any(x.get('id') == cid and x.get('reportCount') == 3 for x in (qj or {}).get('reportedComments', [])), '')
        su, ju = call('POST', f'/admin/community/comments/{cid}/unhide', ADM, {'reason': f'점검 되살리기 {tag}'})
        _, pub2 = call('GET', f'/community/posts/{pid}')
        pc2 = [c for c in (pub2 or {}).get('comments', []) if c.get('id') == cid]
        time.sleep(1)
        nt = psql(f"SELECT count(*) FROM notifications n JOIN accounts a ON a.id = n.account_id WHERE a.email IN ('buyer@x.com','intro@x.com','seller@x.com') "
                  f"AND n.event_code = 'REPORT_RESOLVED' AND n.created_at > now() - interval '5 minutes'")[1]
        rcnt = psql(f"SELECT report_count FROM post_comments WHERE id = '{cid}'")[1]
        ok('④ 되살리기 → 기각 3 · 다시 보임 · 신고 수 0 · 신고한 3명에게 알림', su in (200, 201) and (ju or {}).get('dismissed') == 3 and pc2 and pc2[0].get('hidden') is False
           and rcnt == '0' and nt.isdigit() and int(nt) >= 3, f'{su} {ju} · 수 {rcnt} · 알림 {nt}')
    else:
        ok('④ 시험 댓글 쓰기', False, f'{sc} {jc}')
else:
    print('     (API · DB 없음 — ④ 건너뜀)')

ok('VERSION v10.80 이상', re.match(r'v10\.(8\d|9\d)', rd('VERSION').strip()) is not None, rd('VERSION').strip())
n = sum(1 for r in RES if r[0])
print(f'통과 {n} / {len(RES)}')
