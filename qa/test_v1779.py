"""v10.779 (D329 · docs/887) 소개광장 · 고객센터 · 파트너센터 구역 보이기 · 순서
  ① (코드) LAYOUT_SPECS 구역 · 사용자 웹 data-lay-sec · layCss
  ④ 문서 887 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV = rd('src/modules/site/site-layouts.service.ts')
CM, SU, PT = rd('site/src/app/community/page.tsx'), rd('site/src/app/support/page.tsx'), rd('site/src/app/partner/page.tsx')
ok('① 구역 열쇠 · 사용자 웹', "[['notices', '공지'], ['picks', '동네픽'], ['ranking', '순위 바로가기'], ['verify', '동네 인증'], ['list', '글 목록']]" in SV and "[['bot', '챗봇 상담'], ['foot', '분쟁 안내 줄']]" in SV
   and "[['prof', '업체 카드'], ['tiles', '숫자 4칸'], ['pact', '바로가기 줄']]" in SV
   and all(f'data-lay-sec="{k}"' in CM for k in ('notices', 'picks', 'ranking', 'verify', 'list')) and "layCss(lay, '[data-lay-scope=\"COMM\"]', COMM_SECS)" in CM
   and 'data-lay-sec="bot"' in SU and 'data-lay-sec="foot"' in SU and all(f'data-lay-sec="{k}"' in PT for k in ('prof', 'tiles', 'pact')), '')

d = doc('887_')
ok('④ 문서 887', all(w in d for w in ('소개광장', '파트너센터')), str(len(d)))
ok('④ VERSION v10.779 이상', VT >= (10, 779), VER)
done()
