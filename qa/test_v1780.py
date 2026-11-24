"""v10.780 (D329 · docs/888) 소개몰 상품 상세 분류마다 · 상품마다
  ① (코드) mall_item_layouts · 서비스(같은 규칙 · 게시 권한) · 공개 for · 사용자 웹 상품 > 분류 · 화면
  ③ (API) 없는 범위 422 · for 빈 값 null · 회원 403
  ④ 문서 888 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, PG, SP, AM = rd('prisma/migrations/D329_bundle5_open_prep/migration.sql'), rd('src/modules/site/mall-item-layouts.ts'), rd('site/src/app/health/p/[code]/page.tsx'), rd('web/src/app/admin/SitePages.tsx'), rd('src/app/app.module.ts') or rd('src/app.module.ts')
ok('① 표 · 서버 · 사용자 웹 · 화면', 'CREATE TABLE IF NOT EXISTS public.mall_item_layouts' in M and 'await this.layouts.assertItemEditable();' in SV and 'await assertPublisher(this.db);' in SV
   and "ORDER BY (scope = 'PRODUCT') DESC LIMIT 1" in SV and '/mall-item-layouts/for?' in PG and 'function MallItemOverrides(' in SP and 'MallItemLayoutsController' in AM, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS = login('admin@x.com')
    a = call('GET', '/admin/mall-item-layouts/NOPE/X1', None, TS)
    f = call('GET', '/mall-item-layouts/for')
    ok('③ 없는 범위 422 · for 빈 값 null · 회원 403', a.get('code') == 'MALL_ITEM_SCOPE' and f.get('layout') is None and call('GET', '/admin/mall-item-layouts', None, login('buyer@x.com')).get('_err') == 403, f"{a.get('code')} {f}")

d = doc('888_')
ok('④ 문서 888', all(w in d for w in ('분류', '상품')), str(len(d)))
ok('④ VERSION v10.780 이상', VT >= (10, 780), VER)
done()
