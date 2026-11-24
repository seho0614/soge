"""v10.734 (D326 · docs/842) 운영자 게시판 페이지 자동 글 — 종류 PAGES · 스위치 ops.board_pages(처음 on)
  ① (코드) D326 CHECK · 설정 · pagesBoard · 붙는 곳(꾸밀 페이지 · 관 페이지 게시 · 숨김 · 점검 · 게시 요청) · 게시판 화면 이름
  ② (DB) PAGES 글 넣기 됨(fn_ops_board_post · 되돌림)
  ④ 문서 842 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, PB, OB = rd('prisma/migrations/D326_pages_ops_more/migration.sql'), rd('src/modules/site/pages-board.ts'), rd('web/src/app/admin/OpsBoard.tsx')
SV, GS, MS, RQ = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-maint.service.ts'), rd('src/modules/site/publish-requests.service.ts')
ok('① D326 · 도우미 · 화면', "'STAFF', 'PAGES'))" in M and "('ops.board_pages', 'on'" in M and "s.value === 'off'" in PB and "opsBoardPost(db, 'PAGES'" in PB and "PAGES: '페이지 · 점검'" in OB, '')
ok('① 붙는 곳 4', 'await pagesBoard(this.db, title);' in SV and "code === 'GWAN_PAGE_PUBLISHED' || code === 'GWAN_PAGE_HIDDEN'" in GS and 'await pagesBoard(this.db, title);' in MS and 'pagesBoard(this.db, `게시 요청 승인' in RQ, '')
if up():
    r = psql("BEGIN; SELECT fn_ops_board_post('PAGES', '시험 1734', '시험', NULL, NULL) IS NOT NULL; ROLLBACK;")
    ok('② DB — PAGES 글 넣기 됨', r.splitlines()[0] == 't' if r else False, r)

d = doc('842_')
ok('④ 문서 842', all(w in d for w in ('운영자 게시판', '자동 글')), str(len(d)))
ok('④ VERSION v10.734 이상', VT >= (10, 734), VER)
done()
