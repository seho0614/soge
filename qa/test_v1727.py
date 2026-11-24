"""v10.727 (D325 · docs/835) 관 열기 · 닫기 기록
  ① (코드) gwan_open_log(쌓기만) · 운영 화면 updateGwan · 점검 tick · 목록 · 화면
  ② (DB) 고치기 막힘
  ④ 문서 835 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SS, MS, SP = rd('prisma/migrations/D325_pages_ops_bundle/migration.sql'), rd('src/modules/site/site.service.ts'), rd('src/modules/site/gwan-maint.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 두 곳에서 남김 · 목록 · 화면', 'GWAN_OPEN_LOG_RO:' in M and "INSERT INTO gwan_open_log (gwan_code, opened, source, by) VALUES ($1, $2, 'ADMIN', $3)" in SS and "VALUES ($1, false, 'MAINT', $2)" in MS and 'async openLog(' in MS and 'function OpenLog(' in SP, '')
if up():
    ok('② DB — 기록 고치기 막힘', 'GWAN_OPEN_LOG_RO' in psql("BEGIN; INSERT INTO gwan_open_log (gwan_code, opened, source) VALUES ('LED', true, 'ADMIN'); UPDATE gwan_open_log SET opened = false WHERE gwan_code = 'LED'; ROLLBACK;"), '')

d = doc('835_')
ok('④ 문서 835', all(w in d for w in ('열기', '닫기', '기록')), str(len(d)))
ok('④ VERSION v10.727 이상', VT >= (10, 727), VER)
done()
