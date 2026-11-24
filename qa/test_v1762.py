"""v10.762 (docs/870) 매물 목록 블록 거르기(지역 · 배지)
  ① 블록 검사 · 사용자 웹 질의 · 운영 화면 칸
  ④ 문서 870 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GB, GPx = rd('src/modules/site/gwan-pages.service.ts'), rd('site/src/components/gwan/GwanBlocks.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 사용자 웹 · 화면', "const LIST_BADGES = ['URGENT', 'VERIFIED_DOC']" in GS and '...(region ? { regionCode: region } : {})' in GS and "qs.set('regionCode'" in GB and "qs.set('badge'" in GB and 'data-block-listings-badge' in GPx, '')

d = doc('870_')
ok('④ 문서 870', all(w in d for w in ('지역', '배지')), str(len(d)))
ok('④ VERSION v10.762 이상', VT >= (10, 762), VER)
done()
