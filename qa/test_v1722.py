"""v10.722 (D325 · docs/830) 꾸밀 페이지 방문 수
  ① (코드) site_layout_views · recordView(하루 한 번) · 목록 views7 · LayoutViewPing(미리보기 안 셈) · 붙는 곳
  ③ (API) 방문 → counted · 같은 기기 다시 → false · 목록 views7 — 끝나면 지움
  ④ 문서 830 · 판"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SV, VP, HP = rd('src/modules/site/site-layouts.service.ts'), rd('site/src/components/layout/LayoutViewPing.tsx'), rd('site/src/app/page.tsx')
ok('① 서버 · 사용자 웹 — 하루 한 번 · 7일 · 미리보기 안 셈 · 메인 · 관 메인 · 리드 · 허브', 'async recordView(key: string' in SV and 'views7: views[k] ?? 0' in SV and '/[?&]lp=/.test(location.search)' in VP and '<LayoutViewPing k="HOME" />' in HP, '')
if up():
    day = psql("SELECT (now() AT TIME ZONE 'Asia/Seoul')::date")
    was = psql(f"SELECT coalesce(views, 0) FROM site_layout_views WHERE key = 'EARN' AND day = '{day}'") or '0'
    try:
        import urllib.request
        def v():
            r = urllib.request.Request(API + '/site-layouts/EARN/view', data=b'{}', headers={'content-type': 'application/json', 'User-Agent': 'sgb-qa-1722-' + day}, method='POST')
            return json.loads(urllib.request.urlopen(r, timeout=30).read())
        a, b = v(), v()
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        ly = call('GET', '/admin/site-layouts', None, login('admin@x.com'))
        e = next((x for x in ly if x.get('key') == 'EARN'), {}) if isinstance(ly, list) else {}
        ok('③ 방문 셈 · 같은 기기 다시는 안 셈 · 목록 views7', b.get('counted') is False and (a.get('counted') is True or int(was) > 0) and e.get('views7', 0) >= 1, f"{a} {b} {e.get('views7')}")
    finally:
        psql(f"UPDATE site_layout_views SET views = {int(was)} WHERE key = 'EARN' AND day = '{day}'")

d = doc('830_')
ok('④ 문서 830', all(w in d for w in ('방문 수',)), str(len(d)))
ok('④ VERSION v10.722 이상', VT >= (10, 722), VER)
done()
