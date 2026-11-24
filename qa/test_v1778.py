"""v10.778 (D329 · docs/886) 꾸밀 페이지 검색 · 공유 설명 · 공유 그림
  ① (코드) cleanLayout seoDesc · ogImage · 화면 칸 · layMeta · 메타 9곳
  ④ 문서 886 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP, LY = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx'), rd('site/src/lib/layout.ts')
MT = [rd(f'site/src/app/{f}') for f in ('page.tsx', 'earn/page.tsx', 'lead/page.tsx', 'community/page.tsx', 'support/page.tsx', '[gwan]/page.tsx')]
ok('① 서버 · 화면 · 사용자 웹 메타', "txt(o.texts?.seoDesc, 160, '검색 · 공유 설명')" in SV and "link(o.texts?.ogImage, '공유 그림')" in SV and 'data-site-layout-seo-desc' in SP
   and 'export async function layMeta(key: LayKey)' in LY and all('layMeta(' in m for m in MT), str([('layMeta(' in m) for m in MT]))

d = doc('886_')
ok('④ 문서 886', all(w in d for w in ('seoDesc', '공유 그림')), str(len(d)))
ok('④ VERSION v10.778 이상', VT >= (10, 778), VER)
done()
