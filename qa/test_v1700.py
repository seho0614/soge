"""v10.700 (docs/808) 페이지 목록 관리 — 운영 화면 › 관 관리 › 페이지 목록(새 탭)
  ① (코드) 메뉴 · 탭 · 역할 · 화면(위 표 · 아래 표 · 편집 · 게시 SUPER · 예약 · 미리보기 · 판 기록 · 상품 고르기) · BlockList · 도움말 절(D321 hdx) · screens.json · 문서 804 ~ 808
  ③ (API) GET /admin/site-pages — 꾸밀 페이지 6(열쇠 · 이름 · 주소 · 상태) · 관 안 페이지(7일 방문 칸) · 회원 403 · 도움말 지금 판에 [site-pages] 절 · 잇기
  ④ 판
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

AM, APP, SP, GPG = rd('web/src/lib/adminMenu.ts'), rd('web/src/App.tsx'), rd('web/src/app/admin/SitePages.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
M, SJ = rd('prisma/migrations/D321_site_layouts/migration.sql'), rd('spec/screens.json')
ok('① 메뉴 · 탭 — 관 관리 › 페이지 목록 · ADMIN · SUPER · 화면 머리글 SB-ADM-PAGE-020',
   "['site-pages', '페이지 목록']" in AM and "tabs: ['gwans', 'site-pages'," in AM and "screen: 'SB-ADM-PAGE-020'" in AM
   and "{tab === 'site-pages' && <SitePages isSuper={roles.includes('SUPER')} onGo={go} />}" in APP and "'site-pages': ['ADMIN', 'SUPER']" in APP, '')
ok('① 화면 — 위 표 6 · 아래 표(관 안 페이지 · 7일 방문) · 편집(글 · 안내 장 · 구역 ↑ ↓ · 자리 블록 · 상품 고르기) · 게시 SUPER · 예약 · 미리보기 · 판 기록 · 저장 안 한 고침',
   all(w in SP for w in ('data-site-page-layout', 'data-site-page-row', 'p.views7', 'data-site-layout-texts', 'data-site-layout-slides', 'data-lay-sec', 'data-lay-spot',
                         'data-site-layout-picks', 'data-site-layout-publish', "{isSuper && <button className=\"btn-ok\"", 'data-site-layout-schedule', 'data-site-layout-preview-new',
                         'data-site-layout-rollback', 'beforeunload', "'/admin/site-pages'"))
   and 'export function BlockList(' in GPG and 'const spot = (a: string, label: string) =>' in SP, '')
ok('① 도움말 · 명세 — D321 「페이지 목록 [site-pages]」 절 · 잇기 · screens.json SB-ADM-PAGE-020 · 공개 API 를 메인 · 관 메인 화면에',
   "'site-pages', '페이지 목록 [site-pages]', $hdx$" in M and "x.k = 'site-pages'" in M
   and (lambda d: any(s.get('id') == 'SB-ADM-PAGE-020' and 'GET /admin/site-pages' in s.get('apis', []) for s in d.get('screens', []))
        and sum('GET /site-layouts/{key}' in s.get('apis', []) for s in d.get('screens', [])) >= 6)(json.loads(SJ or '{}')), '')
ok('① 문서 804 ~ 808', all(doc(p) for p in ('804_', '805_', '806_', '807_', '808_')) and '페이지 목록' in doc('808_'), '')

if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    sp = call('GET', '/admin/site-pages', None, TS)
    ly = sp.get('layouts') or []
    ok('③ 페이지 목록 — 꾸밀 페이지 6(열쇠 · 주소 · 상태) · 관 안 페이지 목록(7일 방문 칸)', [x.get('key') for x in ly][:6] == ['HOME', 'MNY', 'MAL', 'BIZ', 'LED', 'HLT']
       and all(x.get('status') in ('DEFAULT', 'PUBLISHED') and x.get('path', '').startswith('/') for x in ly) and isinstance(sp.get('pages'), list)
       and all('views7' in p for p in sp.get('pages', [])), str([x.get('key') for x in ly]))
    ok('③ 회원 403', call('GET', '/admin/site-pages', None, TB).get('_err') == 403, '')
    ok('③ 도움말 지금 판에 [site-pages] 절 · 탭 잇기', psql("SELECT position('[site-pages]' IN body) > 0 FROM v_help_doc_current WHERE code = 'ADMIN_GUIDE'") == 't'
       and psql("SELECT doc_code FROM sec2_tab_help WHERE tab_key = 'site-pages'") == 'ADMIN_GUIDE', '')
else:
    print('API · DB 없음 — ③ 건너뜀')

ok('④ VERSION v10.700 이상', VT >= (10, 700), VER)
done()
