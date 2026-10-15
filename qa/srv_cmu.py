"""v10.23 소개광장 — 서버(API · DB) 점검. 실제 PostgreSQL(개발 DB) + 운영 방식 API(3000). 결과: srv_cmu.json

  A. 작성자 이름 가림(G-146)  목록 · 쪽 목록 · 글 상세 · 댓글에서 이름 전체가 나가지 않음(「김OO」) · 운영 공지는 「운영자」 · 운영 검수 큐는 그대로
  B. 쪽 번호                 GET /community/board — {items,total,page,size,pages} · 겹침 없음 · 고정글 먼저 · 범위를 넘는 값
  C. 게시글 검색             제목 · 본문 · 여러 낱말 · 특수 문자 · 너무 긴 검색어
  D. 보이는 범위             남의 검수 대기 글 · 가려진 글 · 지운 글은 목록 · 건수에 없음 · 내 대기 글은 나에게만
  E. 기존 길                 GET /community/posts 는 그대로 배열

사용:  python3 srv_cmu.py       API=http://localhost:3000 · DB=postgresql://sgb:sgb@localhost:5432/sgb
시험 글은 표식(제목의 [cmu-…])을 달아 넣었다가 끝에 지웁니다. 계정은 남습니다(다른 시험과 같습니다).
"""
import json, os, subprocess, sys, uuid
from urllib.parse import quote
from detail_fixture import call, q, member, login, DB

