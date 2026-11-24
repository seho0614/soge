"""v10.753 (docs/861) 점검 예약할 때 그날 일정 미리 보기
  ① (코드) 그날 site-schedules · 칩
  ④ 문서 861 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP = rd('web/src/app/admin/SitePages.tsx')
ok('① 화면', 'data-gwan-maint-near' in SP and '/admin/site-schedules?from=${day}&to=${day}' in SP, '')

d = doc('861_')
ok('④ 문서 861', all(w in d for w in ('그날',)), str(len(d)))
ok('④ VERSION v10.753 이상', VT >= (10, 753), VER)
done()
