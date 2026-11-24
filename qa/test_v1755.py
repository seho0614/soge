"""v10.755 (D328 · docs/863) 소개몰 상품 상세 꾸미기(MALL_ITEM)
  ① 표 CHECK · 열쇠 · 스펙 · 관 규칙 HLT · 사용자 웹 상품 상세
  ③ 공개 응답
  ④ 문서 863 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

M, SV, PD = rd('prisma/migrations/D328_pages_ops_more3/migration.sql'), rd('src/modules/site/site-layouts.service.ts'), rd('site/src/app/health/p/[code]/page.tsx')
ok('① 표 · 서버 · 사용자 웹', "'COMM', 'HELP', 'PARTNER', 'MALL_ITEM'))" in M and "INSERT INTO public.site_layouts (key) VALUES ('COMM'), ('HELP'), ('PARTNER'), ('MALL_ITEM')" in M
   and "MALL_ITEM: 'HLT' }" in SV and "name: '소개몰 상품 상세(모든 상품)'" in SV and "getLayout('MALL_ITEM', sp.lp)" in PD and 'k="MALL_ITEM"' in PD, '')
if up():
    r = call('GET', '/site-layouts/MALL_ITEM')
    ok('③ 공개 응답 — key · layout(없으면 null)', r.get('key') == 'MALL_ITEM' and 'layout' in r, str(r)[:120])

d = doc('863_')
ok('④ 문서 863', all(w in d for w in ('상품 상세',)), str(len(d)))
ok('④ VERSION v10.755 이상', VT >= (10, 755), VER)
done()
