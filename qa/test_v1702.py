"""v10.702 (D322 · docs/810) 허브(소개하고 벌기) 사용자 웹 페이지 /earn
  ① (코드) app/earn/page.tsx(허브가 열려 있을 때만 · 하위 관 카드 · 글 · 구역 · 블록) · 꾸밀 페이지 EARN · 공개 /gwans parentCode · screens.json SB-HOM-HUB-010
  ③ (API · 화면) /gwans 에 parentCode · 허브가 열려 있으면 /earn 200(하위 관 카드) · 미리보기(DB 초안 · 제목 · 이용 안내) · 닫혀 있으면 404 — 끝나면 처음 배치
  ④ 문서 810 · 판
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

EP, SV, CS, SJ = rd('site/src/app/earn/page.tsx'), rd('src/modules/site/site-layouts.service.ts'), rd('src/modules/catalog/catalog.service.ts'), rd('spec/screens.json')
ok('① /earn — 허브(EARN · isHub)가 없으면 404 · 하위 관(parentCode = EARN · 열린 것) 카드 · 글 · 구역 차례 · 블록',
   "g.code === 'EARN' && g.isHub" in EP and 'notFound()' in EP and "g.parentCode === 'EARN'" in EP and "getLayout('EARN', (await searchParams).lp)" in EP
   and "layOrder(lay, ['cards', 'guide'])" in EP and 'data-hub-cards' in EP and 'data-screen="SB-HOM-HUB-010"' in EP, '')
ok('① 서버 — 꾸밀 페이지 EARN(/earn · 구역 2 · 글 3) · 관 열림 규칙 대상 · 공개 /gwans 에 parentCode',
   "name: '소개하고 벌기(허브) 메인', path: '/earn'" in SV and "EARN: 'EARN'" in SV and 'g.parent_code AS "parentCode"' in CS, '')
ok('① screens.json — SB-HOM-HUB-010 /earn', any(s.get('id') == 'SB-HOM-HUB-010' and s.get('url') == '/earn' for s in json.loads(SJ or '{}').get('screens', [])), '')

if up() and SITE:
    try:
        reset('EARN')
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        gw = call('GET', '/gwans')
        ok('③ 공개 /gwans 에 parentCode 칸', isinstance(gw, list) and all('parentCode' in g for g in gw), str(len(gw) if isinstance(gw, list) else gw))
        hub_on = any(g.get('code') == 'EARN' and g.get('isHub') for g in (gw if isinstance(gw, list) else []))
        st, html = page('/earn')
        ok('③ /earn — 허브가 열려 있으면 200 · 하위 관 카드 · 닫혀 있으면 404', (st == 200 and 'data-hub-cards' in html) if hub_on else st == 404, f'{hub_on} {st}')
        if hub_on:
            put_draft('EARN', {'sections': [{'key': 'guide', 'show': True}, {'key': 'cards', 'show': True}], 'texts': {'title': '시험 1702 허브', 'guide': '시험 1702 안내'}})
            tok = call('POST', '/admin/site-layouts/EARN/previews', {'hours': 1}, TS).get('token', '')
            st2, html2 = page(f'/earn?lp={tok}')
            ok('③ 미리보기 /earn — 제목 · 이용 안내가 카드보다 앞', st2 == 200 and '시험 1702 허브' in html2 and 0 < html2.find('data-hub-guide') < html2.find('data-hub-cards'), str(st2))
    finally:
        reset('EARN')
        ok('③ 끝 — EARN 처음 배치', psql("SELECT draft::text || coalesce(published::text, '') FROM site_layouts WHERE key = 'EARN'") == '{}', '')
else:
    print('API · DB · 사용자 웹 없음 — ③ 건너뜀')

d = doc('810_')
ok('④ 문서 810 — 허브 · /earn · 하위 관 · 열려 있을 때만', all(w in d for w in ('허브', '/earn', '하위 관', '열려 있을 때만')), str(len(d)))
ok('④ VERSION v10.702 이상', VT >= (10, 702), VER)
done()
