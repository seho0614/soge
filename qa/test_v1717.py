"""v10.717 (docs/825) 꾸밀 페이지 판 비교
  ① (코드) GET versions/{v} · 화면 판 고르기 · 처음 배치 · 지금 초안
  ③ (API) 없는 판 404
  ④ 문서 825 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면 — 판 하나 · 앞 판 · 뒤 판 · 처음 배치 · 지금 초안 · 비교', 'async version(key: string, version: number)' in SV and 'data-site-layout-compare-go' in SP and '<option value="draft">지금 초안</option>' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    ok('③ 없는 판 404', call('GET', '/admin/site-layouts/HOME/versions/99999', None, login('admin@x.com')).get('_err') == 404, '')

d = doc('825_')
ok('④ 문서 825', all(w in d for w in ('판 비교',)), str(len(d)))
ok('④ VERSION v10.717 이상', VT >= (10, 717), VER)
done()
