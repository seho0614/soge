"""v10.759 (docs/867) 파트너센터 첫 화면 안내 꾸미기(PARTNER)
  ① 스펙 · 사용자 웹 /partner
  ④ 문서 867 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, PA = rd('src/modules/site/site-layouts.service.ts'), rd('site/src/app/partner/page.tsx')
ok('① 서버 · 사용자 웹', "name: '파트너센터 첫 화면', path: '/partner'" in SV and "getLayout('PARTNER')" in PA and 'k="PARTNER" blocks={lay?.inserts.top}' in PA and '<LayoutViewPing k="PARTNER" />' in PA, '')

d = doc('867_')
ok('④ 문서 867', all(w in d for w in ('파트너센터',)), str(len(d)))
ok('④ VERSION v10.759 이상', VT >= (10, 759), VER)
done()
