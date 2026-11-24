"""v10.751 (docs/859) 편집 화면 기간 밖 블록 표시
  ① (코드) BlockList 「지금 안 보임」
  ④ 문서 859 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

GP = rd('web/src/app/admin/gwans/GwanPages.tsx')
ok('① 화면', 'data-block-list-hidden' in GP and '지금 안 보임(기간' in GP, '')

d = doc('859_')
ok('④ 문서 859', all(w in d for w in ('기간',)), str(len(d)))
ok('④ VERSION v10.751 이상', VT >= (10, 751), VER)
done()
