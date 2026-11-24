"""v10.699 (docs/807) 소개몰 메인 · 구성 편집
  ① (코드) ShopMain 구역 10(secs) · 배치 차례 · 머리 띠 맨 위 · 고른 상품(새 상품 · 특가 · 품절 빠짐) · 글 · 구역 뒤 블록 · page.tsx listings · 서버 picks 한도
  ② (API 규칙) 고른 상품 13개 · 코드 모양 422
  ③ (API · 화면) HLT 초안(머리 띠 글 · 특가를 성분 앞 · 바로가기 줄 숨김 · 새 상품 고름 · 특가 뒤 블록) → 미리보기 /health 그대로 — 끝나면 처음 배치
  ④ 문서 807 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

SM, GP, SV = rd('site/src/components/shop/ShopMain.tsx'), rd('site/src/app/[gwan]/page.tsx'), rd('src/modules/site/site-layouts.service.ts')
ok('① ShopMain — 구역 10 · 차례 · 머리 띠 맨 위 · 구역 뒤 블록',
   "HLT_SECS = ['hero', 'nav', 'ing', 'con', 'low', 'today', 'two', 'deal', 'band', 'listings']" in SM and all(f'secs.{k} =' in SM for k in ('hero', 'nav', 'ing', 'con', 'low', 'today', 'two', 'deal', 'band', 'listings'))
   and "order.filter((x) => x.key !== 'hero')" in SM and '{show && secs[key]}{ins(key)}' in SM and "{ins('_top')}{ins('hero')}" in SM, '')
ok('① 고른 상품 · 글 — 고른 차례 · 품절 빠짐 · 비우면 처음 규칙 · 머리 띠 · 아래 띠 글',
   "lay?.picks?.[k]" in SM and "!p.soldOut" in SM and "pick('fresh').length ?" in SM and "pick('deal').length ?" in SM and 'tx.heroTitle ?' in SM and 'tx.bandLead ||' in SM, '')
ok('① 관 화면 — 도매 · 납품 매물을 한 구역(listings)으로 · 서버 한도 새 상품 8 · 특가 12',
   "<ShopMain lay={lay} listings={" in GP and "getLayout('HLT', lp)" in GP and "['fresh', '새 상품(비우면 최근 올린 순)', 8]" in SV and "['deal', '특가(비우면 특별가격 상품)', 12]" in SV, '')

if up():
    try:
        reset('HLT')
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        e1 = call('PATCH', '/admin/site-layouts/HLT', {'layout': {'picks': {'deal': [f'P{i}' for i in range(13)]}}}, TS)
        e2 = call('PATCH', '/admin/site-layouts/HLT', {'layout': {'picks': {'fresh': ['나쁜 코드!']}}}, TS)
        ok('② 고른 상품 13개 · 코드 모양 422', e1.get('code') == 'SITE_LAYOUT_INVALID' and e2.get('code') == 'SITE_LAYOUT_INVALID', f"{e1.get('code')} {e2.get('code')}")
        code = psql("SELECT code FROM hlt_products WHERE status = 'ON_SALE' AND code ~ '^[A-Za-z0-9_.-]{1,60}$' ORDER BY created_at LIMIT 1") or 'NONE'
        lay = {'sections': [{'key': 'hero', 'show': True}, {'key': 'deal', 'show': True}, {'key': 'ing', 'show': True}, {'key': 'nav', 'show': False}],
               'texts': {'heroTitle': '시험 1699 몰', 'bandLead': '시험 1699 띠'}, 'picks': {'fresh': [code] if code != 'NONE' else []},
               'inserts': {'deal': [{'type': 'TEXT', 'title': '시험 1699 특가 뒤', 'body': '블록'}]}}
        lk = call('PATCH', '/admin/site-layouts/HLT', {'layout': lay}, TS)
        put_draft('HLT', lay)   # v10.701 열린 관 · 수정 불가는 API 로 못 넣음(규칙 검사는 먼저 함 — ② 가 422 INVALID) → DB 로 넣고 미리보기
        d = call('GET', '/admin/site-layouts/HLT', None, TS)
        ok('③ HLT — API 초안은 422(수정 불가) · DB 초안 읽힘(특가 둘째 · 글)', lk.get('code') in ('SITE_LAYOUT_LOCKED', 'SITE_LAYOUT_GWAN_OPEN')
           and [s['key'] for s in (d.get('draft') or {}).get('sections', [])][:3] == ['hero', 'deal', 'ing']
           and (d.get('draft') or {}).get('texts', {}).get('heroTitle') == '시험 1699 몰', f"{lk.get('code')}")
        if SITE:
            tok = call('POST', '/admin/site-layouts/HLT/previews', {'hours': 1}, TS).get('token', '')
            st, html = page(f'/health?lp={tok}')
            i_deal, i_ing, i_ins = html.find('data-shop-deal'), html.find('data-shop-ing'), html.find('data-lay-ins="deal"')
            ok('③ 미리보기 /health — 머리 띠 글 · 아래 띠 글 · 바로가기 줄 없음 · 특가 뒤 블록(특가가 있으면 성분보다 앞)',
               st == 200 and '시험 1699 몰' in html and '시험 1699 띠' in html and 'shop-lnav' not in html and i_ins > 0 and '시험 1699 특가 뒤' in html
               and (i_deal < 0 or i_ing < 0 or i_deal < i_ing), f'{st} deal {i_deal} ing {i_ing} ins {i_ins}')
    finally:
        reset('HLT')
        ok('③ 끝 — HLT 처음 배치', psql("SELECT draft::text || coalesce(published::text, '') FROM site_layouts WHERE key = 'HLT'") == '{}', '')
else:
    print('API · DB 없음 — ② · ③ 건너뜀')

d7 = doc('807_')
ok('④ 문서 807 — 소개몰 · 구역 · 상품 고르기 · 글자', all(w in d7 for w in ('소개몰', '구역', '상품 고르기', '글자')), str(len(d7)))
ok('④ VERSION v10.699 이상', VT >= (10, 699), VER)
done()