OUT = os.path.dirname(os.path.abspath(__file__))
R = []
def rec(step, ok, detail=''):
    R.append({'step': step, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print('ok  ' if ok else 'FAIL', step, '' if ok else str(detail)[:240], file=sys.stderr)

RUN = uuid.uuid4().hex[:6]
MARK = f'[cmu-{RUN}]'
KW = f'cmu{RUN}'                      # 본문에만 넣는 낱말(검색용)

def sql(s):
    p = subprocess.run(['psql', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-tAc', s], capture_output=True, text=True)
    assert p.returncode == 0, p.stderr[:300]
    return p.stdout.strip()

def put(board, author, title, body, days, state='PUBLISHED', pinned=False):
    """글 한 건을 DB 에 넣습니다(하루 5건 규칙을 피하려고 작성 시각을 과거로) — 넣은 뒤 상태를 정합니다."""
    pid = str(uuid.uuid4())
    a = f"'{author}'" if author else 'NULL'
    sql(f"INSERT INTO posts(id, board, author_id, title, body, is_pinned, created_at) VALUES ('{pid}','{board}',{a},'{MARK} {title}','{body}',{str(pinned).lower()}, now() - interval '{days} days' - interval '{len(title)} minutes');"
        f"UPDATE posts SET state='{state}' WHERE id='{pid}'")
    return pid

def board(qs='', tok=None, raw=False):
    """qs 는 「이름=값&이름=값」 — 값의 한글 · 특수 문자는 여기서 주소용으로 바꿉니다(이미 %XX 로 쓴 것은 그대로)."""
    enc = '&'.join(k + '=' + quote(v, safe='%+') for k, _, v in (kv.partition('=') for kv in qs.split('&') if kv))
    return call('GET', '/community/board' + (('?' + enc) if enc else ''), tok, raw=raw)

def cleanup():
    sql(f"DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE title LIKE '{MARK}%'); DELETE FROM posts WHERE title LIKE '{MARK}%'")
    return q(f"select count(*) from posts where title like '{MARK}%'") == '0'


def main():
    adm = login('admin@x.com'); adm_id = q("select id from accounts where email='admin@x.com'")
    A = member('cmua', '김가람'); B = member('cmub', '이서준'); C = member('cmuc', 'Alex Kim')

    # ── 준비 ── 공개 글 23건(고정 1 · 질문 6 · 업종 이야기 16) + 공지 1 + 탈퇴 1 + 대기 · 가림 · 삭제 각 1
    ids = []
    for i in range(16): ids.append(put('TRADE', A['id'], f'업종 이야기 {i:02d}', f'본문 {i:02d} 입니다. 열 글자를 넘깁니다. {KW}', 3 + i))
    for i in range(6):  ids.append(put('QNA', B['id'], f'질문 {i:02d} 권리금', f'질문 본문 {i:02d} 입니다. 열 글자를 넘깁니다.', 30 + i))
    pin = put('TRADE', C['id'], 'PINNED 고정 글', '고정한 글의 본문입니다. 열 글자를 넘깁니다.', 60, pinned=True); ids.append(pin)
    notice = put('NOTICE', adm_id, '공지 검수 안내', '운영 공지의 본문입니다. 열 글자를 넘깁니다.', 70)
    gone = put('TRADE', None, '탈퇴한 사람의 글', '탈퇴한 사람이 남긴 본문입니다. 열 글자를 넘깁니다.', 80)
    pend = put('TRADE', A['id'], '대기 중인 글', '검수 대기 본문입니다. 열 글자를 넘깁니다.', 1, state='PENDING')
    hid = put('TRADE', B['id'], '가려진 글', '가려진 글의 본문입니다. 열 글자를 넘깁니다.', 2, state='HIDDEN')
    dele = put('TRADE', B['id'], '지운 글', '지운 글의 본문입니다. 열 글자를 넘깁니다.', 2, state='DELETED')
    pub_n = 23 + 2                    # 표식이 달린 공개 글: 23 + 공지 1 + 탈퇴 1
    first = ids[0]
    st, c1 = call('POST', f'/me/community/posts/{first}/comments', B['tok'], {'body': '댓글 본문입니다 — 세금계산서는 누가 끊나요'})
    assert st < 300, ('comment', st, c1)

    # ── A ── 작성자 이름 가림
    st, raw = call('GET', '/community/posts?limit=50', raw=True)
    rows = json.loads(raw) if st == 200 else []
    mine = [r for r in rows if r['title'].startswith(MARK)]
    rec('A-1 목록(GET /community/posts) — 작성자가 「김OO」처럼 첫 글자만 나감', st == 200 and mine and all(r['author'] in ('김OO', '이OO', 'AOO', '운영자', '(탈퇴)') for r in mine), sorted({r['author'] for r in mine}))
    rec('A-2 목록 응답 어디에도 이름 전체(김가람 · 이서준 · Alex Kim)가 없음', st == 200 and not any(n in raw for n in ('김가람', '이서준', 'Alex Kim')), [n for n in ('김가람', '이서준', 'Alex Kim') if n in raw])
    st, raw = board(f'q={KW}&size=50', raw=True); bj = json.loads(raw) if st == 200 else {}
    rec('A-3 쪽 목록(GET /community/board) — 같은 규칙 · 이름 전체 없음', st == 200 and bj.get('items') and all(r['author'] == '김OO' for r in bj['items']) and '김가람' not in raw, (st, raw[:120]))
    st, raw = call('GET', f'/community/posts/{first}', raw=True); d = json.loads(raw) if st == 200 else {}
    rec('A-4 글 상세 — 작성자 「김OO」 · 응답에 이름 전체 없음', st == 200 and d.get('author') == '김OO' and '김가람' not in raw, (st, d.get('author')))
    cs = d.get('comments') or []
    rec('A-5 댓글 — 작성자 「이OO」 · 응답에 이름 전체 없음', len(cs) == 1 and cs[0].get('author') == '이OO' and '이서준' not in raw, [c.get('author') for c in cs])
    st, dn = call('GET', f'/community/posts/{notice}')
    rec('A-6 운영자가 쓴 공지 — 작성자 「운영자」', st == 200 and (dn or {}).get('author') == '운영자', (st, (dn or {}).get('author')))
    st, dg = call('GET', f'/community/posts/{gone}')
    rec('A-7 탈퇴한 사람의 글 — 「(탈퇴)」', st == 200 and (dg or {}).get('author') == '(탈퇴)', (st, (dg or {}).get('author')))
    st, dp = call('GET', f'/community/posts/{pin}')
    rec('A-8 영문 이름(Alex Kim) — 첫 글자만 「AOO」', st == 200 and (dp or {}).get('author') == 'AOO', (st, (dp or {}).get('author')))
    st, dm = call('GET', f'/community/posts/{first}', A['tok'])
    rec('A-9 본인이 열어도 같은 표기(「김OO」) · 내 글 표시(mine)는 참', st == 200 and (dm or {}).get('author') == '김OO' and (dm or {}).get('mine') is True, (st, (dm or {}).get('author'), (dm or {}).get('mine')))
    st, qu = call('GET', '/admin/community/queue', adm)
    qp = [p for p in ((qu or {}).get('pending') or []) if p.get('id') == pend]
    rec('A-10 운영 검수 큐는 이름 전체 그대로(누구 글인지 알아야 함)', st == 200 and len(qp) == 1 and qp[0].get('author') == '김가람', (st, [p.get('author') for p in qp]))
    st, x = call('GET', '/admin/community/queue', A['tok'])
    rec('A-11 운영 검수 큐는 일반 회원에게 403', st == 403, st)

    # ── B ── 쪽 번호
    st, b = board()
    rec('B-1 응답 모양 — items · total · page · size · pages', st == 200 and isinstance(b, dict) and all(k in b for k in ('items', 'total', 'page', 'size', 'pages')) and isinstance(b['items'], list), (st, list((b or {}).keys()) if isinstance(b, dict) else b))
    b = b if isinstance(b, dict) else {}
    total_db = int(q("select count(*) from posts where state='PUBLISHED'"))
    rec('B-2 전체 건수(total) = DB 의 공개 글 수', b.get('total') == total_db, (b.get('total'), total_db))
    rec('B-3 기본값 — 1쪽 · 한 쪽 10건', b.get('page') == 1 and b.get('size') == 10 and len(b.get('items') or []) == min(10, total_db), (b.get('page'), b.get('size'), len(b.get('items') or [])))
    pages = []
    for n in (1, 2, 3):
        st, bb = board(f'q=%5Bcmu-{RUN}%5D&page={n}'); pages.append(bb if isinstance(bb, dict) else {})
    seen = [r['id'] for p in pages for r in (p.get('items') or [])]
    rec(f'B-4 표식 글 {pub_n}건 — 3쪽(10 · 10 · 5) · 겹침 없음 · 빠진 것 없음', [len(p.get('items') or []) for p in pages] == [10, 10, 5] and len(set(seen)) == pub_n and all(p.get('total') == pub_n and p.get('pages') == 3 for p in pages), ([len(p.get('items') or []) for p in pages], len(set(seen)), [p.get('total') for p in pages]))
    want = sql(f"select string_agg(id::text, ',' order by is_pinned desc, created_at desc) from posts where state='PUBLISHED' and title like '{MARK}%'").split(',')
    rec('B-5 순서 — 고정 글이 맨 앞 · 그 다음 최신순(DB 와 같은 순서)', seen == want and seen[:1] == [pin], (seen[:3], want[:3]))
    st, bb = board(f'q=%5Bcmu-{RUN}%5D&page=99')
    rec('B-6 범위를 넘는 쪽(99) — 빈 목록 · 건수는 그대로', st == 200 and (bb or {}).get('items') == [] and (bb or {}).get('total') == pub_n and (bb or {}).get('page') == 99, (st, bb if not isinstance(bb, dict) else {k: bb[k] for k in bb if k != 'items'}))
    st, b5 = board(f'q=%5Bcmu-{RUN}%5D&size=5'); st2, b0 = board(f'q=%5Bcmu-{RUN}%5D&size=0'); st3, b9 = board('size=999'); st4, bx = board(f'q=%5Bcmu-{RUN}%5D&size=abc')
    rec('B-7 한 쪽 건수(size) — 5 → 5건 · 5쪽 / 0 · 글자 → 기본 10 / 999 → 50 으로 낮춤', (b5 or {}).get('size') == 5 and len((b5 or {}).get('items') or []) == 5 and (b5 or {}).get('pages') == 5 and (b0 or {}).get('size') == 10 and (bx or {}).get('size') == 10 and (b9 or {}).get('size') == 50,
        ((b5 or {}).get('size'), (b5 or {}).get('pages'), (b0 or {}).get('size'), (bx or {}).get('size'), (b9 or {}).get('size'), st, st2, st3, st4))
    outs = [board(f'q=%5Bcmu-{RUN}%5D&page={v}') for v in ('0', '-3', 'abc', '1.5')]
    rec('B-8 쪽 번호가 0 · 음수 · 글자 · 소수 → 1쪽으로', all(s == 200 and (j or {}).get('page') == 1 and len((j or {}).get('items') or []) == 10 for s, j in outs), [(s, (j or {}).get('page') if isinstance(j, dict) else j) for s, j in outs])
    st, bq = board(f'q=%5Bcmu-{RUN}%5D&board=QNA&size=50')
    rec('B-9 게시판 거르기(board=QNA) — 질문 6건만', st == 200 and (bq or {}).get('total') == 6 and all(r['board'] == 'QNA' for r in (bq or {}).get('items') or []), (st, (bq or {}).get('total')))
    st, bz = board('board=NOPE')
    rec('B-10 없는 게시판 이름 → 400', st == 400, (st, str(bz)[:80]))
    it = ((pages[0].get('items') or [{}])[0])
    rec('B-11 줄의 항목 — id · board · title · views · commentCount · isPinned · createdAt · author · pendingMine (본문 · 계정 번호는 없음)', set(it.keys()) == {'id', 'board', 'title', 'state', 'views', 'commentCount', 'isPinned', 'createdAt', 'author', 'pendingMine'}, sorted(it.keys()))

    # ── C ── 검색
    st, s1 = board(f'q=%5Bcmu-{RUN}%5D+권리금&size=50')
    rec('C-1 제목의 낱말(권리금) — 질문 6건', st == 200 and (s1 or {}).get('total') == 6, (st, (s1 or {}).get('total')))
    st, s2 = board(f'q={KW}&size=50')
    rec('C-2 본문에만 있는 낱말 — 업종 이야기 16건', st == 200 and (s2 or {}).get('total') == 16, (st, (s2 or {}).get('total')))
    st, s3 = board(f'q={KW}+%EC%9D%B4%EC%95%BC%EA%B8%B0+07')
    rec('C-3 여러 낱말은 모두 들어 있는 글만(…이야기 07) — 1건', st == 200 and (s3 or {}).get('total') == 1 and '07' in ((s3 or {}).get('items') or [{}])[0].get('title', ''), (st, (s3 or {}).get('total')))
    st, s4 = board(f'q={KW}zzz')
    rec('C-4 없는 낱말 — 0건 · 0쪽', st == 200 and (s4 or {}).get('total') == 0 and (s4 or {}).get('items') == [] and (s4 or {}).get('pages') == 0, (st, s4))
    st, s5 = board(f'q={KW.upper()}&size=50')
    rec('C-5 영문 대소문자를 가리지 않음', st == 200 and (s5 or {}).get('total') == 16, (st, (s5 or {}).get('total')))
    outs = [board('q=' + v) for v in ('%25%25', '__', "%27+OR+1%3D1+--", '%5C%5C', '%3Bdrop+table+posts')]
    rec("C-6 특수 문자(%% · __ · ' OR 1=1 -- · \\\\ · ;drop) — 200 이고 전체가 나오지 않음(글자 그대로 찾음)", all(s == 200 and isinstance(j, dict) and j.get('total', 1) < total_db for s, j in outs) and q("select count(*) from posts where state='PUBLISHED'") == str(total_db), [(s, (j or {}).get('total') if isinstance(j, dict) else str(j)[:40]) for s, j in outs])
    st, s7 = board('q=' + 'ㄱ' * 51)
    rec('C-7 검색어 51자 → 400', st == 400, (st, str(s7)[:80]))
    st, s8 = board('q=' + '가' * 50)
    rec('C-8 검색어 50자 → 200', st == 200, st)
    st, s9 = board(f'q=++{KW}++&size=50')
    rec('C-9 앞뒤 · 가운데 빈칸은 무시', st == 200 and (s9 or {}).get('total') == 16, (st, (s9 or {}).get('total')))
    st, s10 = board('q=')
    rec('C-10 빈 검색어 — 전체', st == 200 and (s10 or {}).get('total') == total_db, (st, (s10 or {}).get('total'), total_db))

    st, s11 = call('GET', f'/community/board?q={KW}&q=zzz&page=1&page=2&size=50&size=5')
    rec('C-11 같은 이름을 두 번 보내도(?q=…&q=…) 500 이 아님 — 첫 값을 씀', st == 200 and (s11 or {}).get('total') == 16 and (s11 or {}).get('page') == 1 and (s11 or {}).get('size') == 50, (st, str(s11)[:120]))

    # ── D ── 보이는 범위
    allp = [r['id'] for n in (1,) for r in (board(f'q=%5Bcmu-{RUN}%5D&size=50')[1] or {}).get('items', [])]
    rec('D-1 남의 검수 대기 글 · 가려진 글 · 지운 글은 목록에 없음', pend not in allp and hid not in allp and dele not in allp and len(allp) == pub_n, (pend in allp, hid in allp, dele in allp, len(allp)))
    st, bm = board(f'q=%5Bcmu-{RUN}%5D&size=50', A['tok']); im = (bm or {}).get('items') or []
    pm = [r for r in im if r['id'] == pend]
    rec('D-2 내 검수 대기 글은 나에게만 — 목록에 있고(pendingMine) 건수도 1 늘어남', st == 200 and len(pm) == 1 and pm[0].get('pendingMine') is True and (bm or {}).get('total') == pub_n + 1, (st, len(pm), (bm or {}).get('total')))
    st, bo = board(f'q=%5Bcmu-{RUN}%5D&size=50', B['tok'])
    rec('D-3 다른 회원에게는 그 대기 글이 없음', st == 200 and pend not in [r['id'] for r in (bo or {}).get('items') or []] and (bo or {}).get('total') == pub_n, (st, (bo or {}).get('total')))
    st, dh = call('GET', f'/community/posts/{pend}', B['tok'])
    rec('D-4 남의 대기 글을 주소로 열면 「검수 중」만 — 제목 · 본문 · 작성자 없음', st == 200 and (dh or {}).get('pending') is True and not any(k in (dh or {}) for k in ('title', 'body', 'author')), (st, list((dh or {}).keys())))

    # ── E ── 기존 길
    st, e = call('GET', '/community/posts?limit=3')
    rec('E-1 GET /community/posts 는 그대로 배열 · limit 3', st == 200 and isinstance(e, list) and len(e) == min(3, total_db), (st, type(e).__name__, len(e) if isinstance(e, list) else ''))
    st, e2 = call('GET', '/community/posts?board=QNA&limit=50')
    rec('E-2 그 길의 게시판 거르기도 그대로', st == 200 and isinstance(e2, list) and all(r['board'] == 'QNA' for r in e2) and len([r for r in e2 if r['title'].startswith(MARK)]) == 6, (st, len(e2) if isinstance(e2, list) else e2))
    v0 = int(q(f"select views from posts where id='{first}'")); board(f'q={KW}'); v1 = int(q(f"select views from posts where id='{first}'"))
    rec('E-3 목록을 여는 것으로는 조회 수가 늘지 않음', v0 == v1, (v0, v1))
    # E-4 — 통합 검정의 「SQL 대조」(scripts/check-sql.js)는 `${…}` 로 조립한 SQL 을 건너뜁니다. 이 서비스의 SQL 이 조립식이 되면
    #   열 · 표 이름이 바뀌어도 그 검정이 잡지 못합니다(v10.23 첫 구현에서 5건이 건너뜀으로 빠졌음 — 확인 806 → 803). 같은 규칙으로 셉니다.
    import re
    kit = os.environ.get('KIT', '/home/claude/pkg/SGB_DevDocker_Integrated_20261002/sgb')
    src = open(kit + '/src/modules/community/community.service.ts', encoding='utf-8').read()
    lits = [m.group(1) for m in re.finditer(r'`([^`]*)`', src) if re.match(r'\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b', m.group(1), re.I)]
    dyn = [x.strip()[:60] for x in lits if '${' in x]
    rec('E-4 소개광장 서비스의 SQL 이 모두 고정 글 — 통합 검정의 「SQL 대조」가 건너뛰는 것 0', lits and not dyn, (len(lits), dyn))


if __name__ == '__main__':
    try:
        main()
    except Exception as ex:
        import traceback; traceback.print_exc(); rec('실행 중 오류', False, repr(ex)[:300])
    finally:
        try: rec('Z-1 시험 글을 모두 지움(개발 DB 에 남기지 않음)', cleanup())
        except Exception as ex: rec('Z-1 시험 글을 모두 지움(개발 DB 에 남기지 않음)', False, repr(ex)[:200])
    ok = sum(1 for r in R if r['ok'])
    json.dump({'items': R, 'pass': ok, 'total': len(R)}, open(os.path.join(OUT, 'srv_cmu.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'통과 {ok} / {len(R)}')
