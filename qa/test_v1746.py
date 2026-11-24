"""v10.746 (docs/854) 블록 복제 · 다른 자리로 옮기기
  ① (코드) BlockList 복제 · 옮기기 · 꾸밀 페이지 자리 목록
  ④ 문서 854 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GP, SP = rd('web/src/app/admin/gwans/GwanPages.tsx'), rd('web/src/app/admin/SitePages.tsx')
ok('① 화면', 'data-block-list-dup' in GP and 'data-block-list-move' in GP and 'onMoveOut' in SP and 'const allSpots' in SP, '')

d = doc('854_')
ok('④ 문서 854', all(w in d for w in ('복제', '옮기')), str(len(d)))
ok('④ VERSION v10.746 이상', VT >= (10, 746), VER)
done()
