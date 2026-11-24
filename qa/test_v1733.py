"""v10.733 (docs/841) 관 메인 배치 복사
  ① (코드) copyFrom(같은 열쇠 구역 · 글자 · 위 · 아래 · 맨 위) · 컨트롤러 · 화면
  ③ (API) 같은 페이지 422 · 수정 불가 422 — 끝나면 처음
  ④ 문서 841 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, CT, SP = rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/site/site-layouts.controller.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async copyFrom(key: string, from: string)' in SV and "'SITE_LAYOUT_COPY'" in SV and "@Post('admin/site-layouts/:key/copy-from')" in CT and 'data-site-layout-copy-go' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    TS = login('admin@x.com')
    a = call('POST', '/admin/site-layouts/BIZ/copy-from', {'from': 'BIZ'}, TS)
    b = call('POST', '/admin/site-layouts/BIZ/copy-from', {'from': 'MAL'}, TS)
    ok('③ 같은 페이지 422 · 수정 불가(처음) 422', a.get('code') == 'SITE_LAYOUT_COPY' and b.get('code') in ('SITE_LAYOUT_LOCKED', 'SITE_LAYOUT_GWAN_OPEN'), f"{a.get('code')} {b.get('code')}")

d = doc('841_')
ok('④ 문서 841', all(w in d for w in ('배치 복사',)), str(len(d)))
ok('④ VERSION v10.733 이상', VT >= (10, 733), VER)
done()
