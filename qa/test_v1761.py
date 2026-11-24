"""v10.761 (docs/869) 이번 주 추천 자동 블록(PICKS)
  ① 블록 검사 · 사용자 웹 · 운영 화면 블록 칸
  ④ 문서 869 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GS, GB, GPx = rd('src/modules/site/gwan-pages.service.ts'), rd('site/src/components/gwan/GwanBlocks.tsx'), rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 서버 · 사용자 웹 · 화면', "'FEEDBACK', 'PICKS'] as const" in GS and "case 'PICKS': return { type: 'PICKS'" in GS and "case 'PICKS': return <section" in GB and "sort: b.mode === 'NEW' ? 'RECENT' : 'POPULAR'" in GB
   and "KINDS.push(['PICKS'" in GPx and 'data-block-picks-mode' in GPx, '')

d = doc('869_')
ok('④ 문서 869', all(w in d for w in ('이번 주 추천',)), str(len(d)))
ok('④ VERSION v10.761 이상', VT >= (10, 761), VER)
done()
