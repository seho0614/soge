"""v10.744 (docs/852) 페이지 「내 할 일」
  ① (코드) myTasks · 컨트롤러 · 화면
  ③ (API) 칸 · 회원 403
  ④ 문서 852 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

RQ, SP = rd('src/modules/site/publish-requests.service.ts'), rd('web/src/app/admin/SitePages.tsx')
ok('① 서버 · 화면', 'async myTasks()' in RQ and 'function MyTasks(' in SP and '<MyTasks />' in SP, '')
if up():
    import consent_ok
    consent_ok.agree('admin@x.com', PW); consent_ok.agree('buyer@x.com', PW)
    r = call('GET', '/admin/my-page-tasks', None, login('admin@x.com'))
    ok('③ 칸 · 회원 403', all(k in r for k in ('isSuper', 'waiting', 'mineOpen', 'mineRejected')) and call('GET', '/admin/my-page-tasks', None, login('buyer@x.com')).get('_err') == 403, str(r))

d = doc('852_')
ok('④ 문서 852', all(w in d for w in ('내 할 일',)), str(len(d)))
ok('④ VERSION v10.744 이상', VT >= (10, 744), VER)
done()
