"""v10.783 (D329 · docs/891) 택배사 조회 주소 확인
  ① (코드) HltCarriersService(고치면 확인 지움 · 확인함) · 컨트롤러 · 화면 · 송장 입력 · 회원 조회는 이미 있음
  ③ (API) 목록 5곳 · 나쁜 주소 400 · 422(바꾸지 않음)
  ④ 문서 891 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

import urllib.parse
SV, UI, CO = rd('src/modules/health/hlt-carriers.ts'), rd('web/src/app/admin/HealthOrders.tsx'), rd('src/modules/health/health-checkout.service.ts')
ok('① 서버 · 화면 · 이미 있는 조회', "checked_at = NULL, note = '주소 고침 — 다시 확인 필요'" in SV and "SET checked_at = now(), note = '운영 확인함'" in SV and 'function Carriers(' in UI and 'data-hlt-carrier-check' in UI
   and "replace(c.track_url, '{no}'" in CO, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    r = call('GET', '/admin/hlt-carriers', None, TS)
    b = call('PUT', '/admin/hlt-carriers/' + urllib.parse.quote('CJ대한통운'), {'trackUrl': 'http://bad.example/x'}, TS)
    ok('③ 목록 5곳 · 나쁜 주소 막음', isinstance(r, list) and len(r) >= 5 and b.get('_err') in (400, 422), f"{len(r) if isinstance(r, list) else r} {b.get('_err')}")

d = doc('891_')
ok('④ 문서 891', all(w in d for w in ('택배사',)), str(len(d)))
ok('④ VERSION v10.783 이상', VT >= (10, 783), VER)
done()
