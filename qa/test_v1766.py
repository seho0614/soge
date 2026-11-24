"""v10.766 (D328 · docs/874) 관별 1:1 문의 답변 틀
  ① 칸 · 컨트롤러 · 화면(그 관 틀 먼저)
  ③ 없는 관 422
  ④ 문서 874 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, IC, ID = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/modules/support/inquiry-template.controller.ts'), rd('web/src/app/admin/InquiryDesk.tsx')
ok('① 표 · 서버 · 화면', 'ADD COLUMN IF NOT EXISTS gwan_code text REFERENCES public.gwans(code)' in M and "'TEMPLATE_GWAN'" in IC and 't.gwan_code AS "gwanCode"' in IC and 'data-inquiry-tpl-gwan' in ID and 't.gwanCode === d.sourceGwan' in ID, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    r = call('POST', '/admin/inquiry-templates', {'title': '시험 1766', 'body': '시험 1766 글', 'gwanCode': 'ZZNOPE'}, TS)
    ok('③ 없는 관 422', r.get('code') == 'TEMPLATE_GWAN', str(r)[:100])
    psql("DELETE FROM inquiry_templates WHERE title = '시험 1766'")

d = doc('874_')
ok('④ 문서 874', all(w in d for w in ('답변 틀',)), str(len(d)))
ok('④ VERSION v10.766 이상', VT >= (10, 766), VER)
done()
