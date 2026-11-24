"""v10.730 (docs/838) 꾸밀 페이지 접근성 자동 점검 — 큰 제목 하나 · 끝난 기간 블록
  ① (코드) checkLayout 추가 규칙
  ④ 문서 838 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 점검 — 머리 띠 블록 둘 이상 · 큰 제목 있는 페이지 · 끝난 기간', '큰 제목) 블록이' in SP and '이미 큰 제목이 있습니다' in SP and '보이는 기간이 끝났습니다' in SP, '')

d = doc('838_')
ok('④ 문서 838', all(w in d for w in ('접근성', '큰 제목')), str(len(d)))
ok('④ VERSION v10.730 이상', VT >= (10, 730), VER)
done()
