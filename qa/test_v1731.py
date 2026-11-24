"""v10.731 (docs/839) 페이지 바뀐 기록 월보 — 게시 · 되돌림 · 관 안 페이지 게시 · 게시 요청 한 줄
  ① (코드) pagesLine · reportView pages · 화면
  ③ (API) 월보에 pages 줄
  ④ 문서 839 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, RP, RT = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/admin/report-period.ts'), rd('web/src/app/admin/Report.tsx')
ok('① 서버 · 화면', 'export async function pagesLine(' in SV and "pages: kind === 'MONTH' ? await pagesLine(db, r.from, r.to)" in RP and 'data-rpt-pages' in RT, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    ym = psql("SELECT to_char((now() AT TIME ZONE 'Asia/Seoul') - interval '1 month', 'YYYY-MM')")
    r = call('GET', f'/admin/work-reports/view?kind=MONTH&period={ym}', None, login('admin@x.com'))
    ok('③ 월보 pages 줄', '페이지 게시' in (r.get('pages') or {}).get('text', ''), str(r.get('pages') or r.get('_err')))

d = doc('839_')
ok('④ 문서 839', all(w in d for w in ('월보', '페이지 게시')), str(len(d)))
ok('④ VERSION v10.731 이상', VT >= (10, 731), VER)
done()
