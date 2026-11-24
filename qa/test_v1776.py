"""v10.776 (D329 · docs/884) 처리방침 1.2 초안 — 사이트 이용 기록
  ① (코드) D329 초안 넣기(게시판 그대로 · 이미 있으면 건너뜀 · 제13조 앞)
  ③ (DB) 처리방침 초안에 sgb_ab · 1년 · 게시 안 됨
  ④ 문서 884 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D329_bundle5_open_prep/migration.sql')
ok('① D329 — 초안(DRAFT) · 게시판 그대로 · 건너뜀 · 제13조 앞 · 퍼센트 없는 RAISE', "'infinity', 'DRAFT'" in M and "body LIKE '%sgb_ab%'" in M and "position(E'\\n## 제13조 (변경)' in r.body)" in M
   and '90일' in M and '1년이 지나면 자동으로 파기' in M and not any('%' in ln for ln in M.splitlines() if 'RAISE' in ln), '')
if up():
    st = psql("SELECT status FROM terms WHERE code = 'PRIVACY' AND body LIKE '%sgb_ab%' ORDER BY effective_from DESC, version DESC LIMIT 1")
    ok('③ 처리방침 초안 — sgb_ab · 게시 안 됨', st in ('DRAFT', 'LEGAL_REVIEW', 'ARCHIVED') or psql("SELECT count(*) FROM terms WHERE code = 'PRIVACY'") == '0', st)

d = doc('884_')
ok('④ 문서 884', all(w in d for w in ('sgb_ab', '1년')), str(len(d)))
ok('④ VERSION v10.776 이상', VT >= (10, 776), VER)
done()
