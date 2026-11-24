"""v10.716 (docs/824) 여러 페이지 한꺼번에 예약 게시(SUPER)
  ① (코드) scheduleBatch · 컨트롤러 SUPER · 화면 고르기 · 한꺼번에 예약
  ③ (API) 수정 불가 페이지는 줄마다 실패 · 회원 403
  ④ 문서 824 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, CT, SP = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면 — 하나씩 같은 규칙 · 결과 줄마다 · SUPER · 고르기 · 예약', 'async scheduleBatch(' in SV and "@Post('admin/site-layouts/schedule-batch')" in CT and 'data-site-pages-batch-go' in SP and 'data-site-page-pick' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    TS, TB = login('admin@x.com'), login('buyer@x.com')
    at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 7200))
    r = call('POST', '/admin/site-layouts/schedule-batch', {'keys': ['HOME', 'MNY'], 'at': at}, TS)
    ok('③ 수정 불가(처음) — 줄마다 실패 · 예약 0 · 회원 403', r.get('scheduled') == 0 and all(not x.get('ok') for x in r.get('items', [])) and len(r.get('items', [])) == 2
       and call('POST', '/admin/site-layouts/schedule-batch', {'keys': ['HOME'], 'at': at}, TB).get('_err') == 403, str(r))

d = doc('824_')
ok('④ 문서 824', all(w in d for w in ('한꺼번에', '예약 게시')), str(len(d)))
ok('④ VERSION v10.716 이상', VT >= (10, 716), VER)
done()
