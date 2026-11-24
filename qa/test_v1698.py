"""v10.698 (docs/806) 관 메인 구역 편집 — 소개장터 · 안심소개 · 소개창업 · 소개리드
  ① (코드) MoneyMain · MoneyView(data-lay-box · data-lay-sec 5 · 머리 띠 글 · 위 · 아래 블록) · GwanLanding(구역 5 · 위 · 아래) · 소개리드(글 · 차례 · 구역 뒤 블록) · page.tsx ?lp=
  ③ (API · 화면) MNY 초안(띠 광고 숨김 · 연결 사례 맨 앞 · 제목 · 위 블록) → 미리보기 /money — CSS · 글 · 블록 · 공개 /money 는 그대로 — 끝나면 처음 배치
     MAL 초안(특징 숨김 · 아래 블록) → 미리보기 /mall · LED 초안(제목 · 파트너 안내 맨 앞) → 미리보기 /lead(관이 켜졌을 때만 · 꺼졌으면 404 그대로)
  ④ 문서 806 · 판
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _lay_common import *   # noqa

MM, MV, GL, LD, GP = (rd('site/src/components/money/MoneyMain.tsx'), rd('site/src/components/money/MoneyView.tsx'), rd('site/src/components/gwan/GwanLanding.tsx'),
                      rd('site/src/app/lead/page.tsx'), rd('site/src/app/[gwan]/page.tsx'))
ok('① 소개장터 — 배치 · CSS(data-lay-css) · 구역 5 · 머리 띠 글 · 위 · 아래 블록',
   "getLayout('MNY', lp)" in MM and "layCss(lay, '.mny', MNY_SECS)" in MM and "MNY_SECS = ['quick', 'cat', 'cols', 'band', 'bottom']" in MM
   and all(f'data-lay-sec="{k}"' in MV for k in ('quick', 'cat', 'cols', 'band', 'bottom')) and 'data-lay-box=""' in MV and 'lay?.texts?.title' in MV and '{lay?.top}' in MV and '{lay?.bottom}' in MV, '')
ok('① 안심소개 · 소개창업 — 구역(검색 · 축 · 안내 · 목록 · 특징) · 위 · 아래 블록 · 관 화면 ?lp= 넘김',
   "await getLayout(code, lp)" in GL and all(f'data-lay-sec="{k}"' in GL for k in ('search', 'axis', 'notice', 'body', 'features')) and 'data-lay-top=""' in GL and 'data-lay-bottom=""' in GL
   and '<MoneyMain q={q0} lp={lp} />' in GP and '<GwanLanding code={code} q={q0} lp={lp} />' in GP, '')
ok('① 소개리드 — 제목 · 설명 · 구역 차례(안내 · 업종 · 파트너) · 맨 위 · 구역 뒤 블록',
   "getLayout('LED', (await searchParams).lp)" in LD and "lay?.texts.title || t('lead.title')" in LD and "layOrder(lay, ['warn', 'list', 'cta'])" in LD and "ins('_top')" in LD and '{ins(key)}' in LD, '')

if up() and SITE:
    try:
        for k in ('MNY', 'MAL', 'LED'):
            reset(k)
        import consent_ok
        consent_ok.agree('admin@x.com', PW)
        TS = login('admin@x.com')
        lk = call('PATCH', '/admin/site-layouts/MNY', {'layout': {}}, TS)
        call('POST', '/admin/site-layouts/MNY/editable', {'editable': True}, TS)
        mny_open = psql("SELECT is_active FROM gwans WHERE code = 'MNY'") == 't'
        lo = call('PATCH', '/admin/site-layouts/MNY', {'layout': {}}, TS)
        ok('③ 관 메인 — 수정 불가면 422 LOCKED · 수정 가능이어도 관이 열려 있으면 422 GWAN_OPEN(v10.701)', lk.get('code') == 'SITE_LAYOUT_LOCKED'
           and (lo.get('code') == 'SITE_LAYOUT_GWAN_OPEN' if mny_open else '_err' not in lo), f"{lk.get('code')} {mny_open} {lo.get('code')}")
        # 열린 관은 API 로 초안을 못 넣으므로 DB 로 넣고 미리보기 링크(API)로 화면을 봄
        put_draft('MNY', {'sections': [{'key': 'bottom', 'show': True}, {'key': 'band', 'show': False}],
                          'texts': {'title': '시험 1698 장터'}, 'inserts': {'top': [{'type': 'TEXT', 'title': '시험 1698 위', 'body': '위 블록'}]}})
        tok = call('POST', '/admin/site-layouts/MNY/previews', {'hours': 1}, TS).get('token', '')
        st, html = page(f'/money?lp={tok}')
        ok('③ 미리보기 /money — CSS(순서 · 띠 숨김) · 제목 · 위 블록', st == 200 and 'data-lay-css="MNY"' in html and '[data-lay-sec="band"]{display:none!important;' in html
           and '[data-lay-sec="bottom"]{order:1;}' in html and '시험 1698 장터' in html and '시험 1698 위' in html, str(st))
        st2, html2 = page('/money')
        ok('③ 공개 /money 는 그대로(게시 전)', st2 == 200 and 'data-lay-css' not in html2 and '시험 1698 장터' not in html2, str(st2))
        put_draft('MAL', {'sections': [{'key': 'features', 'show': False}], 'inserts': {'bottom': [{'type': 'TEXT', 'title': '시험 1698 안심 아래', 'body': '아래'}]}})
        tm = call('POST', '/admin/site-layouts/MAL/previews', {'hours': 1}, TS).get('token', '')
        st3, html3 = page(f'/mall?lp={tm}')
        ok('③ 미리보기 /mall — 특징 숨김 CSS · 아래 블록', st3 == 200 and 'data-lay-css="MAL"' in html3 and '[data-lay-sec="features"]{display:none!important;' in html3
           and '시험 1698 안심 아래' in html3, str(st3))
        put_draft('LED', {'sections': [{'key': 'cta', 'show': True}], 'texts': {'title': '시험 1698 리드'}})
        tl = call('POST', '/admin/site-layouts/LED/previews', {'hours': 1}, TS).get('token', '')
        st4, html4 = page(f'/lead?lp={tl}')
        led_on = psql("SELECT is_active FROM gwans WHERE code = 'LED'") == 't'
        ok('③ 미리보기 /lead — 켜졌으면 제목 · 파트너 안내가 업종보다 앞 · 꺼졌으면 404 그대로',
           (st4 == 200 and '시험 1698 리드' in html4 and 0 < html4.find('mal-cta') < html4.find('led-list-h')) if led_on else st4 == 404, f'{led_on} {st4}')
    finally:
        for k in ('MNY', 'MAL', 'LED'):
            reset(k)
        ok('③ 끝 — MNY · MAL · LED 처음 배치', psql("SELECT count(*) FROM site_layouts WHERE key IN ('MNY', 'MAL', 'LED') AND draft = '{}'::jsonb AND published IS NULL") == '3', '')
else:
    print('API · DB · 사용자 웹 없음 — ③ 건너뜀')

d6 = doc('806_')
ok('④ 문서 806 — 소개장터 · 안심소개 · 소개창업 · 소개리드 · 위 · 아래', all(w in d6 for w in ('소개장터', '안심소개', '소개창업', '소개리드', '위 · 아래')), str(len(d6)))
ok('④ VERSION v10.698 이상', VT >= (10, 698), VER)
done()
