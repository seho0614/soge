"""v10.772 (D328 · docs/880) 게시 두 사람 승인
  ① 설정 · 칸 · 승인 갈래 · 화면
  ④ 문서 880 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, RS, SPg = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/modules/site/publish-requests.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 서버 · 화면', "('site.publish_two_person', 'off', 'SUPER'" in M and 'ADD COLUMN IF NOT EXISTS first_approved_by uuid' in M and "'PUBLISH_REQ_SAME_PERSON'" in RS and "return { id, status: 'OPEN', firstApproved: true }" in RS and 'data-publish-request-first' in SPg, '')

d = doc('880_')
ok('④ 문서 880', all(w in d for w in ('두 사람',)), str(len(d)))
ok('④ VERSION v10.772 이상', VT >= (10, 772), VER)
done()
