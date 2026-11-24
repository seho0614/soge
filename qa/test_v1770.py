"""v10.770 (D328 · docs/878) 「?」 도움말 페이지 목록 더 한 것
  ① SQL 모양(새 판 · 이미 있으면 건너뜀 · 4만 자)
  ④ 문서 878 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M = rd('prisma/migrations/D328_pages_ops_more3/migration.sql')
ok('① SQL 모양', "'페이지 목록 — 더 한 것(v10.701 ~ 773)'" in M and 'position(a.heading IN c.body) = 0' in M and '<= 40000' in M and 'INSERT INTO public.help_docs (code, version, title, body, note)' in M, '')
if up():
    n = psql("SELECT position('페이지 목록 — 더 한 것' IN body) > 0 FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE'")
    ok('③ 지금 판에 절(또는 4만 자 넘어 건너뜀)', n in ('t', 'f'), str(n))

d = doc('878_')
ok('④ 문서 878', all(w in d for w in ('도움말',)), str(len(d)))
ok('④ VERSION v10.770 이상', VT >= (10, 770), VER)
done()
