"""v10.773 (docs/881) 페이지 게시 기록 CSV(감사)
  ① publishLogCsv · 컨트롤러 · 화면
  ③ CSV 모양(BOM · 머리)
  ④ 문서 881 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, CT, SPg = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async publishLogCsv(month: string)' in SV and "@Get('admin/site-pages/publish-log.csv')" in CT and 'data-site-pages-publish-log' in SPg, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    r = call('GET', '/admin/site-pages/publish-log.csv?month=2026-11', None, TS)
    ok('③ CSV 모양', str(r.get('csv', '')).startswith('\ufeff때(UTC),구분,페이지,판') and r.get('month') == '2026-11', str(r)[:100])

d = doc('881_')
ok('④ 문서 881', all(w in d for w in ('게시 기록',)), str(len(d)))
ok('④ VERSION v10.773 이상', VT >= (10, 773), VER)
done()
