"""v10.723 (docs/831) 페이지 목록 찾기 · 거르기
  ① (코드) 찾기 칸 · 거르기(게시 안 한 초안 · 수정 가능 · 관 열림 · 예약)
  ④ 문서 831 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 화면 — 찾기 · 거르기 5 · 두 표 모두', 'data-site-pages-filter' in SP and all(w in SP for w in ('value="draft"', 'value="editable"', 'value="open"', 'value="sched"')) and 'lays.map((r) =>' in SP and 'pgs.map((p) =>' in SP, '')

d = doc('831_')
ok('④ 문서 831', all(w in d for w in ('찾기', '거르기')), str(len(d)))
ok('④ VERSION v10.723 이상', VT >= (10, 723), VER)
done()
