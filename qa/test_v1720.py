"""v10.720 (docs/828) 공통 조각을 꾸밀 페이지에서도
  ① (코드) cleanLayout 조각 받음 · 공개 때 펼침(expandLayout · 못 읽으면 그 블록만 뺌)
  ④ 문서 828 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV = rd('src/modules/site/site-layouts.service.ts')
ok('① 조각 — 받음 · 공개 · 미리보기 때 펼침', 'cleanBlocks(raw, { max: 10 })' in SV and 'private async expandLayout(' in SV and 'await this.expandLayout(cleanLayoutSafe(k, r.published))' in SV and 'await this.expandLayout(cleanLayoutSafe(k, r.draft))' in SV, '')

d = doc('828_')
ok('④ 문서 828', all(w in d for w in ('공통 조각',)), str(len(d)))
ok('④ VERSION v10.720 이상', VT >= (10, 720), VER)
done()
