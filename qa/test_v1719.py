"""v10.719 (docs/827) 관 안 페이지 메뉴 순서 끌어 놓기
  ① (코드) reorder(관 닫힘 · 수정 가능 · 담당자) · 컨트롤러 · 화면 끌기
  ③ (API) 열린 관 422 GWAN_PAGE_GWAN_OPEN
  ④ 문서 827 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GC, GP = rd('src/modules/site/gwan-pages.service.ts'), rd('src/modules/site/gwan-pages.controller.ts'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 화면 — 순서 10 · 20 · 언어판도 같이 · 끌기', 'async reorder(code: string, ids: number[])' in GS and 'SET sort_order = $3 WHERE gwan_code = $1 AND slug = $2' in GS and "@Post('admin/gwans/:code/pages/order')" in GC and 'data-gwan-page-drag-row' in GP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    r = call('POST', '/admin/gwans/MNY/pages/order', {'ids': [1]}, login('admin@x.com'))
    ok('③ 열린 관 순서 바꾸기 422', r.get('code') == 'GWAN_PAGE_GWAN_OPEN' or psql("SELECT is_active FROM gwans WHERE code = 'MNY'") == 'f', str(r.get('code')))

d = doc('827_')
ok('④ 문서 827', all(w in d for w in ('순서', '끌어')), str(len(d)))
ok('④ VERSION v10.719 이상', VT >= (10, 719), VER)
done()
