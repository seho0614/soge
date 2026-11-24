"""v10.747 (docs/855) 관 안 페이지 공개 범위 한꺼번에
  ① (코드) setVisibilityAll(첫 화면 빼고 · 수정 불가 건너뜀 · 관 닫힘) · 컨트롤러 · 화면
  ③ (API) 열린 관(MNY) 422 · 닫힌 관(LED) 바꿈 — 끝나면 지움
  ④ 문서 855 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GP = rd('src/modules/site/gwan-pages.service.ts'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 화면', 'async setVisibilityAll(code: string, visibility: string)' in GS and "slug <> 'home' AND editable" in GS and 'data-gwan-pages-visibility-all' in GP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    a = call('POST', '/admin/gwans/MNY/pages/visibility', {'visibility': 'MEMBER'}, TS)
    ok('③ 열린 관 422', a.get('code') == 'GWAN_PAGE_GWAN_OPEN' or psql("SELECT is_active FROM gwans WHERE code = 'MNY'") == 'f', str(a.get('code')))
    if psql("SELECT is_active FROM gwans WHERE code = 'LED'") == 'f':
        sl = 't1747' + time.strftime('%H%M%S')
        try:
            call('POST', '/admin/gwans/LED/pages', {'slug': sl, 'title': '시험 1747'}, TS)
            b = call('POST', '/admin/gwans/LED/pages/visibility', {'visibility': 'MEMBER'}, TS)
            ok('③ 닫힌 관 — 바꿈 · 회원만', b.get('changed', 0) >= 1 and psql(f"SELECT visibility FROM gwan_pages WHERE gwan_code = 'LED' AND slug = '{sl}'") == 'MEMBER', str(b.get('changed')))
        finally:
            psql(f"DELETE FROM gwan_pages WHERE gwan_code = 'LED' AND slug = '{sl}'")

d = doc('855_')
ok('④ 문서 855', all(w in d for w in ('공개 범위', '한꺼번에')), str(len(d)))
ok('④ VERSION v10.747 이상', VT >= (10, 747), VER)
done()
