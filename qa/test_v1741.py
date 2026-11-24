"""v10.741 (docs/849) 관 메인 글자 AI 초안 — 한국어 글자 제안(초안에 쓰지 않음 · 화면이 빈 칸만 채움)
  ① (코드) suggest(AI 통로 · MOCK · 길이) · 컨트롤러 · 화면 단추
  ③ (API) 글자 없는 페이지(MAL) 422
  ④ 문서 849 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, SP = rd('src/modules/site/site-layouts.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async suggest(key: string)' in SV and "'SITE_LAYOUT_SUGGEST'" in SV and "prov.name === 'MOCK'" in SV and 'data-site-layout-suggest' in SP and '!l.texts[tk]' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW)
    r = call('POST', '/admin/site-layouts/MAL/suggest', None, login('admin@x.com'))
    ok('③ 글자 없는 페이지 422', r.get('code') == 'SITE_LAYOUT_SUGGEST', str(r.get('code')))

d = doc('849_')
ok('④ 문서 849', all(w in d for w in ('AI', '글자')), str(len(d)))
ok('④ VERSION v10.741 이상', VT >= (10, 741), VER)
done()
