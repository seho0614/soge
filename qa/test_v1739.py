"""v10.739 (docs/847) 판 내려받기 · 올리기
  ① (코드) export · import(같은 페이지 파일만 · 검사 · 초안 · 수정 가능) · 화면
  ③ (API) 내려받기 모양 · 다른 페이지 파일 422 · 수정 불가 422
  ④ 문서 847 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async exportLayout(' in SV and 'async importLayout(' in SV and "'SITE_LAYOUT_IMPORT'" in SV and 'data-site-layout-export' in SP and 'data-site-layout-import' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ex = call('GET', '/admin/site-layouts/EARN/export', None, TS)
    bad = call('POST', '/admin/site-layouts/HOME/import', {'file': ex}, TS)
    lk = call('POST', '/admin/site-layouts/EARN/import', {'file': ex}, TS)
    ok('③ 내려받기 모양 · 다른 페이지 422 · 수정 불가(또는 관 열림) 422', ex.get('kind') == 'sogaebank.site-layout' and ex.get('key') == 'EARN' and bad.get('code') == 'SITE_LAYOUT_IMPORT'
       and lk.get('code') in ('SITE_LAYOUT_LOCKED', 'SITE_LAYOUT_GWAN_OPEN'), f"{ex.get('kind')} {bad.get('code')} {lk.get('code')}")

d = doc('847_')
ok('④ 문서 847', all(w in d for w in ('내려받기', '올리기')), str(len(d)))
ok('④ VERSION v10.739 이상', VT >= (10, 739), VER)
done()
