"""v10.735 (docs/843) 점검 시간 달력
  ① (코드) 달력 부품 · 관 점검 줄 · 한국 날짜
  ③ (API) site-schedules 62일 넘음 422 · 기간 응답
  ④ 문서 843 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SP, SV = rd('web/src/app/admin/SitePages.tsx'), rd('src/modules/site/site-layouts.service.ts')
ok('① 달력 — 한 달 칸 · 종류 거르기 · 점검 줄', 'function Calendar(' in SP and 'data-site-calendar-day' in SP and "MAINT: '관 점검'" in SP and 'async schedules(from: string, to: string)' in SV, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    a = call('GET', '/admin/site-schedules?from=2026-01-01&to=2026-06-01', None, TS)
    b = call('GET', '/admin/site-schedules?from=2026-12-01&to=2026-12-31', None, TS)
    ok('③ 62일 넘음 422 · 한 달 응답', a.get('code') == 'SITE_SCHEDULE_RANGE' and isinstance(b.get('items'), list) and b.get('from') == '2026-12-01', f"{a.get('code')} {b.get('from')}")

d = doc('843_')
ok('④ 문서 843', all(w in d for w in ('달력', '점검')), str(len(d)))
ok('④ VERSION v10.735 이상', VT >= (10, 735), VER)
done()
