"""v10.750 (D327 · docs/858) 게시된 페이지 깨진 링크 매일 점검
  ① (코드) linkCheck(사이트 안 링크 · 200개 · 그림 뺌 · 404 만) · 정기 작업 이름 3곳 · job_schedules 05:10
  ④ 문서 858 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, MS, SC, WC = rd('prisma/migrations/D327_pages_ops_more2/migration.sql'), rd('src/modules/site/gwan-maint.service.ts'), rd('src/worker/scheduler.service.ts'), rd('src/worker/worker.controller.ts')
ok('① 서버 · 정기 작업', 'async linkCheck()' in MS and "'PAGE_LINK_BROKEN', 'WARN'" in MS and ".slice(0, 200)" in MS and "case 'page_link_check':" in SC and "'page_link_check'," in WC and "VALUES ('page_link_check', 1440, 5, 10" in M, '')

d = doc('858_')
ok('④ 문서 858', all(w in d for w in ('깨진 링크', '05:10')), str(len(d)))
ok('④ VERSION v10.750 이상', VT >= (10, 750), VER)
done()
