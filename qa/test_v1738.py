"""v10.738 (docs/846) 한 줄 의견 CSV
  ① (코드) csv 도우미(BOM · 수식 막음) · 서버 · 화면 단추
  ③ (API) CSV 머리 · 회원 403
  ④ 문서 846 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

CS, PF, SP = rd('src/modules/site/csv.ts'), rd('src/modules/site/page-feedback.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① CSV — BOM · =+-@ 앞에 따옴표 · 서버 · 단추', "'\\uFEFF'" in CS and "/^[=+\\-@]/" in CS and 'async csv(days = 30)' in PF and 'data-page-feedback-csv' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    r = call('GET', '/admin/page-feedback.csv?days=7', None, login('admin@x.com'))
    ok('③ CSV 머리 · 회원 403', '때(UTC),종류,페이지,도움됨,한 줄 의견' in r.get('csv', '') and call('GET', '/admin/page-feedback.csv', None, login('buyer@x.com')).get('_err') == 403, str(r.get('filename')))

d = doc('846_')
ok('④ 문서 846', all(w in d for w in ('CSV',)), str(len(d)))
ok('④ VERSION v10.738 이상', VT >= (10, 738), VER)
done()
