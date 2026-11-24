"""v10.743 (docs/851) 페이지 목록 CSV — 상태 · 수정 · 관 · 7일 방문 · 예약 · 30일 의견
  ① (코드) sitePagesCsv · 컨트롤러 · 화면 단추
  ③ (API) CSV 머리 · 꾸밀 페이지 7줄 이상
  ④ 문서 851 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async sitePagesCsv()' in SV and 'data-site-pages-csv' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    r = call('GET', '/admin/site-pages.csv', None, login('admin@x.com'))
    ok('③ CSV 머리 · 7줄 이상', '구분,페이지,주소,상태' in r.get('csv', '') and (r.get('rows') or 0) >= 7, str(r.get('rows')))

d = doc('851_')
ok('④ 문서 851', all(w in d for w in ('CSV', '페이지 목록')), str(len(d)))
ok('④ VERSION v10.743 이상', VT >= (10, 743), VER)
done()
