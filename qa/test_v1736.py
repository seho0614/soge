"""v10.736 (docs/844) 페이지 게시 예약 달력 — 꾸밀 페이지 · 관 안 페이지 예약을 같은 달력에
  ① (코드) 예약 두 종류 · 화면 거르기
  ④ 문서 844 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면 — LAYOUT · PAGE 예약 · 달력 종류', "type: 'LAYOUT', at: x.at" in SV and "type: 'PAGE', at: x.at" in SV and "LAYOUT: '예약 게시', PAGE: '관 페이지 예약'" in SP, '')

d = doc('844_')
ok('④ 문서 844', all(w in d for w in ('예약', '달력')), str(len(d)))
ok('④ VERSION v10.736 이상', VT >= (10, 736), VER)
done()
