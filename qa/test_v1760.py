"""v10.760 (D328 · docs/868) 꾸밀 페이지 A/B 비교
  ① 표 · 서버(시작 · 끝 · 공개 ab · 방문 v) · 사용자 웹(쿠키 · 고르기 · 방문) · 화면
  ③ 목록 모양 · 게시 판 없는 페이지 시작 422(MALL_ITEM)
  ④ 문서 868 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, CT, LY, PX, PG, SPg = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('site/src/lib/layout.ts'), rd('site/src/proxy.ts'), rd('site/src/components/layout/LayoutViewPing.tsx'), rd('web/src/app/admin/SitePages.tsx')
ok('① 표 · 서버 · 사용자 웹 · 화면', 'CREATE UNIQUE INDEX IF NOT EXISTS site_layout_ab_running_uq' in M and "ends_at <= starts_at + interval '31 days'" in M
   and 'async abStart(key: string, days: number)' in SV and 'async abEnd(key: string, winner: string)' in SV and 'ab: ab ? { id: ab.id' in SV and 'INSERT INTO site_layout_ab_views' in SV
   and "@Post('admin/site-layouts/:key/ab/end')" in CT and "get('sgb_ab')?.value === 'b'" in LY and "const AB = 'sgb_ab'" in PX and 'sgb_ab=([ab])' in PG and 'data-site-layout-ab-start' in SPg, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    ls = call('GET', '/admin/site-layouts/MALL_ITEM/ab', None, TS)
    pub = psql("SELECT published IS NOT NULL FROM site_layouts WHERE key = 'MALL_ITEM'")
    st = call('POST', '/admin/site-layouts/MALL_ITEM/ab', {'days': 3}, TS)
    if isinstance(st.get('items'), list):
        call('POST', '/admin/site-layouts/MALL_ITEM/ab/end', {'winner': 'A'}, TS)   # 시작됐으면 바로 끝냄(A 그대로)
    ok('③ 목록 모양 · 게시 판 없으면 422(또는 수정 불가 422)', isinstance(ls.get('items'), list) and (pub == 't' or st.get('code') in ('SITE_LAYOUT_AB', 'SITE_LAYOUT_LOCKED')), f"{pub} {st.get('code')}")

d = doc('868_')
ok('④ 문서 868', all(w in d for w in ('A/B',)), str(len(d)))
ok('④ VERSION v10.760 이상', VT >= (10, 760), VER)
done()
