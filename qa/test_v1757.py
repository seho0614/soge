"""v10.757 (docs/865) 소개광장 메인 꾸미기(COMM)
  ① 스펙 · 사용자 웹 /community 띠 · 위 · 아래 · 방문
  ④ 문서 865 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, CP, LB = rd('src/modules/site/site-layouts.service.ts'), rd('site/src/app/community/page.tsx'), rd('site/src/components/layout/LayBlocks.tsx')
ok('① 서버 · 사용자 웹', "name: '소개광장 메인', path: '/community'" in SV and "getLayout('COMM', sp.lp)" in CP and 'k="COMM" blocks={lay?.inserts.top}' in CP and 'k="COMM" blocks={lay?.inserts.bottom}' in CP
   and '<LayoutViewPing k="COMM" />' in CP and 'export function LayBand(' in LB, '')

d = doc('865_')
ok('④ 문서 865', all(w in d for w in ('소개광장',)), str(len(d)))
ok('④ VERSION v10.757 이상', VT >= (10, 757), VER)
done()
