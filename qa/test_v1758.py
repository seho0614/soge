"""v10.758 (docs/866) 고객센터 홈 꾸미기(HELP)
  ① 스펙 · 사용자 웹 /support
  ④ 문서 866 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SU = rd('src/modules/site/site-layouts.service.ts'), rd('site/src/app/support/page.tsx')
ok('① 서버 · 사용자 웹', "name: '고객센터 홈', path: '/support'" in SV and "getLayout('HELP', (await searchParams)?.lp)" in SU and 'k="HELP" blocks={lay?.inserts.top}' in SU and '<LayoutViewPing k="HELP" />' in SU, '')

d = doc('866_')
ok('④ 문서 866', all(w in d for w in ('고객센터',)), str(len(d)))
ok('④ VERSION v10.758 이상', VT >= (10, 758), VER)
done()
